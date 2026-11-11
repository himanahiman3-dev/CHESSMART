import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "stockfish-19.js",
  "stockfish-19.wasm",
  "stockfish-19-single.js",
  "stockfish-19-single.wasm",
  "stockfish-19-lite.js",
  "stockfish-19-lite.wasm",
  "stockfish-19-lite-single.js",
  "stockfish-19-lite-single.wasm",
]);

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!ALLOWED.has(file)) return new Response("Not found", { status: 404 });

  const full = path.join(process.cwd(), "node_modules", "stockfish", "bin", file);
  let size: number;
  try {
    size = (await stat(full)).size;
  } catch {
    return new Response("Engine file missing", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=31536000, immutable",
      // Needed so the multi-threaded engine (SharedArrayBuffer) can run under cross-origin isolation.
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  });
}
