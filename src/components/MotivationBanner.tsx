import { useState } from "react";

const MESSAGES = [
  "Каждая партия может стать сильнее.",
  "Сильная игра начинается с одного точного решения.",
  "Ошибки — это позиции, которые ты ещё не научился выигрывать.",
  "Не гонись за идеальной партией. Становись сильнее с каждым ходом.",
  "Даже гроссмейстеры когда-то впервые подвинули пешку.",
  "Твой следующий лучший ход ещё впереди.",
  "Анализируй не поражения — находи в них будущие победы.",
  "Терпение, расчёт, точность. Ход за ходом."
];

export function MotivationBanner() {
  const [message] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
  return (
    <section className="motivation-banner mx-auto mb-5 flex max-w-5xl items-center gap-4 overflow-hidden rounded-2xl border border-[#8eaf68]/20 px-4 py-3.5 sm:px-5" aria-label="Мотивация дня">
      <div className="motivation-piece relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#81b64c]/10 text-[34px] leading-none text-[#a3d16f]" aria-hidden="true">
        <span className="motivation-piece-glyph">♞</span>
        <span className="motivation-orbit motivation-orbit-one" />
        <span className="motivation-orbit motivation-orbit-two" />
      </div>
      <div className="min-w-0">
        <div className="motivation-kicker mb-1 text-[9px] font-extrabold uppercase tracking-[0.22em] text-[#91ad76]">Твой ход к мастерству</div>
        <p className="motivation-phrase text-sm font-bold leading-snug text-[#edf4e5] sm:text-[15px]">{message}</p>
      </div>
      <div className="motivation-spark ml-auto hidden h-8 w-8 shrink-0 items-center justify-center text-lg text-[#a3d16f] sm:flex" aria-hidden="true">✦</div>
    </section>
  );
}
