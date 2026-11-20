/**
 * Шахматные звуки CHESSMART.
 * Основные игровые эффекты воспроизводятся оригинальными MP3-файлами Chess.com
 * через HTMLAudioElement: CORS для обычного аудиовоспроизведения не требуется.
 * Небольшие звуки тренажёров остаются синтезированными Web Audio.
 */
export type SoundKind =
  | "game-start"
  | "move"
  | "opponent"
  | "capture"
  | "check"
  | "mate"
  | "castle"
  | "premove"
  | "promote"
  | "end"
  | "notify"
  | "illegal"
  | "tenseconds"
  | "wrong"
  | "correct"
  | "brilliant";

export type MoveSoundSource = "self" | "opponent" | "premove";

const SOUND_STORAGE_KEY = "chess-review:sound-enabled:v1";
const SOUND_BASE_URL = "https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/";

const FILE_SOUNDS: Partial<Record<SoundKind, string>> = {
  "game-start": "game-start.mp3",
  move: "move-self.mp3",
  opponent: "move-opponent.mp3",
  capture: "capture.mp3",
  check: "move-check.mp3",
  castle: "castle.mp3",
  premove: "premove.mp3",
  promote: "promote.mp3",
  end: "game-end.mp3",
  notify: "notify.mp3",
  illegal: "illegal.mp3",
  tenseconds: "tenseconds.mp3",
};

let enabled = true;
let soundToken = 0;
let audioContext: AudioContext | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeAudioFinish: (() => void) | null = null;
const audioCache = new Map<string, HTMLAudioElement>();

/** Загружает пользовательское предпочтение; по умолчанию звуки включены. */
export function loadSoundEnabled(): boolean {
  try {
    const saved = localStorage.getItem(SOUND_STORAGE_KEY);
    return saved === null ? true : saved === "true";
  } catch {
    return true;
  }
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(value));
  } catch {
    // Запрет хранилища в приватном режиме не должен мешать настройке.
  }
  if (!value) {
    soundToken++;
    stopCurrentAudio();
  }
}

export function isSoundEnabled() {
  return enabled;
}

function getAudio(file: string): HTMLAudioElement {
  const url = SOUND_BASE_URL + file;
  const cached = audioCache.get(url);
  if (cached) return cached;
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = 0.82;
  audioCache.set(url, audio);
  return audio;
}

function stopCurrentAudio() {
  const audio = activeAudio;
  const finish = activeAudioFinish;
  activeAudio = null;
  activeAudioFinish = null;
  if (audio) {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // The media metadata may not have loaded yet.
    }
  }
  finish?.();
}

/** Один файл проигрывается до конца; новый игровой звук аккуратно заменяет предыдущий. */
function playFile(file: string): Promise<void> {
  stopCurrentAudio();
  const audio = getAudio(file);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      if (activeAudio === audio) {
        activeAudio = null;
        activeAudioFinish = null;
      }
      resolve();
    };
    activeAudio = audio;
    activeAudioFinish = finish;
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    try {
      audio.currentTime = 0;
    } catch {
      // Playback can still start while the browser is loading metadata.
    }
    void audio.play().catch(finish);
  });
}

async function playCheckmateSequence(token: number) {
  // Chess.com-style checkmate cue: play the check sound, then the game-end sound.
  await playFile("move-check.mp3");
  if (token !== soundToken || !enabled) return;
  await playFile("game-end.mp3");
}

function getAudioContext(): AudioContext | null {
  if (!enabled) return null;
  try {
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Constructor = window.AudioContext ?? w.webkitAudioContext;
    if (!Constructor) return null;
    audioContext ??= new Constructor();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function tone(
  context: AudioContext,
  when: number,
  frequency: number,
  duration: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(gain, when + 0.015);
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(envelope).connect(context.destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

/** Подготавливает MP3-элементы заранее, чтобы первый ход не ждал сетевую загрузку. */
export function preloadSounds() {
  if (!enabled) return;
  for (const file of Object.values(FILE_SOUNDS).filter((value): value is string => typeof value === "string")) {
    const audio = getAudio(file);
    audio.load();
  }
}

function playSyntheticSound(kind: SoundKind) {
  const context = getAudioContext();
  if (!context) return;
  const when = context.currentTime + 0.005;
  switch (kind) {
    case "brilliant":
      tone(context, when, 1318.51, 0.30, 0.075);
      tone(context, when + 0.045, 1760, 0.34, 0.060);
      tone(context, when + 0.095, 2349.32, 0.38, 0.038);
      tone(context, when + 0.055, 880, 0.26, 0.022, "triangle");
      break;
    case "correct":
      tone(context, when, 660, 0.15, 0.12);
      tone(context, when + 0.09, 990, 0.25, 0.12);
      break;
    case "wrong":
      tone(context, when, 220, 0.25, 0.14, "sawtooth");
      tone(context, when + 0.1, 165, 0.3, 0.12, "sawtooth");
      break;
    default:
      break;
  }
}

export function playSound(kind: SoundKind) {
  if (!enabled) return;
  soundToken++;
  const token = soundToken;

  if (kind === "mate") {
    stopCurrentAudio();
    void playCheckmateSequence(token);
    return;
  }

  const file = FILE_SOUNDS[kind];
  if (file) {
    void playFile(file);
    return;
  }

  stopCurrentAudio();
  playSyntheticSound(kind);
}

/** Выбирает событие для SAN: шах и мат имеют приоритет над обычным типом хода. */
export function soundForSan(
  san: string,
  gameOver = false,
  moveClass?: string,
  source: MoveSoundSource = "self",
): SoundKind {
  if (san.includes("#")) return "mate";
  if (gameOver) return "end";
  if (san.includes("+")) return "check";
  if (moveClass === "brilliant") return "brilliant";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("=")) return "promote";
  if (san.includes("x")) return "capture";
  if (source === "premove") return "premove";
  if (source === "opponent") return "opponent";
  return "move";
}
