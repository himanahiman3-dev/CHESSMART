import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stockfish engine files are streamed from node_modules by the /engine/[file] route.
  outputFileTracingIncludes: {
    "/engine/[file]": ["./node_modules/stockfish/bin/**/*"],
  },
  async headers() {
    return [
      {
        // Cross-origin isolation enables SharedArrayBuffer => multi-threaded Stockfish WASM.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
