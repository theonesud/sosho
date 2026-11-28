const KEY = "sosho:mute";
const TONES = [660, 880] as const;
const TONE_S = 0.075;
const GAIN = 0.04;

let context: AudioContext | null = null;

export const isMuted = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function setMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    return;
  }
}

function ensureContext(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") context.resume().catch(() => undefined);
  } catch {
    context = null;
  }
}

export function unlockAudioOnGesture(): () => void {
  const events = ["pointerdown", "keydown"] as const;
  const unlock = () => ensureContext();
  for (const name of events) window.addEventListener(name, unlock, { once: true });
  return () => {
    for (const name of events) window.removeEventListener(name, unlock);
  };
}

export function playChime(): void {
  if (isMuted() || context === null || context.state !== "running") return;
  const ctx = context;
  const start = ctx.currentTime;
  TONES.forEach((hz, index) => {
    const at = start + index * TONE_S;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(GAIN, at + 0.01);
    gain.gain.linearRampToValueAtTime(0, at + TONE_S);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + TONE_S);
  });
}
