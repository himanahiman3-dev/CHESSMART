import { useRef } from "react";
import { AlertCircle, Cpu, DownloadCloud, FileUp, Gauge, HardDriveDownload, Microscope, Trash2, Zap } from "lucide-react";
import type { ReviewApp } from "../hooks/useReviewApp";
import { cn } from "../utils/cn";
import { MODE_BUDGET } from "../lib/analysis";

const mb = (n: number) => (n / 1048576).toFixed(0);

export function EngineStatus({ app }: { app: ReviewApp }) {
  const { engineState, cached, dl } = app;
  let icon = <HardDriveDownload size={18} className="text-[#a7a6a2]" />;
  let title = "Stockfish 19 · полная версия";
  let sub = "≈ 95 МБ · скачивается один раз и хранится в кэше браузера";
  if (engineState === "ready") {
    icon = <Cpu size={18} className="text-[#81b64c]" />;
    sub = "Готов к работе · загружен из кэша браузера";
  } else if (engineState === "downloading") {
    icon = <DownloadCloud size={18} className="animate-pulse text-[#81b64c]" />;
    sub = dl ? `Загрузка… ${mb(dl.loaded)} из ${mb(dl.total)} МБ` : "Подключение…";
  } else if (engineState === "starting") {
    icon = <Cpu size={18} className="animate-pulse text-[#81b64c]" />;
    sub = "Запуск движка…";
  } else if (cached) {
    icon = <Cpu size={18} className="text-[#81b64c]" />;
    sub = "Найден в кэше браузера — повторно скачивать не нужно";
  }
  const pct = dl ? Math.min(100, (dl.loaded / dl.total) * 100) : 0;
  return (
    <div className="rounded-lg bg-[#2b2927] p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#383532]">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-white">{title}</div>
          <div className="text-[12px] leading-snug text-[#a7a6a2]">{sub}</div>
        </div>
        {engineState === "ready" && (
          <button
            onClick={app.removeEngineCache}
            title="Очистить кэш движка"
            className="rounded-md p-2 text-[#8b8987] active:bg-[#383532]"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {engineState === "downloading" && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#403d39]">
          <div className="h-full rounded-full bg-[#81b64c] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {engineState === "idle" && !cached && (
        <button
          onClick={() => app.ensureEngine().catch(() => {})}
          className="mt-2.5 w-full rounded-md bg-[#3d3a37] py-2 text-[13px] font-bold text-[#e0dfdd] active:bg-[#4a4743]"
        >
          Скачать движок заранее
        </button>
      )}
    </div>
  );
}

export function ImportCard({ app, mobile }: { app: ReviewApp; mobile?: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const busy = app.engineState === "downloading" || app.engineState === "starting";
  const modes = [
    {
      id: "fast" as const,
      icon: <Zap size={20} />,
      title: "Быстрый",
      sub: `≈ ${MODE_BUDGET.fast / 1000} секунд`,
    },
    {
      id: "deep" as const,
      icon: <Microscope size={20} />,
      title: "Глубокий",
      sub: `≈ ${MODE_BUDGET.deep / 60000} минуты`,
    },
  ];
  return (
    <div className="space-y-3.5">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[13px] font-bold uppercase tracking-wide text-[#a7a6a2]">Партия (PGN)</label>
          <div className="flex gap-1.5">
            <button
              onClick={app.loadSample}
              className="rounded-md bg-[#3d3a37] px-2.5 py-1.5 text-xs font-bold text-[#e0dfdd] active:bg-[#4a4743]"
            >
              Пример
            </button>
            <button
              onClick={() => file.current?.click()}
              className="flex items-center gap-1 rounded-md bg-[#3d3a37] px-2.5 py-1.5 text-xs font-bold text-[#e0dfdd] active:bg-[#4a4743]"
            >
              <FileUp size={13} /> Файл
            </button>
            <input
              ref={file}
              type="file"
              accept=".pgn,.txt,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) app.setPgn(await f.text());
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <textarea
          value={app.pgn}
          onChange={(e) => app.setPgn(e.target.value)}
          placeholder={"Вставьте PGN или ссылку на партию lichess…\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …"}
          spellCheck={false}
          className={cn(
            "w-full resize-none rounded-lg border border-[#3d3a37] bg-[#1c1b19] p-3 font-mono text-[16px] leading-snug text-[#e8e7e5] outline-none placeholder:text-[#6d6b69] focus:border-[#81b64c]",
            mobile ? "h-40" : "h-44"
          )}
        />
      </div>

      <div>
        <div className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-[#a7a6a2]">Режим анализа</div>
        <div className="grid grid-cols-2 gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => app.setMode(m.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border-2 p-3 text-left transition",
                app.mode === m.id
                  ? "border-[#81b64c] bg-[#81b64c]/10 text-white"
                  : "border-[#3d3a37] bg-[#2b2927] text-[#c9c7c5] active:bg-[#34322f]"
              )}
            >
              <span className={app.mode === m.id ? "text-[#81b64c]" : "text-[#8b8987]"}>{m.icon}</span>
              <span>
                <span className="block text-[15px] font-extrabold leading-tight">{m.title}</span>
                <span className="block text-[12px] text-[#a7a6a2]">{m.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-[#8b8987]">
          <Gauge size={13} className="mt-px shrink-0" />
          {app.mode === "fast"
            ? "Быстрый режим проверяет всю партию примерно за 10 секунд."
            : "Глубокий режим считает каждую позицию дольше — вся партия ≈ 2 минуты."}
        </p>
      </div>

      <EngineStatus app={app} />

      {app.error && (
        <div className="flex items-start gap-2 rounded-lg border border-[#ca3431]/50 bg-[#ca3431]/10 p-3 text-[13px] text-[#ffb3b1]">
          <AlertCircle size={16} className="mt-px shrink-0" />
          {app.error}
        </div>
      )}

      <button
        onClick={app.start}
        disabled={busy}
        className="w-full rounded-xl bg-[#81b64c] py-3.5 text-[18px] font-extrabold text-white shadow-[0_5px_0_#457524] transition active:translate-y-[3px] active:shadow-[0_2px_0_#457524] disabled:opacity-60"
      >
        {busy ? "Подготовка движка…" : "Анализировать партию"}
      </button>
    </div>
  );
}

export function ProgressCard({ app }: { app: ReviewApp }) {
  const { progress, engineState, dl, mode } = app;
  const engineLoading = engineState === "downloading" || engineState === "starting";
  const pct = engineLoading
    ? engineState === "starting"
      ? 100
      : dl
        ? Math.min(100, (dl.loaded / dl.total) * 100)
        : 0
    : progress
      ? (progress.done / progress.total) * 100
      : 0;
  let remain = "";
  if (!engineLoading && progress && progress.done > 2) {
    const per = progress.elapsedMs / progress.done;
    remain = `≈ ${Math.max(1, Math.round((per * (progress.total - progress.done)) / 1000))} с`;
  }
  return (
    <div className="space-y-4 rounded-xl bg-[#2b2927] p-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#403d39] border-t-[#81b64c]" />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-extrabold text-white">
            {engineState === "downloading"
              ? "Загружаем Stockfish 19…"
              : engineState === "starting"
                ? "Запускаем движок…"
                : mode === "fast"
                  ? "Быстрый анализ…"
                  : "Глубокий анализ…"}
          </div>
          <div className="text-[13px] text-[#a7a6a2]">
            {engineState === "downloading"
              ? dl
                ? `${mb(dl.loaded)} из ${mb(dl.total)} МБ · только один раз`
                : "Подключение…"
              : engineState === "starting"
                ? "Компиляция нейросети NNUE"
                : progress
                  ? `Позиция ${progress.done} из ${progress.total} · глубина ${progress.depth} ${remain && "· " + remain}`
                  : "Подготовка…"}
          </div>
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#403d39]">
        <div
          className="h-full rounded-full bg-[#81b64c] transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <button
        onClick={app.cancel}
        className="w-full rounded-lg bg-[#3d3a37] py-2.5 text-[14px] font-bold text-[#e0dfdd] active:bg-[#4a4743]"
      >
        Отменить
      </button>
    </div>
  );
}
