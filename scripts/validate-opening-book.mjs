import { readFileSync } from "node:fs";
import { Chess } from "chess.js";

const source = readFileSync(new URL("../src/lib/openings.ts", import.meta.url), "utf8");
const blocks = [...source.matchAll(/const (ROWS|LICHESS_ROWS): Row\[\] = \[([\s\S]*?)\n\];/g)];

if (blocks.length !== 2) {
  throw new Error(`Expected both opening data blocks, found ${blocks.length}.`);
}

const summary = {};
const allErrors = [];
for (const [, blockName, body] of blocks) {
  const rows = [];
  for (const [lineIndex, rawLine] of body.split(/\r?\n/).entries()) {
    const line = rawLine.trim().replace(/,$/, "");
    if (!line || line.startsWith("//")) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      allErrors.push(`${blockName} line ${lineIndex + 1}: invalid JSON row (${error.message})`);
      continue;
    }
    if (!Array.isArray(row) || row.length !== 4 || !/^[A-E]\d\d$/.test(row[0]) || !row.every((value) => typeof value === "string" && value.length > 0)) {
      allErrors.push(`${blockName} line ${lineIndex + 1}: invalid row schema`);
      continue;
    }
    rows.push(row);
  }

  const seen = new Set();
  let legal = 0;
  for (const [eco, name, ru, sequence] of rows) {
    const key = `${eco}|${sequence}`;
    if (blockName === "LICHESS_ROWS" && seen.has(key)) {
      allErrors.push(`${blockName}: duplicate line ${key}`);
      continue;
    }
    seen.add(key);

    const chess = new Chess();
    try {
      for (const san of sequence.split(/\s+/)) chess.move(san);
      legal += 1;
    } catch (error) {
      allErrors.push(`${blockName}: illegal SAN in ${eco} · ${name} · "${sequence}" — ${error.message}`);
    }
  }
  summary[blockName] = { rows: rows.length, legal, unique: seen.size };
}

if ((summary.LICHESS_ROWS?.rows ?? 0) < 1000) {
  allErrors.push(`The imported opening book is too small: ${summary.LICHESS_ROWS?.rows ?? 0} rows.`);
}
if (allErrors.length) {
  for (const error of allErrors.slice(0, 30)) console.error(`✗ ${error}`);
  if (allErrors.length > 30) console.error(`…and ${allErrors.length - 30} more errors`);
  process.exitCode = 1;
} else {
  console.log(`Opening book validated: ${summary.ROWS.rows} curated + ${summary.LICHESS_ROWS.rows} imported lines.`);
  console.log(`Imported lines checked as legal SAN: ${summary.LICHESS_ROWS.legal}/${summary.LICHESS_ROWS.rows}.`);
}
