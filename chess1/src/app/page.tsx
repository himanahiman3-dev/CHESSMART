import { ReviewApp } from "@/components/ReviewApp";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-black/40 bg-[#211f1c]">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3">
          <span className="text-3xl leading-none text-[#81b64c]">♞</span>
          <div>
            <h1 className="text-lg font-extrabold leading-tight text-white">Game Review</h1>
            <p className="text-xs text-[#a7a6a2]">Unlimited free analysis · Stockfish 19 NNUE · Win-rate move classification</p>
          </div>
        </div>
      </header>
      <ReviewApp />
    </main>
  );
}
