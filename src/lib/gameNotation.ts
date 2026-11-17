import { Chess, type Square } from "chess.js";
export interface UciGameMove { uci: string; san?: string; color?: "w" | "b"; }
export function buildPgnFromSan(sans: string[], headers: Record<string, string> = {}): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  for (const [key, value] of Object.entries(headers)) if (value.trim()) chess.setHeader(key, value.trim());
  return chess.pgn({ maxWidth: 80, newline: "\n" });
}
export function buildPgnFromUci(moves: UciGameMove[], headers: Record<string, string> = {}): string {
  const chess = new Chess();
  for (const entry of moves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(entry.uci)) throw new Error("В истории обнаружен ход с неверным форматом.");
    const move = chess.move({
      from: entry.uci.slice(0, 2) as Square, to: entry.uci.slice(2, 4) as Square,
      ...(entry.uci[4] ? { promotion: entry.uci[4] as "q" | "r" | "b" | "n" } : {}),
    });
    if (!move) throw new Error(`Невозможно восстановить ход партии: ${entry.uci}`);
  }
  for (const [key, value] of Object.entries(headers)) if (value.trim()) chess.setHeader(key, value.trim());
  return chess.pgn({ maxWidth: 80, newline: "\n" });
}
export function formatSanMoveList(sans: string[]): string {
  const rows: string[] = [];
  for (let i = 0; i < sans.length; i += 2) rows.push(`${Math.floor(i / 2) + 1}. ${sans[i] ?? ""}${sans[i + 1] ? ` ${sans[i + 1]}` : ""}`);
  return rows.join("\n");
}
export function pgnFilename(prefix: string, date = new Date()): string {
  const safe = prefix.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "chessmart-game";
  return `${safe}-${date.toISOString().slice(0, 10)}.pgn`;
}
export function textFilename(prefix: string, ext: "txt" | "fen" | "pgn", date = new Date()): string {
  const safe = prefix.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "chessmart-game";
  return `${safe}-${date.toISOString().slice(0, 10)}.${ext}`;
}
export function downloadTextFile(content: string, filename: string, mime = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(content: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(content); return true; }
  catch {
    try {
      const input = document.createElement("textarea"); input.value = content;
      input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0";
      document.body.appendChild(input); input.select();
      const copied = document.execCommand("copy"); input.remove(); return copied;
    } catch { return false; }
  }
}
