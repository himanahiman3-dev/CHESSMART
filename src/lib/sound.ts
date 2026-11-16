/**
 * Синтезированные звуки (Web Audio API) — без внешних файлов.
 */
export type SoundKind = "move" | "capture" | "check" | "mate" | "castle" | "promote" | "end" | "notify" | "wrong" | "correct";

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}
export function isSoundEnabled() {
  return enabled;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBuffer(c: AudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  return buf;
}

function knock(c: AudioContext, when: number, freq: number, gain: number, bright: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.09);
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = bright;
  filt.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(when);
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, when + 0.08);
  const og = c.createGain();
  og.gain.setValueAtTime(gain * 0.9, when);
  og.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
  osc.connect(og).connect(c.destination);
  osc.start(when);
  osc.stop(when + 0.12);
}

function tone(c: AudioContext, when: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g).connect(c.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

/* ------------------------- Звуки из mp3-файлов ------------------------- */
/*
 * Файлы лежат в public/sounds/. Они длинные (~4 с с затуханием), поэтому играем только начало
 * с плавным затуханием (maxSec / fadeSec), а при следующем звуке обрываем предыдущий,
 * чтобы при быстром листании партии звуки не накладывались.
 * Если файл не загрузился или не декодировался — играет синтезированный звук.
 */
type FileKind = "mate" | "check";

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
const FILES: Record<FileKind, { url: string; gain: number; maxSec: number; fadeSec: number }> = {
  // 1) удар по металлу — после мата
  mate: { url: `${BASE}sounds/zvuk-udara-po-metalu.mp3`, gain: 0.85, maxSec: 2.2, fadeSec: 0.7 },
  // 2) AWP — после шаха (в файле пик около 0 dBFS, поэтому громкость ниже)
  check: { url: `${BASE}sounds/awp_02.mp3`, gain: 0.55, maxSec: 1.5, fadeSec: 0.5 },
};

const buffers = new Map<FileKind, AudioBuffer>();
const pending = new Map<FileKind, Promise<void>>();
let currentFile: { stop: (fadeSec: number) => void } | null = null;

function loadFile(c: AudioContext, kind: FileKind): Promise<void> {
  if (buffers.has(kind)) return Promise.resolve();
  let p = pending.get(kind);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(FILES[kind].url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffers.set(kind, await c.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.warn(`Звук «${kind}» не загружен, используется синтезированный:`, e);
      } finally {
        pending.delete(kind); // при неудаче следующая попытка загрузит файл заново
      }
    })();
    pending.set(kind, p);
  }
  return p;
}

/** Загружает mp3-звуки заранее (вызовите один раз при открытии обзора). */
export function preloadSounds() {
  const c = ac();
  if (!c) return;
  for (const k of Object.keys(FILES) as FileKind[]) void loadFile(c, k);
}

function stopCurrentFile(fadeSec = 0.06) {
  currentFile?.stop(fadeSec);
  currentFile = null;
}

/** Играет файл; false — если он ещё не загружен (тогда вызывающий код играет запасной звук). */
function playFile(c: AudioContext, kind: FileKind, when: number): boolean {
  const buf = buffers.get(kind);
  if (!buf) {
    void loadFile(c, kind);
    return false;
  }
  const f = FILES[kind];
  const dur = Math.min(f.maxSec, buf.duration);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(f.gain, when);
  g.gain.setValueAtTime(f.gain, when + Math.max(0, dur - f.fadeSec));
  g.gain.linearRampToValueAtTime(0.0001, when + dur);
  src.connect(g).connect(c.destination);
  src.start(when, 0, dur);
  const handle = {
    stop: (fadeSec: number) => {
      try {
        const now = c.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(f.gain, now);
        g.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
        src.stop(now + fadeSec + 0.01);
      } catch {
        /* уже остановлен */
      }
    },
  };
  currentFile = handle;
  src.onended = () => {
    if (currentFile === handle) currentFile = null;
  };
  return true;
}

export function playSound(kind: SoundKind) {
  const c = ac();
  if (!c) return;
  stopCurrentFile(); // новый звук обрывает затухающий «хвост» предыдущего mp3
  const t = c.currentTime + 0.005;
  switch (kind) {
    case "move":
      knock(c, t, 190, 0.5, 1100);
      break;
    case "capture":
      knock(c, t, 150, 0.8, 1800);
      knock(c, t + 0.045, 120, 0.55, 900);
      break;
    case "castle":
      knock(c, t, 180, 0.5, 1000);
      knock(c, t + 0.14, 200, 0.5, 1200);
      break;
    case "promote":
      knock(c, t, 190, 0.5, 1100);
      tone(c, t + 0.05, 880, 0.18, 0.12);
      tone(c, t + 0.12, 1318, 0.22, 0.1);
      break;
    case "check":
      knock(c, t, 170, 0.55, 1500);
      // звук после шаха — AWP; пока файл не загружен, играет прежний синтезированный сигнал
      if (!playFile(c, "check", t + 0.02)) tone(c, t + 0.04, 740, 0.22, 0.12, "triangle");
      break;
    case "mate":
      knock(c, t, 150, 0.8, 1800);
      // звук после мата — удар по металлу; запасной вариант — прежний сигнал окончания партии
      if (!playFile(c, "mate", t + 0.02)) {
        tone(c, t, 523, 0.5, 0.14, "triangle");
        tone(c, t + 0.12, 392, 0.55, 0.12, "triangle");
        tone(c, t + 0.24, 262, 0.8, 0.14, "triangle");
      }
      break;
    case "end":
      tone(c, t, 523, 0.5, 0.14, "triangle");
      tone(c, t + 0.12, 392, 0.55, 0.12, "triangle");
      tone(c, t + 0.24, 262, 0.8, 0.14, "triangle");
      break;
    case "correct":
      tone(c, t, 660, 0.15, 0.12);
      tone(c, t + 0.09, 990, 0.25, 0.12);
      break;
    case "wrong":
      tone(c, t, 220, 0.25, 0.14, "sawtooth");
      tone(c, t + 0.1, 165, 0.3, 0.12, "sawtooth");
      break;
    case "notify":
      tone(c, t, 880, 0.2, 0.1);
      break;
  }
}

/** Выбор звука по SAN. */
export function soundForSan(san: string, gameOver = false): SoundKind {
  if (san.includes("#")) return "mate";
  if (gameOver) return "end";
  if (san.includes("+")) return "check";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("=")) return "promote";
  if (san.includes("x")) return "capture";
  return "move";
}
