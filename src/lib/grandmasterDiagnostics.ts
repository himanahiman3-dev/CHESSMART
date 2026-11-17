import { Chess, type Square } from "chess.js";

export type DiagnosticTone = "good" | "watch" | "info";
export interface DiagnosticResult {
  id: string;
  category: string;
  title: string;
  description: string;
  value: number;
  displayValue: string;
  tone: DiagnosticTone;
  interpretation: string;
}
export interface DiagnosticReport {
  fen: string;
  sideToMove: "w" | "b";
  status: string;
  total: number;
  good: number;
  watch: number;
  info: number;
  results: DiagnosticResult[];
}
type Color = "w" | "b";
type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
type Direction = "high" | "low" | "present" | "absent" | "balanced" | "info";
type MetricSpec = {
  id: string; category: string; title: string; key: string; direction: Direction;
  target: number; unit: string; description: string;
};
type PieceOnBoard = { color: Color; type: PieceType; square: Square; file: number; rank: number };
type AttackMap = Map<string, number>;
type PositionFacts = Record<string, number>;

const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = "abcdefgh";
const CENTER = new Set(["d4", "e4", "d5", "e5"]);
const EXTENDED_CENTER = new Set(["c3","d3","e3","f3","c4","d4","e4","f4","c5","d5","e5","f5","c6","d6","e6","f6"]);
const allColors: Color[] = ["w", "b"];

function squareName(file: number, row: number): Square {
  return (FILES[file] + String(8 - row)) as Square;
}
function parsePieces(chess: Chess): PieceOnBoard[] {
  const pieces: PieceOnBoard[] = [];
  const board = chess.board();
  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[row][file];
      if (piece) pieces.push({ color: piece.color, type: piece.type, square: squareName(file, row), file, rank: 8 - row });
    }
  }
  return pieces;
}
function pieceAttacks(piece: PieceOnBoard, pieces: PieceOnBoard[]): string[] {
  const blocked = new Set(pieces.map((entry) => entry.square));
  const result: string[] = [];
  const add = (file: number, row: number) => {
    if (file >= 0 && file < 8 && row >= 0 && row < 8) result.push(squareName(file, row));
  };
  if (piece.type === "p") {
    const direction = piece.color === "w" ? -1 : 1;
    add(piece.file - 1, 7 - piece.rank + direction);
    add(piece.file + 1, 7 - piece.rank + direction);
    return result;
  }
  if (piece.type === "n") {
    for (const [df, dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(piece.file + df, 7 - piece.rank + dr);
    return result;
  }
  if (piece.type === "k") {
    for (let df = -1; df <= 1; df += 1) for (let dr = -1; dr <= 1; dr += 1) if (df || dr) add(piece.file + df, 7 - piece.rank + dr);
    return result;
  }
  const dirs: Array<[number, number]> = [];
  if (piece.type === "b" || piece.type === "q") dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
  if (piece.type === "r" || piece.type === "q") dirs.push([-1,0],[1,0],[0,-1],[0,1]);
  for (const [df, dr] of dirs) {
    for (let step = 1; step < 8; step += 1) {
      const file = piece.file + df * step;
      const row = 7 - piece.rank + dr * step;
      if (file < 0 || file > 7 || row < 0 || row > 7) break;
      const square = squareName(file, row);
      result.push(square);
      if (blocked.has(square)) break;
    }
  }
  return result;
}
function buildAttackMap(pieces: PieceOnBoard[], color: Color): AttackMap {
  const map: AttackMap = new Map();
  for (const piece of pieces) {
    if (piece.color !== color) continue;
    for (const square of pieceAttacks(piece, pieces)) map.set(square, (map.get(square) ?? 0) + 1);
  }
  return map;
}
function countWhere(pieces: PieceOnBoard[], color: Color, predicate: (piece: PieceOnBoard) => boolean): number {
  return pieces.filter((piece) => piece.color === color && predicate(piece)).length;
}
function pawnFiles(pieces: PieceOnBoard[], color: Color): number[] {
  return Array.from({ length: 8 }, (_, file) => pieces.filter((p) => p.color === color && p.type === "p" && p.file === file).length);
}
function pawnPassed(piece: PieceOnBoard, enemyPawns: PieceOnBoard[]): boolean {
  return !enemyPawns.some((enemy) => Math.abs(enemy.file - piece.file) <= 1 &&
    (piece.color === "w" ? enemy.rank > piece.rank : enemy.rank < piece.rank));
}
function pawnIslands(counts: number[]): number {
  let islands = 0;
  let previous = false;
  for (const count of counts) {
    const present = count > 0;
    if (present && !previous) islands += 1;
    previous = present;
  }
  return islands;
}
function countCenter(map: AttackMap, squares: Set<string>): number {
  return Array.from(squares).filter((square) => (map.get(square) ?? 0) > 0).length;
}
function countKingShield(king: PieceOnBoard | undefined, pieces: PieceOnBoard[]): number {
  if (!king) return 0;
  const direction = king.color === "w" ? -1 : 1;
  return pieces.filter((p) => p.color === king.color && p.type === "p" &&
    Math.abs(p.file - king.file) <= 1 && (king.color === "w" ? p.rank > king.rank : p.rank < king.rank) &&
    Math.abs(p.rank - king.rank) <= 2).length;
}
function countAttackedPieces(pieces: PieceOnBoard[], color: Color, enemyAttacks: AttackMap): number {
  return pieces.filter((p) => p.color === color && p.type !== "k" && (enemyAttacks.get(p.square) ?? 0) > 0).length;
}
function countHangingPieces(pieces: PieceOnBoard[], color: Color, enemyAttacks: AttackMap, ownAttacks: AttackMap): number {
  return pieces.filter((p) => p.color === color && p.type !== "k" &&
    (enemyAttacks.get(p.square) ?? 0) > 0 && (ownAttacks.get(p.square) ?? 0) === 0).length;
}
function pieceMobility(piece: PieceOnBoard, pieces: PieceOnBoard[]): number {
  return pieceAttacks(piece, pieces).filter((square) => !pieces.some((p) => p.square === square && p.color === piece.color)).length;
}
function countFilesWithRooks(pieces: PieceOnBoard[], color: Color, pawnCounts: number[], enemyPawnCounts: number[]): number {
  return pieces.filter((p) => p.color === color && p.type === "r" && (pawnCounts[p.file] === 0 || enemyPawnCounts[p.file] === 0)).length;
}
function countRooksOnOpenFiles(pieces: PieceOnBoard[], color: Color, pawnCounts: number[]): number {
  return pieces.filter((p) => p.color === color && p.type === "r" && pawnCounts[p.file] === 0).length;
}
function countColorComplex(pieces: PieceOnBoard[], color: Color, light: boolean): number {
  return pieces.filter((p) => p.color === color && ((p.file + p.rank) % 2 === 0) === light).length;
}
function countConnectedRooks(pieces: PieceOnBoard[], color: Color): number {
  const rooks = pieces.filter((p) => p.color === color && p.type === "r");
  if (rooks.length < 2) return 0;
  return rooks.some((a) => rooks.some((b) => a.square !== b.square && (a.file === b.file || a.rank === b.rank) &&
    pieces.every((p) => p.square === a.square || p.square === b.square ||
      (a.file === b.file ? p.file !== a.file || (p.rank - a.rank) * (p.rank - b.rank) >= 0 :
        p.rank !== a.rank || (p.file - a.file) * (p.file - b.file) >= 0)))) ? 1 : 0;
}
function buildFacts(chess: Chess): PositionFacts {
  const pieces = parsePieces(chess);
  const byColor: Record<Color, PieceOnBoard[]> = { w: pieces.filter((p) => p.color === "w"), b: pieces.filter((p) => p.color === "b") };
  const attacks: Record<Color, AttackMap> = { w: buildAttackMap(pieces, "w"), b: buildAttackMap(pieces, "b") };
  const pawns: Record<Color, PieceOnBoard[]> = { w: byColor.w.filter((p) => p.type === "p"), b: byColor.b.filter((p) => p.type === "p") };
  const files: Record<Color, number[]> = { w: pawnFiles(pieces, "w"), b: pawnFiles(pieces, "b") };
  const kings: Record<Color, PieceOnBoard | undefined> = {
    w: byColor.w.find((p) => p.type === "k"), b: byColor.b.find((p) => p.type === "k"),
  };
  const facts: PositionFacts = {};
  const set = (key: string, value: number) => { facts[key] = Number.isFinite(value) ? value : 0; };
  for (const color of allColors) {
    const prefix = color === "w" ? "white" : "black";
    const own = byColor[color];
    const ownPawns = pawns[color];
    const enemyPawns = pawns[color === "w" ? "b" : "w"];
    const ownFiles = files[color];
    const enemyFiles = files[color === "w" ? "b" : "w"];
    const ownAttack = attacks[color];
    const enemyAttack = attacks[color === "w" ? "b" : "w"];
    const king = kings[color];
    const count = (type: PieceType) => own.filter((p) => p.type === type).length;
    const material = own.reduce((sum, p) => sum + VALUES[p.type], 0);
    const passed = ownPawns.filter((p) => pawnPassed(p, enemyPawns));
    const advanced = ownPawns.filter((p) => color === "w" ? p.rank >= 5 : p.rank <= 4);
    const doubled = ownFiles.reduce((sum, value) => sum + Math.max(0, value - 1), 0);
    const isolated = ownPawns.filter((p) => (p.file === 0 || ownFiles[p.file - 1] === 0) && (p.file === 7 || ownFiles[p.file + 1] === 0)).length;
    const connected = ownPawns.filter((p) => ownPawns.some((other) => other.square !== p.square && Math.abs(other.file - p.file) <= 1 && Math.abs(other.rank - p.rank) <= 1)).length;
    const pawnChain = ownPawns.filter((p) => ownPawns.some((other) => other.square !== p.square && Math.abs(other.file - p.file) === 1 && (color === "w" ? other.rank === p.rank - 1 : other.rank === p.rank + 1))).length;
    const attackersOnKing = king ? (enemyAttack.get(king.square) ?? 0) : 0;
    const kingZone = king ? Array.from(enemyAttack.entries()).filter(([square, amount]) => {
      const file = FILES.indexOf(square[0]); const rank = Number(square[1]);
      return amount > 0 && Math.abs(file - king.file) <= 1 && Math.abs(rank - king.rank) <= 1;
    }).length : 0;
    const shield = countKingShield(king, pieces);
    const materialAttacked = countAttackedPieces(pieces, color, enemyAttack);
    const hanging = countHangingPieces(pieces, color, enemyAttack, ownAttack);
    const central = countCenter(ownAttack, CENTER);
    const extended = countCenter(ownAttack, EXTENDED_CENTER);
    const piecesEnemyHalf = own.filter((p) => color === "w" ? p.rank >= 5 : p.rank <= 4).length;
    const seventh = own.filter((p) => p.type !== "p" && (color === "w" ? p.rank === 7 : p.rank === 2)).length;
    const bishops = own.filter((p) => p.type === "b");
    const knights = own.filter((p) => p.type === "n");
    const rooks = own.filter((p) => p.type === "r");
    const queens = own.filter((p) => p.type === "q");
    const bishopsMobility = bishops.reduce((sum, p) => sum + pieceMobility(p, pieces), 0);
    const knightsMobility = knights.reduce((sum, p) => sum + pieceMobility(p, pieces), 0);
    const rooksMobility = rooks.reduce((sum, p) => sum + pieceMobility(p, pieces), 0);
    const queensMobility = queens.reduce((sum, p) => sum + pieceMobility(p, pieces), 0);
    const centrality = (p: PieceOnBoard) => 7 - (Math.abs(3.5 - p.file) + Math.abs(4.5 - p.rank));
    const knightCentrality = knights.reduce((sum, p) => sum + centrality(p), 0);
    const outposts = knights.filter((p) => (color === "w" ? p.rank >= 5 : p.rank <= 4) &&
      !enemyPawns.some((enemyPawn) => Math.abs(enemyPawn.file - p.file) <= 1 && (color === "w" ? enemyPawn.rank > p.rank : enemyPawn.rank < p.rank)) &&
      (ownAttack.get(p.square) ?? 0) > 0).length;
    const lightBishops = bishops.filter((p) => ((p.file + p.rank) % 2) === 0).length;
    const darkBishops = bishops.length - lightBishops;
    const openFileRooks = countRooksOnOpenFiles(pieces, color, ownFiles.map((v, i) => v + enemyFiles[i]));
    const semiOpenFileRooks = countFilesWithRooks(pieces, color, ownFiles, enemyFiles) - openFileRooks;
    const homeRank = color === "w" ? 1 : 8;
    const undeveloped = own.filter((p) => (p.type === "n" || p.type === "b") &&
      p.rank === homeRank && ((p.type === "n" && (p.file === 1 || p.file === 6)) || (p.type === "b" && (p.file === 2 || p.file === 5)))).length;
    const pawnIslandsCount = pawnIslands(ownFiles);
    const backward = ownPawns.filter((p) => {
      const supported = ownPawns.some((other) => Math.abs(other.file - p.file) === 1 &&
        (color === "w" ? other.rank === p.rank - 1 : other.rank === p.rank + 1));
      const enemyControlsAdvance = enemyAttack.get(squareName(p.file, 7 - p.rank + (color === "w" ? -1 : 1))) ?? 0;
      return !supported && enemyControlsAdvance > 0 && !passed.includes(p);
    }).length;
    const ownControl = ownAttack.size;
    const ownDefended = own.filter((p) => (ownAttack.get(p.square) ?? 0) > 0).length;
    const threatsOnQueen = queens.filter((p) => (enemyAttack.get(p.square) ?? 0) > 0).length;
    const ownPseudoMobility = Array.from(ownAttack.values()).reduce((sum, value) => sum + value, 0);
    const development = 4 - undeveloped;
    const pawnAdvanceTotal = ownPawns.reduce((sum, p) => sum + (color === "w" ? p.rank - 2 : 7 - p.rank), 0);
    set(prefix + "Material", material);
    set(prefix + "Pawns", count("p"));
    set(prefix + "Knights", count("n"));
    set(prefix + "Bishops", count("b"));
    set(prefix + "Rooks", count("r"));
    set(prefix + "Queens", count("q"));
    set(prefix + "BishopPair", bishops.length >= 2 ? 1 : 0);
    set(prefix + "ControlledSquares", ownControl);
    set(prefix + "PseudoMobility", ownPseudoMobility);
    set(prefix + "CentralControl", central);
    set(prefix + "ExtendedCenterControl", extended);
    set(prefix + "CenterPawns", ownPawns.filter((p) => CENTER.has(p.square)).length);
    set(prefix + "PiecesEnemyHalf", piecesEnemyHalf);
    set(prefix + "KingAttackers", attackersOnKing);
    set(prefix + "KingZonePressure", kingZone);
    set(prefix + "KingShield", shield);
    set(prefix + "AttackedPieces", materialAttacked);
    set(prefix + "AttackedPawns", ownPawns.filter((p) => (enemyAttack.get(p.square) ?? 0) > 0).length);
    set(prefix + "HangingPieces", hanging);
    set(prefix + "DefendedPieces", ownDefended);
    set(prefix + "DoubledPawns", doubled);
    set(prefix + "IsolatedPawns", isolated);
    set(prefix + "PassedPawns", passed.length);
    set(prefix + "AdvancedPawns", advanced.length);
    set(prefix + "ConnectedPawns", connected);
    set(prefix + "PawnChains", pawnChain);
    set(prefix + "PawnIslands", pawnIslandsCount);
    set(prefix + "BackwardPawns", backward);
    set(prefix + "AdvancedPassedPawns", passed.filter((p) => color === "w" ? p.rank >= 6 : p.rank <= 3).length);
    set(prefix + "RookMobility", rooksMobility);
    set(prefix + "RooksOnOpenFiles", openFileRooks);
    set(prefix + "RooksOnSemiOpenFiles", semiOpenFileRooks);
    set(prefix + "ConnectedRooks", countConnectedRooks(pieces, color));
    set(prefix + "BishopMobility", bishopsMobility);
    set(prefix + "LongDiagonalBishops", bishops.filter((p) => pieceAttacks(p, pieces).length >= 7).length);
    set(prefix + "LightBishops", lightBishops);
    set(prefix + "DarkBishops", darkBishops);
    set(prefix + "KnightMobility", knightsMobility);
    set(prefix + "KnightCentrality", knightCentrality);
    set(prefix + "KnightOutposts", outposts);
    set(prefix + "QueenMobility", queensMobility);
    set(prefix + "QueenInCenter", queens.filter((p) => EXTENDED_CENTER.has(p.square)).length);
    set(prefix + "Development", development);
    set(prefix + "UndevelopedMinors", undeveloped);
    set(prefix + "SeventhRankPieces", seventh);
    set(prefix + "LightSquarePieces", countColorComplex(pieces, color, true));
    set(prefix + "DarkSquarePieces", countColorComplex(pieces, color, false));
    set(prefix + "OpenFileControl", own.filter((p) => (p.type === "r" || p.type === "q") && ownFiles[p.file] + enemyFiles[p.file] === 0).length);
    set(prefix + "SemiOpenFileControl", own.filter((p) => (p.type === "r" || p.type === "q") && (ownFiles[p.file] === 0 && enemyFiles[p.file] > 0)).length);
    set(prefix + "ThreatsOnQueen", threatsOnQueen);
    set(prefix + "PawnAdvanceTotal", pawnAdvanceTotal);
    set(prefix + "PieceActivity", piecesEnemyHalf + seventh + outposts);
    set(prefix + "PhaseMaterial", phaseWeight);
    set(prefix + "KingEscapeSquares", king ? pieceAttacks(king, pieces).filter((sq) => !own.some((p) => p.square === sq)).length : 0);
    set(prefix + "KingInCheck", king && (attacks[color === "w" ? "b" : "w"].get(king.square) ?? 0) > 0 ? 1 : 0);
    set(prefix + "KingFilePawns", king ? ownPawns.filter((p) => Math.abs(p.file - king.file) <= 1).length : 0);
    set(prefix + "PawnMajority", Math.max(0, ownPawns.length - enemyPawns.length));
    set(prefix + "PieceCount", own.length);
    set(prefix + "MinorCount", count("n") + count("b"));
    set(prefix + "MajorCount", count("r") + count("q"));
    set(prefix + "DefendersPerPiece", own.length ? ownDefended / own.length : 0);
  }
  const whiteMaterial = facts.whiteMaterial ?? 0;
  const blackMaterial = facts.blackMaterial ?? 0;
  const totalPawns = (facts.whitePawns ?? 0) + (facts.blackPawns ?? 0);
  const combinedPawnFiles = Array.from({ length: 8 }, (_, file) => files.w[file] + files.b[file]);
  const openFiles = combinedPawnFiles.filter((v) => v === 0).length;
  const semiWhite = files.w.filter((v, i) => v === 0 && files.b[i] > 0).length;
  const semiBlack = files.b.filter((v, i) => v === 0 && files.w[i] > 0).length;
  const moves = chess.moves({ verbose: true });
  const checks = moves.filter((m) => m.san.includes("+") || m.san.includes("#")).length;
  const captures = moves.filter((m) => Boolean(m.captured)).length;
  const castles = moves.filter((m) => m.san === "O-O" || m.san === "O-O-O").length;
  const promotions = moves.filter((m) => Boolean(m.promotion)).length;
  const rights = chess.fen().split(/\s+/)[2] ?? "-";
  const allMaterial = whiteMaterial + blackMaterial;
  const phase = pieces.length <= 10 || allMaterial <= 22 ? 2 : allMaterial <= 50 ? 1 : 0;
  const kingA = kings.w?.square ?? "";
  const kingB = kings.b?.square ?? "";
  const kingDistance = kingA && kingB ? Math.max(Math.abs(Number(kingA[1]) - Number(kingB[1])), Math.abs(FILES.indexOf(kingA[0]) - FILES.indexOf(kingB[0]))) : 0;
  set("materialBalance", whiteMaterial - blackMaterial);
  set("totalMaterial", allMaterial);
  set("materialDifferenceAbs", Math.abs(whiteMaterial - blackMaterial));
  set("totalPieces", pieces.length);
  set("totalPawns", totalPawns);
  set("openFiles", openFiles);
  set("whiteSemiOpenFiles", semiWhite);
  set("blackSemiOpenFiles", semiBlack);
  set("legalMoves", moves.length);
  set("checksAvailable", checks);
  set("capturesAvailable", captures);
  set("castlesAvailable", castles);
  set("promotionsAvailable", promotions);
  set("halfmoveClock", Number(chess.fen().split(/\s+/)[4] ?? 0));
  set("fullmoveNumber", Number(chess.fen().split(/\s+/)[5] ?? 1));
  set("phase", phase);
  set("kingDistance", kingDistance);
  set("whiteKingSideRights", rights.includes("K") || rights.includes("Q") ? 1 : 0);
  set("blackKingSideRights", rights.includes("k") || rights.includes("q") ? 1 : 0);
  set("castlingRightsTotal", rights === "-" ? 0 : rights.length);
  set("centerControlDifference", (facts.whiteCentralControl ?? 0) - (facts.blackCentralControl ?? 0));
  set("spaceDifference", (facts.whitePiecesEnemyHalf ?? 0) - (facts.blackPiecesEnemyHalf ?? 0));
  set("pawnCountDifference", (facts.whitePawns ?? 0) - (facts.blackPawns ?? 0));
  set("checkStatus", chess.isCheck() ? 1 : 0);
  set("checkmateStatus", chess.isCheckmate() ? 1 : 0);
  set("stalemateStatus", chess.isStalemate() ? 1 : 0);
  set("drawStatus", chess.isDraw() ? 1 : 0);
  set("insufficientMaterial", chess.isInsufficientMaterial() ? 1 : 0);
  set("whiteMaterialShare", allMaterial ? whiteMaterial / allMaterial : 0);
  set("blackMaterialShare", allMaterial ? blackMaterial / allMaterial : 0);
  set("materialParity", Math.abs(whiteMaterial - blackMaterial));
  set("centerControlTotal", (facts.whiteCentralControl ?? 0) + (facts.blackCentralControl ?? 0));
  set("extendedCenterTotal", (facts.whiteExtendedCenterControl ?? 0) + (facts.blackExtendedCenterControl ?? 0));
  set("whitePawnMajority", (facts.whitePawns ?? 0) - (facts.blackPawns ?? 0));
  set("blackPawnMajority", (facts.blackPawns ?? 0) - (facts.whitePawns ?? 0));
  set("kingsOnSameFile", kingA && kingB && kingA[0] === kingB[0] ? 1 : 0);
  set("kingsOnSameRank", kingA && kingB && kingA[1] === kingB[1] ? 1 : 0);
  return facts;
}
function makeSpec(id: string, category: string, title: string, key: string, direction: Direction, target: number, unit: string, description: string): MetricSpec {
  return { id, category, title, key, direction, target, unit, description };
}
function metricResult(spec: MetricSpec, facts: PositionFacts): DiagnosticResult {
  const value = facts[spec.key] ?? 0;
  let passed = true;
  if (spec.direction === "high") passed = value >= spec.target;
  else if (spec.direction === "low") passed = value <= spec.target;
  else if (spec.direction === "present") passed = value > 0;
  else if (spec.direction === "absent") passed = value === 0;
  else if (spec.direction === "balanced") passed = Math.abs(value) <= spec.target;
  const tone: DiagnosticTone = spec.direction === "info" ? "info" : passed ? "good" : "watch";
  const interpretation = spec.direction === "info" ? "Справочный показатель" : passed ? "Порог проверки выполнен" : "Стоит обратить внимание";
  const displayValue = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return { id: spec.id, category: spec.category, title: spec.title, description: spec.description, value, displayValue: displayValue + (spec.unit ? " " + spec.unit : ""), tone, interpretation };
}

// Ten independently callable checks are built for every category. Every evaluator closes over its own rule.
function buildMetric(spec: MetricSpec): (facts: PositionFacts) => DiagnosticResult {
  return (facts) => metricResult(spec, facts);
}
const CATEGORIES: Array<{ name: string; entries: Array<[string,string,Direction,number,string,string]> }> = [
  { name: "Материал", entries: [
    ["Материал белых","whiteMaterial","info",0,"п","Сумма условных очков фигур белых."],
    ["Материал чёрных","blackMaterial","info",0,"п","Сумма условных очков фигур чёрных."],
    ["Баланс материала","materialBalance","balanced",2,"п","Разница материального баланса; без учёта движковой компенсации."],
    ["Общий материал","totalMaterial","info",0,"п","Суммарный материал обеих сторон."],
    ["Абсолютная разница материала","materialDifferenceAbs","low",3,"п","Небольшой порог разницы материала."],
    ["Материальная доля белых","whiteMaterialShare","info",0,"%","Доля белых в общем материале."],
    ["Материальная доля чёрных","blackMaterialShare","info",0,"%","Доля чёрных в общем материале."],
    ["Материальное равновесие","materialParity","balanced",1,"п","Проверка близкого материального равенства."],
    ["Материал белых как преимущество","whiteMaterial","high",30,"п","Высокий абсолютный материал не гарантирует перевеса."],
    ["Материал чёрных как преимущество","blackMaterial","high",30,"п","Высокий абсолютный материал не гарантирует перевеса."]
  ]},
  { name: "Баланс фигур", entries: [
    ["Пешки белых","whitePawns","info",0,"шт.","Количество пешек белых."],["Пешки чёрных","blackPawns","info",0,"шт.","Количество пешек чёрных."],
    ["Кони белых","whiteKnights","info",0,"шт.","Количество коней белых."],["Кони чёрных","blackKnights","info",0,"шт.","Количество коней чёрных."],
    ["Слоны белых","whiteBishops","info",0,"шт.","Количество слонов белых."],["Слоны чёрных","blackBishops","info",0,"шт.","Количество слонов чёрных."],
    ["Ладьи белых","whiteRooks","info",0,"шт.","Количество ладей белых."],["Ладьи чёрных","blackRooks","info",0,"шт.","Количество ладей чёрных."],
    ["Ферзи белых","whiteQueens","info",0,"шт.","Количество ферзей белых."],["Ферзи чёрных","blackQueens","info",0,"шт.","Количество ферзей чёрных."]
  ]},
  { name: "Безопасность короля", entries: [
    ["Атаки на короля белых","whiteKingAttackers","low",0,"ат.","Количество атакующих на поле короля белых."],["Атаки на короля чёрных","blackKingAttackers","low",0,"ат.","Количество атакующих на поле короля чёрных."],
    ["Давление вокруг белого короля","whiteKingZonePressure","low",2,"кл.","Контролируемые противником клетки в зоне белого короля."],["Давление вокруг чёрного короля","blackKingZonePressure","low",2,"кл.","Контролируемые противником клетки в зоне чёрного короля."],
    ["Пешечный щит белого короля","whiteKingShield","high",2,"п.","Пешки перед королём на соседних вертикалях."],["Пешечный щит чёрного короля","blackKingShield","high",2,"п.","Пешки перед королём на соседних вертикалях."],
    ["Король белых под шахом","whiteKingInCheck","absent",0,"","Факт шаха белому королю по карте атак."],["Король чёрных под шахом","blackKingInCheck","absent",0,"","Факт шаха чёрному королю по карте атак."],
    ["Поля отхода белого короля","whiteKingEscapeSquares","high",2,"кл.","Псевдолегальные соседние клетки, без полной проверки шаха."],["Поля отхода чёрного короля","blackKingEscapeSquares","high",2,"кл.","Псевдолегальные соседние клетки, без полной проверки шаха."]
  ]},
  { name: "Центр", entries: [
    ["Контроль центра белыми","whiteCentralControl","high",2,"кл.","Белые атакуют клетки d4, e4, d5, e5."],["Контроль центра чёрными","blackCentralControl","high",2,"кл.","Чёрные атакуют клетки d4, e4, d5, e5."],
    ["Расширенный центр белых","whiteExtendedCenterControl","high",6,"кл.","Контроль расширенного центрального квадрата."],["Расширенный центр чёрных","blackExtendedCenterControl","high",6,"кл.","Контроль расширенного центрального квадрата."],
    ["Пешки белых в центре","whiteCenterPawns","high",1,"п.","Пешки белых на четырёх центральных клетках."],["Пешки чёрных в центре","blackCenterPawns","high",1,"п.","Пешки чёрных на четырёх центральных клетках."],
    ["Общий контроль центра","centerControlTotal","high",4,"кл.","Сколько центральных клеток атакуется хотя бы одной стороной."],["Разница контроля центра","centerControlDifference","balanced",1,"кл.","Разница количества центральных клеток под контролем."],
    ["Контроль центра d4 белыми","whiteCentralControl","info",0,"кл.","Сводный показатель центрального контроля белых."],["Контроль центра d4 чёрными","blackCentralControl","info",0,"кл.","Сводный показатель центрального контроля чёрных."]
  ]},
  { name: "Подвижность", entries: [
    ["Легальные ходы","legalMoves","high",20,"ход.","Количество легальных ходов стороны, чей сейчас ход."],["Псевдоподвижность белых","whitePseudoMobility","high",25,"ат.","Количество атак белых фигур."],
    ["Псевдоподвижность чёрных","blackPseudoMobility","high",25,"ат.","Количество атак чёрных фигур."],["Контролируемые поля белых","whiteControlledSquares","high",20,"кл.","Уникальные поля, атакуемые белыми."],
    ["Контролируемые поля чёрных","blackControlledSquares","high",20,"кл.","Уникальные поля, атакуемые чёрными."],["Доступные взятия","capturesAvailable","info",0,"ход.","Легальные взятия для текущей стороны."],
    ["Шахующие ходы","checksAvailable","info",0,"ход.","Легальные шахи для текущей стороны."],["Возможные рокировки","castlesAvailable","info",0,"ход.","Легальные короткие и длинные рокировки текущей стороны."],
    ["Возможные превращения","promotionsAvailable","info",0,"ход.","Легальные ходы превращения текущей стороны."],["Разница контроля полей","spaceDifference","balanced",4,"кл.","Разница фигур в половинах противника."]
  ]},
  { name: "Пешечная структура", entries: [
    ["Сдвоенные пешки белых","whiteDoubledPawns","low",1,"п.","Избыточные пешки на одной вертикали."],["Сдвоенные пешки чёрных","blackDoubledPawns","low",1,"п.","Избыточные пешки на одной вертикали."],
    ["Изолированные пешки белых","whiteIsolatedPawns","low",2,"п.","Пешки без соседних пешек на соседних вертикалях."],["Изолированные пешки чёрных","blackIsolatedPawns","low",2,"п.","Пешки без соседних пешек на соседних вертикалях."],
    ["Связанные пешки белых","whiteConnectedPawns","high",3,"п.","Пешки рядом по диагонали или вертикали."],["Связанные пешки чёрных","blackConnectedPawns","high",3,"п.","Пешки рядом по диагонали или вертикали."],
    ["Пешечные цепи белых","whitePawnChains","high",2,"п.","Пешки, поддерживающие друг друга по диагонали."],["Пешечные цепи чёрных","blackPawnChains","high",2,"п.","Пешки, поддерживающие друг друга по диагонали."],
    ["Пешечные острова белых","whitePawnIslands","low",3,"остр.","Группы пешек, разделённые пустыми вертикалями."],["Пешечные острова чёрных","blackPawnIslands","low",3,"остр.","Группы пешек, разделённые пустыми вертикалями."]
  ]},
  { name: "Проходные пешки", entries: [
    ["Проходные пешки белых","whitePassedPawns","present",0,"п.","На пути к превращению нет вражеских пешек на соседних вертикалях."],["Проходные пешки чёрных","blackPassedPawns","present",0,"п.","На пути к превращению нет вражеских пешек на соседних вертикалях."],
    ["Продвинутые пешки белых","whiteAdvancedPawns","high",2,"п.","Белые пешки достигли пятой горизонтали или дальше."],["Продвинутые пешки чёрных","blackAdvancedPawns","high",2,"п.","Чёрные пешки достигли четвёртой горизонтали или дальше."],
    ["Продвинутые проходные белых","whiteAdvancedPassedPawns","present",0,"п.","Далеко продвинутые проходные пешки белых."],["Продвинутые проходные чёрных","blackAdvancedPassedPawns","present",0,"п.","Далеко продвинутые проходные пешки чёрных."],
    ["Слабые пешки белых","whiteBackwardPawns","low",1,"п.","Приближённая оценка неподдержанных пешек под контролем соперника."],["Слабые пешки чёрных","blackBackwardPawns","low",1,"п.","Приближённая оценка неподдержанных пешек под контролем соперника."],
    ["Пешечное продвижение белых","whitePawnAdvanceTotal","high",8,"п.","Сумма продвижения пешек от стартовой горизонтали."],["Пешечное продвижение чёрных","blackPawnAdvanceTotal","high",8,"п.","Сумма продвижения пешек от стартовой горизонтали."]
  ]},
  { name: "Активность ладей", entries: [
    ["Подвижность ладей белых","whiteRookMobility","high",8,"ат.","Поля, атакуемые ладьями белых."],["Подвижность ладей чёрных","blackRookMobility","high",8,"ат.","Поля, атакуемые ладьями чёрных."],
    ["Ладьи белых на открытых линиях","whiteRooksOnOpenFiles","present",0,"шт.","Ладьи на вертикалях без пешек."],["Ладьи чёрных на открытых линиях","blackRooksOnOpenFiles","present",0,"шт.","Ладьи на вертикалях без пешек."],
    ["Ладьи белых на полуоткрытых линиях","whiteRooksOnSemiOpenFiles","present",0,"шт.","Ладьи на вертикалях без своих пешек."],["Ладьи чёрных на полуоткрытых линиях","blackRooksOnSemiOpenFiles","present",0,"шт.","Ладьи на вертикалях без своих пешек."],
    ["Связанные ладьи белых","whiteConnectedRooks","present",0,"пара","Ладьи на одной линии без блокирующей фигуры."],["Связанные ладьи чёрных","blackConnectedRooks","present",0,"пара","Ладьи на одной линии без блокирующей фигуры."],
    ["Ладьи белых на седьмой","whiteSeventhRankPieces","present",0,"шт.","Тяжёлые и лёгкие фигуры на седьмой горизонтали."],["Ладьи чёрных на седьмой","blackSeventhRankPieces","present",0,"шт.","Тяжёлые и лёгкие фигуры на второй горизонтали."]
  ]},
  { name: "Активность слонов", entries: [
    ["Пара слонов белых","whiteBishopPair","present",0,"пара","Наличие двух слонов."],["Пара слонов чёрных","blackBishopPair","present",0,"пара","Наличие двух слонов."],
    ["Подвижность слонов белых","whiteBishopMobility","high",8,"ат.","Суммарные псевдолегальные атаки слонов."],["Подвижность слонов чёрных","blackBishopMobility","high",8,"ат.","Суммарные псевдолегальные атаки слонов."],
    ["Слоны белых на длинных диагоналях","whiteLongDiagonalBishops","present",0,"шт.","Слоны с длинной линией атаки."],["Слоны чёрных на длинных диагоналях","blackLongDiagonalBishops","present",0,"шт.","Слоны с длинной линией атаки."],
    ["Светлопольные слоны белых","whiteLightBishops","info",0,"шт.","Слоны белых на светлых клетках."],["Темнопольные слоны белых","whiteDarkBishops","info",0,"шт.","Слоны белых на тёмных клетках."],
    ["Светлопольные слоны чёрных","blackLightBishops","info",0,"шт.","Слоны чёрных на светлых клетках."],["Темнопольные слоны чёрных","blackDarkBishops","info",0,"шт.","Слоны чёрных на тёмных клетках."]
  ]},
  { name: "Активность коней", entries: [
    ["Подвижность коней белых","whiteKnightMobility","high",6,"ат.","Поля под атакой коней белых."],["Подвижность коней чёрных","blackKnightMobility","high",6,"ат.","Поля под атакой коней чёрных."],
    ["Центральность коней белых","whiteKnightCentrality","high",2,"балл","Близость коней к центру доски."],["Центральность коней чёрных","blackKnightCentrality","high",2,"балл","Близость коней к центру доски."],
    ["Коневые форпосты белых","whiteKnightOutposts","present",0,"шт.","Продвинутые защищённые кони, которые трудно прогнать пешками."],["Коневые форпосты чёрных","blackKnightOutposts","present",0,"шт.","Продвинутые защищённые кони, которые трудно прогнать пешками."],
    ["Число коней белых","whiteKnights","info",0,"шт.","Количество коней."],["Число коней чёрных","blackKnights","info",0,"шт.","Количество коней."],
    ["Коней белых в половине соперника","whitePiecesEnemyHalf","info",0,"шт.","Фигуры белых на половине чёрных."],["Коней чёрных в половине соперника","blackPiecesEnemyHalf","info",0,"шт.","Фигуры чёрных на половине белых."]
  ]},
  { name: "Активность ферзей", entries: [
    ["Подвижность ферзя белых","whiteQueenMobility","high",8,"ат.","Поля под атакой ферзя белых."],["Подвижность ферзя чёрных","blackQueenMobility","high",8,"ат.","Поля под атакой ферзя чёрных."],
    ["Ферзи белых в центре","whiteQueenInCenter","info",0,"шт.","Ферзи на центральных и прилегающих клетках."],["Ферзи чёрных в центре","blackQueenInCenter","info",0,"шт.","Ферзи на центральных и прилегающих клетках."],
    ["Ферзь белых под атакой","whiteThreatsOnQueen","low",0,"шт.","Ферзи белых, атакованные соперником."],["Ферзь чёрных под атакой","blackThreatsOnQueen","low",0,"шт.","Ферзи чёрных, атакованные соперником."],
    ["Наличие ферзя белых","whiteQueens","info",0,"шт.","Количество ферзей белых."],["Наличие ферзя чёрных","blackQueens","info",0,"шт.","Количество ферзей чёрных."],
    ["Тяжёлые фигуры белых","whiteMajorCount","info",0,"шт.","Ферзи и ладьи белых."],["Тяжёлые фигуры чёрных","blackMajorCount","info",0,"шт.","Ферзи и ладьи чёрных."]
  ]},
  { name: "Развитие фигур", entries: [
    ["Развитые лёгкие фигуры белых","whiteDevelopment","high",2,"шт.","Лёгкие фигуры, ушедшие с начальных полей (приближённо)."],["Развитые лёгкие фигуры чёрных","blackDevelopment","high",2,"шт.","Лёгкие фигуры, ушедшие с начальных полей (приближённо)."],
    ["Неразвитые лёгкие фигуры белых","whiteUndevelopedMinors","low",1,"шт.","Лёгкие фигуры на типичных начальных клетках."],["Неразвитые лёгкие фигуры чёрных","blackUndevelopedMinors","low",1,"шт.","Лёгкие фигуры на типичных начальных клетках."],
    ["Число лёгких фигур белых","whiteMinorCount","info",0,"шт.","Слоны и кони белых."],["Число лёгких фигур чёрных","blackMinorCount","info",0,"шт.","Слоны и кони чёрных."],
    ["Права рокировки белых","whiteKingSideRights","present",0,"","Права короткой или длинной рокировки."],["Права рокировки чёрных","blackKingSideRights","present",0,"","Права короткой или длинной рокировки."],
    ["Права рокировки всего","castlingRightsTotal","info",0,"шт.","Количество букв прав рокировки в FEN."],["Номер полного хода","fullmoveNumber","info",0,"ход.","Номер полного хода из FEN."]
  ]},
  { name: "Пространство", entries: [
    ["Фигуры белых на половине чёрных","whitePiecesEnemyHalf","high",3,"шт.","Количество фигур белых в лагере чёрных."],["Фигуры чёрных на половине белых","blackPiecesEnemyHalf","high",3,"шт.","Количество фигур чёрных в лагере белых."],
    ["Активность белых","whitePieceActivity","high",3,"балл","Сумма продвижения, вторжения и форпостов."],["Активность чёрных","blackPieceActivity","high",3,"балл","Сумма продвижения, вторжения и форпостов."],
    ["Контролируемые поля белых","whiteControlledSquares","high",20,"кл.","Псевдолегальный контроль белых."],["Контролируемые поля чёрных","blackControlledSquares","high",20,"кл.","Псевдолегальный контроль чёрных."],
    ["Преимущество пространства белых","spaceDifference","high",2,"балл","Фигуры в лагере соперника, разница белых минус чёрные."],["Преимущество пространства чёрных","spaceDifference","low",-2,"балл","Отрицательная разница пространства означает перевес чёрных."],
    ["Продвижение пешек белых","whitePawnAdvanceTotal","info",0,"п.","Сумма шагов пешек от стартовой позиции."],["Продвижение пешек чёрных","blackPawnAdvanceTotal","info",0,"п.","Сумма шагов пешек от стартовой позиции."]
  ]},
  { name: "Тактические цели", entries: [
    ["Атакованные фигуры белых","whiteAttackedPieces","low",1,"шт.","Фигуры белых под атакой чёрных."],["Атакованные фигуры чёрных","blackAttackedPieces","low",1,"шт.","Фигуры чёрных под атакой белых."],
    ["Висящие фигуры белых","whiteHangingPieces","low",0,"шт.","Атакованные фигуры без псевдозащитника."],["Висящие фигуры чёрных","blackHangingPieces","low",0,"шт.","Атакованные фигуры без псевдозащитника."],
    ["Ферзи белых под боем","whiteThreatsOnQueen","low",0,"шт.","Ферзи белых атакованы."],["Ферзи чёрных под боем","blackThreatsOnQueen","low",0,"шт.","Ферзи чёрных атакованы."],
    ["Шахи текущей стороны","checksAvailable","info",0,"ход.","Сколько легальных шахов доступно."],["Взятия текущей стороны","capturesAvailable","info",0,"ход.","Сколько легальных взятий доступно."],
    ["Возможности превращения","promotionsAvailable","info",0,"ход.","Сколько превращений доступно."],["Ходы с тактическим темпом","checksAvailable","present",0,"ход.","Наличие легального шахующего хода."]
  ]},
  { name: "Защита фигур", entries: [
    ["Защищённые фигуры белых","whiteDefendedPieces","high",4,"шт.","Фигуры белых под защитой своих фигур."],["Защищённые фигуры чёрных","blackDefendedPieces","high",4,"шт.","Фигуры чёрных под защитой своих фигур."],
    ["Доля защищённых фигур белых","whiteDefendersPerPiece","high",0.35,"","Доля фигур, имеющих хотя бы одного псевдозащитника."],["Доля защищённых фигур чёрных","blackDefendersPerPiece","high",0.35,"","Доля фигур, имеющих хотя бы одного псевдозащитника."],
    ["Висящие белые фигуры","whiteHangingPieces","low",0,"шт.","Фигуры без псевдозащиты под ударом."],["Висящие чёрные фигуры","blackHangingPieces","low",0,"шт.","Фигуры без псевдозащиты под ударом."],
    ["Поддержанные пешки белых","whiteConnectedPawns","high",3,"п.","Соседние пешки, способные поддерживать структуру."],["Поддержанные пешки чёрных","blackConnectedPawns","high",3,"п.","Соседние пешки, способные поддерживать структуру."],
    ["Пешечные цепи белых","whitePawnChains","high",2,"п.","Пешки поддерживаются диагонально."],["Пешечные цепи чёрных","blackPawnChains","high",2,"п.","Пешки поддерживаются диагонально."]
  ]},
  { name: "Открытые линии", entries: [
    ["Открытые вертикали","openFiles","info",0,"шт.","Вертикали без пешек обеих сторон."],["Полуоткрытые вертикали белых","whiteSemiOpenFiles","info",0,"шт.","Вертикали без белых пешек, но с чёрными."],
    ["Полуоткрытые вертикали чёрных","blackSemiOpenFiles","info",0,"шт.","Вертикали без чёрных пешек, но с белыми."],["Ладьи белых на открытых линиях","whiteRooksOnOpenFiles","present",0,"шт.","Ладьи белых на открытых вертикалях."],
    ["Ладьи чёрных на открытых линиях","blackRooksOnOpenFiles","present",0,"шт.","Ладьи чёрных на открытых вертикалях."],["Ладьи белых на полуоткрытых линиях","whiteRooksOnSemiOpenFiles","present",0,"шт.","Ладьи белых на полуоткрытых вертикалях."],
    ["Ладьи чёрных на полуоткрытых линиях","blackRooksOnSemiOpenFiles","present",0,"шт.","Ладьи чёрных на полуоткрытых вертикалях."],["Ферзь и ладьи белых на открытых линиях","whiteOpenFileControl","present",0,"шт.","Тяжёлые фигуры белых занимают открытые вертикали."],
    ["Ферзь и ладьи чёрных на открытых линиях","blackOpenFileControl","present",0,"шт.","Тяжёлые фигуры чёрных занимают открытые вертикали."],["Ферзь и ладьи белых на полуоткрытых","whiteSemiOpenFileControl","present",0,"шт.","Тяжёлые фигуры белых занимают полуоткрытые вертикали."]
  ]},
  { name: "Диагонали", entries: [
    ["Подвижность слонов белых","whiteBishopMobility","high",8,"ат.","Суммарные линии атаки слонов белых."],["Подвижность слонов чёрных","blackBishopMobility","high",8,"ат.","Суммарные линии атаки слонов чёрных."],
    ["Длинные диагонали белых","whiteLongDiagonalBishops","present",0,"шт.","Слон атакует много клеток по диагоналям."],["Длинные диагонали чёрных","blackLongDiagonalBishops","present",0,"шт.","Слон атакует много клеток по диагоналям."],
    ["Поля под контролем белых","whiteControlledSquares","high",20,"кл.","Все типы атак белых, не только диагонали."],["Поля под контролем чёрных","blackControlledSquares","high",20,"кл.","Все типы атак чёрных, не только диагонали."],
    ["Слоны белых на светлых клетках","whiteLightBishops","info",0,"шт.","Расположение слонов по цвету клеток."],["Слоны белых на тёмных клетках","whiteDarkBishops","info",0,"шт.","Расположение слонов по цвету клеток."],
    ["Слоны чёрных на светлых клетках","blackLightBishops","info",0,"шт.","Расположение слонов по цвету клеток."],["Слоны чёрных на тёмных клетках","blackDarkBishops","info",0,"шт.","Расположение слонов по цвету клеток."]
  ]},
  { name: "Цветовые комплексы", entries: [
    ["Фигуры белых на светлых клетках","whiteLightSquarePieces","info",0,"шт.","Фигуры белых на светлых полях."],["Фигуры белых на тёмных клетках","whiteDarkSquarePieces","info",0,"шт.","Фигуры белых на тёмных полях."],
    ["Фигуры чёрных на светлых клетках","blackLightSquarePieces","info",0,"шт.","Фигуры чёрных на светлых полях."],["Фигуры чёрных на тёмных клетках","blackDarkSquarePieces","info",0,"шт.","Фигуры чёрных на тёмных полях."],
    ["Слоны белых по светлым полям","whiteLightBishops","info",0,"шт.","Количество светлопольных слонов."],["Слоны белых по тёмным полям","whiteDarkBishops","info",0,"шт.","Количество темнопольных слонов."],
    ["Слоны чёрных по светлым полям","blackLightBishops","info",0,"шт.","Количество светлопольных слонов."],["Слоны чёрных по тёмным полям","blackDarkBishops","info",0,"шт.","Количество темнопольных слонов."],
    ["Материал белых на светлопольной сетке","whiteLightSquarePieces","info",0,"шт.","Распределение фигур белых по цвету клеток."],["Материал чёрных на темнопольной сетке","blackDarkSquarePieces","info",0,"шт.","Распределение фигур чёрных по цвету клеток."]
  ]},
  { name: "Атака на короля", entries: [
    ["Фигуры белых рядом с королём чёрных","whiteKingZonePressure","high",2,"кл.","Вражеский контроль зоны короля чёрных."],["Фигуры чёрных рядом с королём белых","blackKingZonePressure","high",2,"кл.","Вражеский контроль зоны короля белых."],
    ["Атакующие на короля чёрных","blackKingAttackers","present",0,"ат.","Количество атакующих белых на поле чёрного короля."],["Атакующие на короля белых","whiteKingAttackers","present",0,"ат.","Количество атакующих чёрных на поле белого короля."],
    ["Щит короля чёрных","blackKingShield","high",2,"п.","Пешечная защита короля."],["Щит короля белых","whiteKingShield","high",2,"п.","Пешечная защита короля."],
    ["Белые создают шах","checksAvailable","present",0,"ход.","Наличие легального шахующего хода белых, если сейчас их очередь."],["Чёрные создают шах","checksAvailable","info",0,"ход.","Показатель шахующих ходов текущей стороны."],
    ["Король чёрных в шахе","blackKingInCheck","absent",0,"","Проверка прямой атаки на короля чёрных."],["Король белых в шахе","whiteKingInCheck","absent",0,"","Проверка прямой атаки на короля белых."]
  ]},
  { name: "Королевские пешки", entries: [
    ["Пешки вокруг белого короля","whiteKingFilePawns","high",2,"п.","Пешки на соседних вертикалях короля белых."],["Пешки вокруг чёрного короля","blackKingFilePawns","high",2,"п.","Пешки на соседних вертикалях короля чёрных."],
    ["Пешечный щит белых","whiteKingShield","high",2,"п.","Пешки перед белым королём."],["Пешечный щит чёрных","blackKingShield","high",2,"п.","Пешки перед чёрным королём."],
    ["Атакованные пешки белых","whiteAttackedPawns","low",2,"п.","Пешки белых, атакованные чёрными."],["Атакованные пешки чёрных","blackAttackedPawns","low",2,"п.","Пешки чёрных, атакованные белыми."],
    ["Изолированные пешки белых","whiteIsolatedPawns","low",2,"п.","Одиночные пешки белых на вертикалях."],["Изолированные пешки чёрных","blackIsolatedPawns","low",2,"п.","Одиночные пешки чёрных на вертикалях."],
    ["Сдвоенные пешки белых","whiteDoubledPawns","low",1,"п.","Избыточное число пешек на файле."],["Сдвоенные пешки чёрных","blackDoubledPawns","low",1,"п.","Избыточное число пешек на файле."]
  ]},
  { name: "Эндшпиль", entries: [
    ["Фаза партии","phase","info",0,"код","0 — дебют/миттельшпиль, 1 — упрощение, 2 — эндшпиль."],["Материал белых","whiteMaterial","info",0,"п.","Материальный итог белых."],
    ["Материал чёрных","blackMaterial","info",0,"п.","Материальный итог чёрных."],["Дистанция между королями","kingDistance","info",0,"кл.","Расстояние королей по метрике короля."],
    ["Проходные пешки белых","whitePassedPawns","present",0,"п.","Кандидаты в проходные пешки белых."],["Проходные пешки чёрных","blackPassedPawns","present",0,"п.","Кандидаты в проходные пешки чёрных."],
    ["Материал пешек белых","whitePawns","info",0,"шт.","Количество пешек белых."],["Материал пешек чёрных","blackPawns","info",0,"шт.","Количество пешек чёрных."],
    ["Недостаточный материал","insufficientMaterial","info",0,"","Автоматическая проверка chess.js."],["Часы правила 50 ходов","halfmoveClock","low",80,"полуход.","Полусчётчик FEN; ничья по 50 ходам возможна от 100."]
  ]},
  { name: "Размены", entries: [
    ["Материальный баланс","materialBalance","balanced",2,"п.","Материальная разница."],["Разница числа пешек","pawnCountDifference","balanced",1,"п.","Пешечная разница белых и чёрных."],
    ["Разница числа лёгких фигур","minorDifference","balanced",1,"шт.","Баланс слонов и коней."],["Разница числа тяжёлых фигур","majorDifference","balanced",1,"шт.","Баланс ладей и ферзей."],
    ["Ферзи белых","whiteQueens","info",0,"шт.","Ферзи белых."],["Ферзи чёрных","blackQueens","info",0,"шт.","Ферзи чёрных."],
    ["Сумма ладей","totalRooks","info",0,"шт.","Общее число ладей."],["Сумма слонов","totalBishops","info",0,"шт.","Общее число слонов."],
    ["Сумма коней","totalKnights","info",0,"шт.","Общее число коней."],["Общее число фигур","totalPieces","info",0,"шт.","Количество всех фигур на доске."]
  ]},
  { name: "Потенциал превращения", entries: [
    ["Продвинутые пешки белых","whiteAdvancedPawns","present",0,"п.","Белые пешки на пятой горизонтали или дальше."],["Продвинутые пешки чёрных","blackAdvancedPawns","present",0,"п.","Чёрные пешки на четвёртой горизонтали или дальше."],
    ["Проходные пешки белых","whitePassedPawns","present",0,"п.","Потенциальные кандидаты на проход."],["Проходные пешки чёрных","blackPassedPawns","present",0,"п.","Потенциальные кандидаты на проход."],
    ["Продвинутые проходные белых","whiteAdvancedPassedPawns","present",0,"п.","Продвинутые проходные белых."],["Продвинутые проходные чёрных","blackAdvancedPassedPawns","present",0,"п.","Продвинутые проходные чёрных."],
    ["Легальные превращения текущей стороны","promotionsAvailable","present",0,"ход.","Ходы превращения, легальные прямо сейчас."],["Пешечный перевес белых","whitePawnMajority","high",1,"п.","Материальный перевес по количеству пешек."],
    ["Пешечный перевес чёрных","blackPawnMajority","high",1,"п.","Материальный перевес по количеству пешек."],["Разница пешек","pawnCountDifference","balanced",1,"п.","Пешечная разница."]
  ]},
  { name: "Шахи и темп", entries: [
    ["Легальные шахи","checksAvailable","info",0,"ход.","Количество шахующих ходов."],["Шах текущей стороне","checkStatus","info",0,"","Текущая сторона под шахом."],
    ["Мат текущей стороне","checkmateStatus","info",0,"","Проверка мата."],["Пат","stalemateStatus","info",0,"","Проверка пата."],
    ["Легальные взятия","capturesAvailable","info",0,"ход.","Сколько взятий доступно."],["Полуходы без взятия/пешки","halfmoveClock","info",0,"полуход.","FEN halfmove clock."],
    ["Номер хода","fullmoveNumber","info",0,"ход.","FEN fullmove number."],["Рокировки сейчас","castlesAvailable","info",0,"ход.","Рокировки, разрешённые текущему игроку."],
    ["Возможные превращения","promotionsAvailable","info",0,"ход.","Превращения в текущей позиции."],["Ходы текущей стороны","legalMoves","info",0,"ход.","Число легальных продолжений."]
  ]},
  { name: "Позиционная целостность", entries: [
    ["Игра завершена матом","checkmateStatus","info",0,"","Терминальное состояние."],["Позиция патовая","stalemateStatus","info",0,"","Терминальное состояние."],
    ["Ничья по правилам","drawStatus","info",0,"","chess.js сообщает ничью."],["Недостаточный материал","insufficientMaterial","info",0,"","Проверка недостаточного материала."],
    ["Короли на одной вертикали","kingsOnSameFile","info",0,"","Геометрическое расположение королей."],["Короли на одной горизонтали","kingsOnSameRank","info",0,"","Геометрическое расположение королей."],
    ["Всего фигур","totalPieces","info",0,"шт.","Материальный состав доски."],["Всего пешек","totalPawns","info",0,"шт.","Число пешек."],
    ["Права рокировки","castlingRightsTotal","info",0,"шт.","Права рокировки из FEN."],["Счётчик правила 50 ходов","halfmoveClock","info",0,"полуход.","Полусчётчик из FEN."]
  ]},
  { name: "Слабости позиции", entries: [
    ["Висящие фигуры белых","whiteHangingPieces","low",0,"шт.","Атака соперника при отсутствии псевдозащитника."],["Висящие фигуры чёрных","blackHangingPieces","low",0,"шт.","Атака соперника при отсутствии псевдозащитника."],
    ["Изолированные пешки белых","whiteIsolatedPawns","low",1,"п.","Изолированные пешки белых."],["Изолированные пешки чёрных","blackIsolatedPawns","low",1,"п.","Изолированные пешки чёрных."],
    ["Сдвоенные пешки белых","whiteDoubledPawns","low",1,"п.","Сдвоенные пешки белых."],["Сдвоенные пешки чёрных","blackDoubledPawns","low",1,"п.","Сдвоенные пешки чёрных."],
    ["Отсталые пешки белых","whiteBackwardPawns","low",1,"п.","Эвристическая оценка отсталых пешек."],["Отсталые пешки чёрных","blackBackwardPawns","low",1,"п.","Эвристическая оценка отсталых пешек."],
    ["Атакованные фигуры белых","whiteAttackedPieces","low",1,"шт.","Фигуры белых под атакой."],["Атакованные фигуры чёрных","blackAttackedPieces","low",1,"шт.","Фигуры чёрных под атакой."]
  ]},
  { name: "Фигурная координация", entries: [
    ["Защищённые фигуры белых","whiteDefendedPieces","high",4,"шт.","Фигуры белых под защитой."],["Защищённые фигуры чёрных","blackDefendedPieces","high",4,"шт.","Фигуры чёрных под защитой."],
    ["Связанные ладьи белых","whiteConnectedRooks","present",0,"пара","Ладьи имеют линию связи."],["Связанные ладьи чёрных","blackConnectedRooks","present",0,"пара","Ладьи имеют линию связи."],
    ["Активность белых фигур","whitePieceActivity","high",3,"балл","Вторжение, седьмая горизонталь и форпосты."],["Активность чёрных фигур","blackPieceActivity","high",3,"балл","Вторжение, седьмая горизонталь и форпосты."],
    ["Псевдоподвижность белых","whitePseudoMobility","high",25,"ат.","Сумма атак фигур."],["Псевдоподвижность чёрных","blackPseudoMobility","high",25,"ат.","Сумма атак фигур."],
    ["Контроль полуоткрытых линий белыми","whiteSemiOpenFileControl","present",0,"шт.","Тяжёлые фигуры на полуоткрытых линиях."],["Контроль полуоткрытых линий чёрными","blackSemiOpenFileControl","present",0,"шт.","Тяжёлые фигуры на полуоткрытых линиях."]
  ]},
  { name: "Атакованные поля", entries: [
    ["Белые контролируют центр","whiteCentralControl","high",2,"кл.","Центральные поля под контролем белых."],["Чёрные контролируют центр","blackCentralControl","high",2,"кл.","Центральные поля под контролем чёрных."],
    ["Белые контролируют пространство","whiteControlledSquares","high",20,"кл.","Уникальные поля под атакой белых."],["Чёрные контролируют пространство","blackControlledSquares","high",20,"кл.","Уникальные поля под атакой чёрных."],
    ["Белые контролируют расширенный центр","whiteExtendedCenterControl","high",6,"кл.","Контроль расширенного центра."],["Чёрные контролируют расширенный центр","blackExtendedCenterControl","high",6,"кл.","Контроль расширенного центра."],
    ["Разница контроля центра","centerControlDifference","balanced",2,"кл.","Баланс центральных клеток."],["Суммарный контроль центра","centerControlTotal","info",0,"кл.","Общий центральный контроль."],
    ["Фигуры белых в лагере чёрных","whitePiecesEnemyHalf","info",0,"шт.","Вторжение."],["Фигуры чёрных в лагере белых","blackPiecesEnemyHalf","info",0,"шт.","Вторжение."]
  ]},
  { name: "Пешечные фланги", entries: [
    ["Пешки белых на королевском фланге","whiteKingFilePawns","info",0,"п.","Пешки вокруг короля белых, приближённая оценка."],["Пешки чёрных на королевском фланге","blackKingFilePawns","info",0,"п.","Пешки вокруг короля чёрных, приближённая оценка."],
    ["Пешки белых на центральных клетках","whiteCenterPawns","info",0,"п.","Центральное пешечное присутствие."],["Пешки чёрных на центральных клетках","blackCenterPawns","info",0,"п.","Центральное пешечное присутствие."],
    ["Пешечные острова белых","whitePawnIslands","low",3,"остр.","Сгруппированность пешек."],["Пешечные острова чёрных","blackPawnIslands","low",3,"остр.","Сгруппированность пешек."],
    ["Изоляция пешек белых","whiteIsolatedPawns","low",1,"п.","Слабость фланговой структуры."],["Изоляция пешек чёрных","blackIsolatedPawns","low",1,"п.","Слабость фланговой структуры."],
    ["Пешечное большинство белых","whitePawnMajority","high",1,"п.","Количество пешек сверх числа пешек соперника."],["Пешечное большинство чёрных","blackPawnMajority","high",1,"п.","Количество пешек сверх числа пешек соперника."]
  ]},
  { name: "Короли в эндшпиле", entries: [
    ["Дистанция королей","kingDistance","info",0,"кл.","Королевская метрика расстояния."],["Пешки белых","whitePawns","info",0,"шт.","Число пешек белых."],
    ["Пешки чёрных","blackPawns","info",0,"шт.","Число пешек чёрных."],["Материал белых","whiteMaterial","info",0,"п.","Оценка материала."],
    ["Материал чёрных","blackMaterial","info",0,"п.","Оценка материала."],["Фаза эндшпиля","phase","info",0,"код","Приближённый показатель упрощения."],
    ["Король белых имеет выходы","whiteKingEscapeSquares","high",2,"кл.","Соседние клетки до строгой проверки легальности."],["Король чёрных имеет выходы","blackKingEscapeSquares","high",2,"кл.","Соседние клетки до строгой проверки легальности."],
    ["Проходные пешки белых","whitePassedPawns","present",0,"п.","Потенциальные проходные."],["Проходные пешки чёрных","blackPassedPawns","present",0,"п.","Потенциальные проходные."]
  ]},

];

const SPECS: MetricSpec[] = [];
for (const group of CATEGORIES) {
  for (let index = 0; index < group.entries.length; index += 1) {
    const [title, key, direction, target, unit, description] = group.entries[index];
    SPECS.push(makeSpec(group.name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-") + "-" + (index + 1), group.name, title, key, direction, target, unit, description));
  }
}
const ALIASES: Record<string,string> = {
  whiteLightSquarePieces: "whiteLightBishops", whiteDarkSquarePieces: "whiteDarkBishops",
  blackLightSquarePieces: "blackLightBishops", blackDarkSquarePieces: "blackDarkBishops",
  whiteAttackedPawns: "whiteAttackedPieces", blackAttackedPawns: "blackAttackedPieces",
  minorDifference: "whiteMinorCount", majorDifference: "whiteMajorCount",
  totalRooks: "whiteRooks", totalBishops: "whiteBishops", totalKnights: "whiteKnights",
};
function normalizeFacts(facts: PositionFacts): PositionFacts {
  const result = { ...facts };
  for (const [alias,key] of Object.entries(ALIASES)) result[alias] = facts[key] ?? 0;
  result.minorDifference = (facts.whiteMinorCount ?? 0) - (facts.blackMinorCount ?? 0);
  result.majorDifference = (facts.whiteMajorCount ?? 0) - (facts.blackMajorCount ?? 0);
  result.totalRooks = (facts.whiteRooks ?? 0) + (facts.blackRooks ?? 0);
  result.totalBishops = (facts.whiteBishops ?? 0) + (facts.blackBishops ?? 0);
  result.totalKnights = (facts.whiteKnights ?? 0) + (facts.blackKnights ?? 0);
  result.whiteLightSquarePieces = facts.whiteLightBishops ?? 0;
  result.whiteDarkSquarePieces = facts.whiteDarkBishops ?? 0;
  result.blackLightSquarePieces = facts.blackLightBishops ?? 0;
  result.blackDarkSquarePieces = facts.blackDarkBishops ?? 0;
  return result;
}
function allMetricFunctions(): Array<(facts: PositionFacts) => DiagnosticResult> {
  return SPECS.map(buildMetric);
}
const METRIC_FUNCTIONS = allMetricFunctions();

export function diagnosticCount(): number { return METRIC_FUNCTIONS.length; }
export function diagnosticCategories(): string[] { return Array.from(new Set(SPECS.map((spec) => spec.category))); }
export function evaluatePositionDiagnostics(fen: string): DiagnosticReport {
  const chess = new Chess(fen);
  const facts = normalizeFacts(buildFacts(chess));
  const results = METRIC_FUNCTIONS.map((evaluate) => evaluate(facts));
  return {
    fen: chess.fen(),
    sideToMove: chess.turn(),
    status: chess.isCheckmate() ? "Мат" : chess.isStalemate() ? "Пат" : chess.isDraw() ? "Ничья" : chess.isCheck() ? "Шах" : "Игра продолжается",
    total: results.length,
    good: results.filter((item) => item.tone === "good").length,
    watch: results.filter((item) => item.tone === "watch").length,
    info: results.filter((item) => item.tone === "info").length,
    results,
  };
}
export function validateDiagnosticFen(fen: string): { valid: boolean; normalizedFen?: string; error?: string } {
  try {
    const chess = new Chess(fen.trim());
    return { valid: true, normalizedFen: chess.fen() };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "Некорректная FEN-позиция." };
  }
}
export function filterDiagnostics(results: DiagnosticResult[], category = "", query = ""): DiagnosticResult[] {
  const q = query.trim().toLocaleLowerCase("ru");
  return results.filter((item) =>
    (!category || item.category === category) &&
    (!q || (item.title + " " + item.description + " " + item.category).toLocaleLowerCase("ru").includes(q))
  );
}
export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines = [
    "CHESSMART — POSITION DIAGNOSTICS",
    "FEN: " + report.fen,
    "Status: " + report.status,
    "Checks: " + report.total + " | good: " + report.good + " | watch: " + report.watch + " | info: " + report.info,
    ""
  ];
  for (const item of report.results) lines.push("[" + item.category + "] " + item.title + ": " + item.displayValue + " — " + item.interpretation + ". " + item.description);
  lines.push("", "Note: these are heuristic and geometric checks, not a Stockfish evaluation. Attack maps are pseudo-legal and do not fully account for pins.");
  return lines.join("\n");
}
export function diagnosticsCsv(report: DiagnosticReport): string {
  const quote = (value: string) => "\"" + value.replace(/"/g, "\"\"") + "\"";
  return ["category,title,value,status,description", ...report.results.map((item) =>
    [item.category,item.title,item.displayValue,item.tone,item.description].map(quote).join(",")
  )].join("\n");
}
