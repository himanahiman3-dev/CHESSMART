/**
 * Пример vite.config.ts с COOP/COEP-заголовками для dev-сервера и preview.
 * Скопируйте содержимое в корневой vite.config.ts, если хотите, чтобы
 * многопоточный Stockfish (SharedArrayBuffer) работал сразу при `npm run dev`
 * без перезагрузки через Service Worker.
 */
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
});
