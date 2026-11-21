import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { canSetPremove, createCapturePremove, createPremove, formatPremove, getPremoveCaptureMoves, getPremoveMoves, isChessSquare, isPremoveForTurn, isPremoveShape, premoveClockPenaltyMs, premoveToUci, resolvePremove, samePremove, sanitizePremove } from "../src/lib/premoves.ts";
import { clockUrgency, formatClock, formatMoveNumber, getBoardOrientation, isActiveGame, isBoardTheme, normalizeGameplayPreferences, shouldAskBeforeResign, updateGameplayPreferences } from "../src/lib/gameplayPreferences.ts";
import { buildPgnFromSan, buildPgnFromUci, formatSanMoveList, pgnFilename, textFilename } from "../src/lib/gameNotation.ts";
import { formatMaterialBalance, gamePhaseLabel, getCapturedMaterial, getGamePhase, getHalfmoveClock, getLegalMoveCount, getPositionInsights, isNearFiftyMoveRule, replaySanHistory, replayUciHistory, terminalStateLabel } from "../src/lib/gameInsights.ts";
import { classifyGamePhase } from "../src/lib/learningStats.ts";
import { recordPersonalGameReview } from "../src/lib/playerProfile.ts";
import { isOnlineGameSnapshotNewer, parseOnlineGameRealtimeFrame } from "../src/lib/onlineGameRealtime.ts";
import { determinePuzzleBattleWinner } from "../supabase/functions/puzzle-battle/puzzleBattleCore.ts";
import { soundForSan } from "../src/lib/sound.ts";
const start = new Chess().fen();
assert.equal(isChessSquare("e4"), true); assert.equal(isChessSquare("i9"), false);
assert.equal(isPremoveShape({from:"e2",to:"e4"}), true);
assert.equal(isPremoveShape({from:"e2",to:"e4",promotion:"king"}), false);
assert.deepEqual(sanitizePremove({from:"e2",to:"e4",ignored:true}), {from:"e2",to:"e4"});
assert.equal(sanitizePremove({from:"bad",to:"e4"}), null);
assert.equal(getPremoveMoves(start,"b","e7").length,2);
assert.equal(canSetPremove(start,"b","e7","e5"),true);
assert.equal(canSetPremove(start,"b","e7","e4"),false);
assert.deepEqual(createPremove(start,"b","e7","e5"),{from:"e7",to:"e5"});
assert.equal(createPremove(start,"b","e7","e4"),null);
assert.equal(isPremoveShape({from:"e2",to:"e4",capture:true}),true);
assert.equal(isPremoveShape({from:"e2",to:"e4",capture:"yes"}),false);
assert.deepEqual(sanitizePremove({from:"e2",to:"e4",capture:true}), {from:"e2",to:"e4",capture:true});
assert.equal(isPremoveForTurn(start,"b"),true); assert.equal(isPremoveForTurn(start,"w"),false);
const afterE4 = new Chess(); afterE4.move("e4");
const pawnCapture = createCapturePremove(afterE4.fen(), "w", "e4", "d5");
assert.deepEqual(pawnCapture, { from: "e4", to: "d5", capture: true });
assert.ok(getPremoveCaptureMoves(afterE4.fen(), "w", "e4").some((move) => move.to === "d5"));
const afterBlackD5 = new Chess(afterE4.fen()); afterBlackD5.move("d5");
assert.equal(resolvePremove(afterBlackD5.fen(), "w", pawnCapture)?.san, "exd5");
const afterBlackNf6 = new Chess(afterE4.fen()); afterBlackNf6.move("Nf6");
assert.equal(resolvePremove(afterBlackNf6.fen(), "w", pawnCapture), null,
  "A capture-intent premove must be cancelled when the target square stays empty.");

// En passant captures land on an empty square, but are still real pawn captures.
const beforeWhiteD4 = new Chess("4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1");
const blackEnPassantPremove = createCapturePremove(beforeWhiteD4.fen(), "b", "e4", "d3");
assert.ok(blackEnPassantPremove, "A pawn can queue a possible en-passant destination.");
const afterWhiteD4 = new Chess(beforeWhiteD4.fen());
afterWhiteD4.move("d4");
assert.equal(resolvePremove(afterWhiteD4.fen(), "b", blackEnPassantPremove)?.san, "exd3");
const afterWhiteD3 = new Chess(beforeWhiteD4.fen());
afterWhiteD3.move("d3");
assert.equal(resolvePremove(afterWhiteD3.fen(), "b", blackEnPassantPremove), null);
assert.equal(formatPremove(pawnCapture), "e4 → d5 ×");

const queenBefore = "4k3/8/3r4/8/3Q4/8/8/4K3 b - - 0 1";
const queenCapture = createCapturePremove(queenBefore, "w", "d4", "d5");
assert.ok(queenCapture, "Queens must be able to queue a capture onto an empty square.");
assert.ok(getPremoveCaptureMoves(queenBefore, "w", "d4").some((move) => move.to === "d5"));
const afterRookD5 = new Chess(queenBefore); afterRookD5.move({ from: "d6", to: "d5" });
assert.equal(resolvePremove(afterRookD5.fen(), "w", queenCapture)?.san, "Qxd5");
const afterKingMove = new Chess(queenBefore); afterKingMove.move({ from: "e8", to: "f7" });
assert.equal(resolvePremove(afterKingMove.fen(), "w", queenCapture), null);

const knightBefore = "4k3/p7/8/8/8/2N5/8/4K3 b - - 0 1";
assert.ok(getPremoveCaptureMoves(knightBefore, "w", "c3").some((move) => move.to === "d5"),
  "Knights must expose empty squares they can capture onto after the opponent moves.");

const afterE4C5=new Chess(); afterE4C5.move("e4"); afterE4C5.move("c5");
const premove=createPremove(afterE4C5.fen(),"b","d7","d6"); assert.ok(premove);
const afterNf3=new Chess(afterE4C5.fen()); afterNf3.move("Nf3");
const resolved=resolvePremove(afterNf3.fen(),"b",premove);
assert.equal(resolved?.san,"d6"); assert.equal(resolved?.uci,"d7d6");
assert.equal(new Chess(resolved?.fenAfter).turn(),"w");
assert.equal(resolvePremove(afterE4C5.fen(),"b",premove),null);
assert.equal(samePremove(premove,{from:"d7",to:"d6"}),true);
assert.equal(premoveToUci(premove),"d7d6"); assert.equal(formatPremove(premove),"d7 → d6");
assert.equal(premoveClockPenaltyMs(true),100); assert.equal(premoveClockPenaltyMs(false),0);
const castle="r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
assert.ok(getPremoveMoves(castle,"w","e1").some(m=>m.to==="g1"));
const checkPosition = "4k3/8/8/8/8/8/8/4R1K1 b - - 0 1";
assert.ok(new Chess(checkPosition).isCheck());
assert.ok(getPremoveMoves(checkPosition, "w", "g1").length > 0);
assert.equal(canSetPremove(checkPosition, "w", "g1", "f1"), true);
const afterKingEscape = new Chess(checkPosition);
afterKingEscape.move("Kd7");
assert.equal(resolvePremove(afterKingEscape.fen(), "w", { from: "g1", to: "f1" })?.uci, "g1f1");
const promo="4k3/P7/8/8/8/8/8/4K3 b - - 0 1";
assert.ok(getPremoveMoves(promo,"w","a7").some(m=>m.to==="a8" && m.promotion));
assert.equal(resolvePremove("4k3/P7/8/8/8/8/8/4K3 w - - 0 1","w",{from:"a7",to:"a8",promotion:"n"})?.uci,"a7a8n");
assert.equal(isBoardTheme("walnut"),true); assert.equal(isBoardTheme("neon"),false);
assert.equal(normalizeGameplayPreferences({boardTheme:"blue",premovesEnabled:false}).boardTheme,"blue");
assert.equal(normalizeGameplayPreferences({premovesEnabled:"yes"}).premovesEnabled,true);
const prefs=updateGameplayPreferences(normalizeGameplayPreferences(null),{premovesEnabled:false,boardTheme:"violet"});
assert.equal(prefs.premovesEnabled,false); assert.equal(prefs.boardTheme,"violet");
assert.equal(getBoardOrientation("w",false),"white"); assert.equal(getBoardOrientation("b",false),"black"); assert.equal(getBoardOrientation("w",true),"black");
assert.equal(clockUrgency(60000),"normal"); assert.equal(clockUrgency(25000),"warning"); assert.equal(clockUrgency(9000),"critical");
assert.equal(formatClock(60000),"1:00"); assert.equal(formatClock(9500,true),"0:09.5");
assert.equal(formatMoveNumber(0),"1."); assert.equal(formatMoveNumber(1),"");
assert.equal(shouldAskBeforeResign(true,true),true); assert.equal(shouldAskBeforeResign(true,false),false);
assert.equal(isActiveGame("active"),true); assert.equal(isActiveGame("completed"),false);
assert.equal(soundForSan("e4"), "move");
assert.equal(soundForSan("e5", false, undefined, "opponent"), "opponent");
assert.equal(soundForSan("d6", false, undefined, "premove"), "premove");
assert.equal(soundForSan("exd5"), "capture");
assert.equal(soundForSan("O-O"), "castle");
assert.equal(soundForSan("e8=Q"), "promote");
assert.equal(soundForSan("Qh7+"), "check");
assert.equal(soundForSan("Qh7#"), "mate");
assert.equal(soundForSan("Qh7", true), "end");
const pgn=buildPgnFromSan(["e4","e5","Nf3"],{White:"Tester",Black:"Stockfish",Result:"*"});
assert.match(pgn,/1\. e4 e5 2\. Nf3/); assert.match(pgn,/\[White "Tester"\]/);
assert.match(buildPgnFromUci([{uci:"e2e4"},{uci:"e7e5"},{uci:"g1f3"}]),/1\. e4 e5 2\. Nf3/);
assert.equal(formatSanMoveList(["e4","e5","Nf3"]),"1. e4 e5\n2. Nf3");
assert.match(pgnFilename("Chessmart Bullet"),/^chessmart-bullet-\d{4}-\d{2}-\d{2}\.pgn$/);
assert.match(textFilename("Live Game","fen"),/^live-game-\d{4}-\d{2}-\d{2}\.fen$/);
const replayed = replaySanHistory(["e4", "d5", "exd5"]);
assert.equal(replayed.history().length, 3);
assert.equal(replayed.turn(), "b");
assert.equal(replayUciHistory([{ uci: "e2e4" }, { uci: "e7e5" }]).history().length, 2);
assert.equal(getLegalMoveCount(start), 20);
assert.equal(getGamePhase(start), "opening");
assert.equal(getGamePhase("not-a-valid-fen"), "opening", "Malformed FEN must keep the safe fallback phase.");
const phaseBoundary = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 11";
const materialBoundary = "r2nk2r/8/8/8/8/8/8/R1N1K2R w - - 0 20";
assert.equal(classifyGamePhase(phaseBoundary), "middlegame");
assert.equal(getGamePhase(phaseBoundary), classifyGamePhase(phaseBoundary),
  "Position Lab and learning statistics must agree at the opening boundary.");
assert.equal(classifyGamePhase(materialBoundary), "middlegame");
assert.equal(getGamePhase(materialBoundary), classifyGamePhase(materialBoundary),
  "Position Lab and learning statistics must use the same endgame material threshold.");
assert.equal(gamePhaseLabel("endgame"), "Эндшпиль");
assert.equal(getHalfmoveClock(start), 0);
assert.equal(isNearFiftyMoveRule("8/8/8/8/8/8/8/K6k w - - 85 70"), true);
assert.equal(formatMaterialBalance(3), "Белые +3");
assert.equal(formatMaterialBalance(-5), "Чёрные +5");
assert.equal(formatMaterialBalance(0), "Материал равен");
assert.equal(getCapturedMaterial(replayed.fen(), "b"), 1);
const insights = getPositionInsights(replayed.fen(), replayed);
assert.equal(insights.moveNumber, 2);
assert.equal(insights.turn, "b");
assert.equal(insights.terminal, "playing");
assert.equal(terminalStateLabel("checkmate"), "Мат");
assert.equal(createPremove(promo, "w", "a7", "a8", "n")?.promotion, "n");

const personalReview = {
  headers: { White: "Tester", Black: "Opponent", Result: "1-0" },
  startFen: start,
  moves: [
    { index: 0, color: "w", san: "e4", uci: "e2e4", fenBefore: start, cls: "best" },
    { index: 1, color: "b", san: "e5", uci: "e7e5", fenBefore: start, cls: "blunder" },
    { index: 2, color: "w", san: "Nf3", uci: "g1f3", fenBefore: start, cls: "brilliant" },
  ],
  accuracy: { w: 97, b: 41 },
};
const personalBase = {
  name: "Tester", rating: 1200, puzzleRating: 1200, puzzleRatingHistory: [],
  games: 1, wins: 1, losses: 0, draws: 0, qualifyingBotGames: 1,
  history: [], reviews: [], puzzles: [], trainingSessions: [],
};
const onlyWhite = recordPersonalGameReview(personalBase, personalReview, "w");
assert.equal(onlyWhite.personalReviews.length, 1);
assert.equal(onlyWhite.personalReviews[0].counts.best, 1);
assert.equal(onlyWhite.personalReviews[0].counts.brilliant, 1);
assert.equal(onlyWhite.personalReviews[0].counts.blunder, 0,
  "Opponent blunders must not be included in personal statistics.");
const onlyBlack = recordPersonalGameReview(personalBase, personalReview, "b");
assert.equal(onlyBlack.personalReviews[0].counts.blunder, 1);
assert.equal(onlyBlack.personalReviews[0].counts.best, 0,
  "The player's statistics must exclude the other side's best moves.");
const topic = "realtime:online-game:00000000-0000-0000-0000-000000000001";
const liveFrame = parseOnlineGameRealtimeFrame(JSON.stringify([
  "9", "9", topic, "postgres_changes",
  { data: {
    schema: "public",
    table: "online_games",
    type: "UPDATE",
    record: { id: "00000000-0000-0000-0000-000000000001", fen: "position", moves: [] },
  } },
]), topic);
assert.equal(liveFrame?.event, "postgres_changes");
assert.equal((liveFrame?.payload.data).table, "online_games");
assert.equal(parseOnlineGameRealtimeFrame(JSON.stringify([
  null, null, "realtime:another-game", "postgres_changes", {},
]), topic), null, "Events from other games must be ignored.");
assert.equal(parseOnlineGameRealtimeFrame("not-json", topic), null);

assert.equal(determinePuzzleBattleWinner([
  { user_id: "white", score: 5, mistakes: 3 },
  { user_id: "black", score: 4, mistakes: 0 },
]), "white", "Higher puzzle score wins before any tiebreaker.");
assert.equal(determinePuzzleBattleWinner([
  { user_id: "white", score: 5, mistakes: 2 },
  { user_id: "black", score: 5, mistakes: 1 },
]), "black", "Fewer mistakes break a tied puzzle score.");
assert.equal(determinePuzzleBattleWinner([
  { user_id: "white", score: 5, mistakes: 1 },
  { user_id: "black", score: 5, mistakes: 1 },
]), null, "Identical score and mistake counts produce a draw.");

const snapshot = { id: "game-1", status: "active", moves: [{ uci: "e2e4" }], updated_at: "2026-11-21T12:00:05.000Z" };
assert.equal(isOnlineGameSnapshotNewer(snapshot, { ...snapshot, moves: [] }), false,
  "An out-of-order response must not roll the board back to fewer moves.");
assert.equal(isOnlineGameSnapshotNewer(snapshot, { ...snapshot, updated_at: "2026-11-21T12:00:04.000Z" }), false,
  "A stale poll response must not overwrite a newer snapshot.");
assert.equal(isOnlineGameSnapshotNewer(snapshot, { ...snapshot, moves: [...snapshot.moves, { uci: "e7e5" }] }), true);
assert.equal(isOnlineGameSnapshotNewer(snapshot, { ...snapshot, status: "completed" }), true);
assert.equal(isOnlineGameSnapshotNewer({ ...snapshot, status: "completed" }, snapshot), false,
  "A completed game must never be reopened by a late active snapshot.");
assert.equal(parseOnlineGameRealtimeFrame(JSON.stringify({ event: "postgres_changes" }), topic), null);

console.log("Premove, gameplay, personal move-quality, and Realtime transport validation passed.");
