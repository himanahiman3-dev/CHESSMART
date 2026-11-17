import assert from "node:assert/strict";
import {
  formatProfileBytes,
  isProfileBackupEnvelope,
  summarizeProfile,
} from "../src/lib/profileSyncCore.ts";

const profile = {
  name: "Tester",
  rating: 1250,
  puzzleRating: 1320,
  puzzleRatingHistory: [],
  games: 9,
  wins: 5,
  losses: 3,
  draws: 1,
  qualifyingBotGames: 8,
  history: [],
  reviews: [{ id: "game-1" }, { id: "game-2" }],
  puzzles: [
    { id: "p1", solvedAt: 10 },
    { id: "p2" },
    { id: "p3", solvedAt: 20 },
  ],
  trainingSessions: [{ id: "s1" }],
};
const envelope = {
  format: "chess-review-profile",
  version: 1,
  exportedAt: "2026-11-17T12:00:00.000Z",
  profile,
};

assert.equal(isProfileBackupEnvelope(envelope), true);
assert.equal(isProfileBackupEnvelope({ ...envelope, version: 2 }), false);
assert.equal(isProfileBackupEnvelope({ ...envelope, exportedAt: "not-a-date" }), false);
assert.equal(isProfileBackupEnvelope({ ...envelope, profile: { ...profile, puzzles: Array(301).fill({}) } }), false);
assert.equal(isProfileBackupEnvelope({ ...envelope, profile: { ...profile, reviews: "invalid" } }), false);
assert.equal(isProfileBackupEnvelope(null), false);

const summary = summarizeProfile(profile);
assert.equal(summary.games, 9);
assert.equal(summary.analyzedGames, 2);
assert.equal(summary.trainingPositions, 3);
assert.equal(summary.solvedPositions, 2);
assert.equal(summary.trainingSessions, 1);
assert.equal(summary.puzzleRating, 1320);
assert.ok(summary.serializedBytes > 0);

assert.equal(formatProfileBytes(512), "512 Б");
assert.equal(formatProfileBytes(2048), "2.0 КБ");
console.log("Cloud profile sync validation passed.");
