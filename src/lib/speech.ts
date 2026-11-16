let activeUtterance: SpeechSynthesisUtterance | null = null;

function bestRussianVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("ru"));
  const score = (voice: SpeechSynthesisVoice): number => {
    const name = voice.name.toLowerCase();
    return (/(natural|online|neural)/.test(name) ? 10 : 0)
      + (/microsoft|google|yandex/.test(name) ? 5 : 0)
      + (voice.localService ? 1 : 0);
  };
  return voices.sort((a, b) => score(b) - score(a))[0];
}

export function stopCoachSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
}

export function speakCoachText(text: string): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  stopCoachSpeech();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "ru-RU";
  utterance.rate = 0.96;
  utterance.pitch = 1.0;
  utterance.volume = 0.95;
  const voice = bestRussianVoice();
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

export function getRussianVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("ru"));
}
