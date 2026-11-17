import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  diagnosticCategories,
  diagnosticCount,
  diagnosticsCsv,
  evaluatePositionDiagnostics,
  filterDiagnostics,
  formatDiagnosticReport,
  validateDiagnosticFen,
} from "../src/lib/grandmasterDiagnostics.ts";

const startFen = new Chess().fen();
assert.equal(diagnosticCount(), 300, "The toolkit must expose exactly 300 independent checks.");
assert.equal(diagnosticCategories().length, 30, "The toolkit must expose 30 categories.");

const start = evaluatePositionDiagnostics(startFen);
assert.equal(start.total, 300);
assert.equal(start.results.length, 300);
assert.equal(new Set(start.results.map((item) => item.id)).size, 300, "Every diagnostic must have a unique id.");
assert.ok(start.good + start.watch + start.info === 300);
assert.ok(start.results.every((item) => Number.isFinite(item.value)));
assert.ok(start.results.every((item) => ["good", "watch", "info"].includes(item.tone)));
assert.equal(start.status, "Игра продолжается");

const checkFen = "4k3/8/8/8/8/8/8/4R1K1 b - - 0 1";
const checked = evaluatePositionDiagnostics(checkFen);
assert.equal(checked.status, "Шах");
assert.equal(checked.total, 300);
assert.equal(checked.results.find((item) => item.id === "безопасность-короля-8")?.value, 1);

const passedPawnFen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
const passed = evaluatePositionDiagnostics(passedPawnFen);
assert.equal(passed.results.find((item) => item.id === "проходные-пешки-1")?.value, 1);

const filtered = filterDiagnostics(start.results, "Материал");
assert.equal(filtered.length, 10);
assert.ok(filterDiagnostics(start.results, "", "сдвоенные пешки").length >= 4);
assert.equal(filterDiagnostics(start.results, "missing").length, 0);

const valid = validateDiagnosticFen(startFen);
assert.equal(valid.valid, true);
assert.equal(valid.normalizedFen, startFen);
assert.equal(validateDiagnosticFen("this is not fen").valid, false);

const csv = diagnosticsCsv(start);
assert.match(csv, /^category,title,value,status,description/);
assert.equal(csv.split("\n").length, 301);
const textReport = formatDiagnosticReport(start);
assert.match(textReport, /CHESSMART — POSITION DIAGNOSTICS/);
assert.match(textReport, /pseudo-legal/i);
assert.ok(textReport.split("\n").length >= 300);

console.log("Grandmaster 300 diagnostics validation passed: 300 unique checks across 30 categories.");
