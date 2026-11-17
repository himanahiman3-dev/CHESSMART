let activeUtterance: SpeechSynthesisUtterance | null = null;

export interface CoachVoicePreferences {
  voiceURI: string;
  rate: number;
  pitch: number;
}

const VOICE_SETTINGS_KEY = "chessmart:coach-voice:v1";
const DEFAULT_VOICE_SETTINGS: CoachVoicePreferences = {
  voiceURI: "",
  rate: 0.94,
  pitch: 0.94,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function loadCoachVoicePreferences(): CoachVoicePreferences {
  if (typeof window === "undefined") return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || "null") as Partial<CoachVoicePreferences> | null;
    return {
      voiceURI: typeof saved?.voiceURI === "string" ? saved.voiceURI : "",
      rate: clamp(Number(saved?.rate ?? DEFAULT_VOICE_SETTINGS.rate), 0.82, 1.08),
      pitch: clamp(Number(saved?.pitch ?? DEFAULT_VOICE_SETTINGS.pitch), 0.82, 1.08),
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveCoachVoicePreferences(preferences: CoachVoicePreferences): void {
  if (typeof window === "undefined") return;
  const safe: CoachVoicePreferences = {
    voiceURI: preferences.voiceURI,
    rate: clamp(preferences.rate, 0.82, 1.08),
    pitch: clamp(preferences.pitch, 0.82, 1.08),
  };
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    // Voice preferences are optional; storage restrictions must not break speech.
  }
}

/** Rank available Russian voices, preferring natural neural male-sounding options when named. */
function voiceScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (/(natural|neural)/.test(name)) score += 100;
  if (/online/.test(name)) score += 45;
  if (/microsoft/.test(name)) score += 24;
  if (/(dmitry|dmitriy|pavel|yuri|yuriy|mikhail|mike|andrey|andrei|alexander|aleksandr|ivan|oleg|nikolai|nikolay)/.test(name)) score += 18;
  if (/google/.test(name)) score -= 35;
  if (/yandex/.test(name)) score -= 20;
  if (voice.default) score += 2;
  return score;
}

export function getRussianVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("ru"))
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

function bestRussianVoice(): SpeechSynthesisVoice | undefined {
  return getRussianVoices()[0];
}

export function stopCoachSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
}

export function speakCoachText(text: string, overrides: Partial<CoachVoicePreferences> = {}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return false;

  const preferences = { ...loadCoachVoicePreferences(), ...overrides };
  stopCoachSpeech();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "ru-RU";
  utterance.rate = clamp(preferences.rate, 0.82, 1.08);
  utterance.pitch = clamp(preferences.pitch, 0.82, 1.08);
  utterance.volume = 1;

  const voices = getRussianVoices();
  const selected = preferences.voiceURI
    ? voices.find((voice) => voice.voiceURI === preferences.voiceURI)
    : undefined;
  const voice = selected ?? bestRussianVoice();
  if (voice) utterance.voice = voice;

  activeUtterance = utterance;
  utterance.onend = () => {
    if (activeUtterance === utterance) activeUtterance = null;
  };
  utterance.onerror = () => {
    if (activeUtterance === utterance) activeUtterance = null;
  };
  window.speechSynthesis.speak(utterance);
  return true;
}

