import type { Score } from "../types";

/** +1.4 / -0.8 / M3 / 0.0 */
export function formatScore(score: Score | undefined, abs = false): string {
  if (!score) return "0.0";
  if (score.mate !== undefined) {
    if (score.terminal) return score.mate > 0 ? "1-0" : "0-1";
    const m = Math.abs(score.mate);
    return abs ? `M${m}` : `${score.mate < 0 ? "-" : ""}M${m}`;
  }
  const v = score.cp / 100;
  if (Math.abs(v) < 0.05) return "0.0";
  const s = Math.abs(v).toFixed(1);
  if (abs) return s;
  return `${v > 0 ? "+" : "-"}${s}`;
}

/** SAN → русская нотация (Кр, Ф, Л, С, К). */
export function sanRu(san: string): string {
  if (!san) return san;
  let s = san;
  const map: Record<string, string> = { K: "Кр", Q: "Ф", R: "Л", B: "С", N: "К" };
  if (/^[KQRBN]/.test(s)) s = map[s[0]] + s.slice(1);
  s = s.replace(/=([QRBN])/, (_m, p: string) => "=" + map[p].replace("Кр", "К"));
  return s;
}

export const PIECE_NAME_RU: Record<string, string> = {
  p: "пешку",
  n: "коня",
  b: "слона",
  r: "ладью",
  q: "ферзя",
  k: "короля",
};
export const PIECE_NAME_RU_NOM: Record<string, string> = {
  p: "пешка",
  n: "конь",
  b: "слон",
  r: "ладья",
  q: "ферзь",
  k: "король",
};
export const PIECE_NAME_RU_GEN: Record<string, string> = {
  p: "пешки",
  n: "коня",
  b: "слона",
  r: "ладьи",
  q: "ферзя",
  k: "короля",
};

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function fenKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}
