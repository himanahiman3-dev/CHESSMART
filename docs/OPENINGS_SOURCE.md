# Opening database source and data notes

The extended catalogue in `src/lib/openings.ts` includes data from:

- Project: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
- Source revision: `3ba6b20d31b2e6125cb0e6a2e792f400717d9d39`
- Files imported: `a.tsv`, `b.tsv`, `c.tsv`, `d.tsv`, `e.tsv`
- Licence: **CC0 1.0 Universal** (see the source project's `COPYING.txt`)

## What is included

The source provides ECO codes, English opening names and PGN move sequences. CHESSMART converts the PGN move sequences into SAN strings, removes move numbers and trailing check/mate annotation markers, and imports lines not already present in the curated local table. Existing hand-curated Russian labels keep priority. New labels retain the original English title and use a lightweight Russian chess-term localization; proper names may remain in English.

At this revision the catalogue contains **4,055 unique ECO/SAN entries**, including **3,478 imported entries**. The opening validation script replays every imported SAN sequence with `chess.js` so illegal or malformed lines are caught in CI.

## Updating the source

When importing a newer revision, keep the same validation guarantees:

1. Preserve the source revision and licence reference.
2. Deduplicate entries by ECO code plus normalized SAN sequence.
3. Keep existing curated Russian translations as the preferred labels.
4. Run `npm run validate:openings`, `npx tsc --noEmit`, and `npm run build`.

The names and example move sequences are opening-reference data. They are not engine evaluations or recommendations of objectively best play.
