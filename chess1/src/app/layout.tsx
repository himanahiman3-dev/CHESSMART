import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Review – Unlimited Stockfish 19 Chess Analyzer",
  description: "Free, unlimited chess game review with Stockfish 19 NNUE, win-rate based move classification, accuracy scores and a coach.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#312e2b] text-[#e8e8e4] antialiased">{children}</body>
    </html>
  );
}
