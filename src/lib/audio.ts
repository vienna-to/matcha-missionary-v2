// Soft ping using Web Audio. No external assets.
let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/**
 * Unlock the AudioContext from a user gesture. Browsers require this once per
 * session before any audio can play; call from a button onClick.
 */
export function unlockAudio(): boolean {
  const c = ensureCtx();
  if (!c) return false;
  if (c.state === "suspended") {
    try { c.resume(); } catch { /* ignore */ }
  }
  // Play a near-silent buffer to confirm gesture unlock on iOS Safari.
  try {
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
  return true;
}

export function playPing() {
  const c = ensureCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.4);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.42);
  } catch {
    // ignore
  }
}
