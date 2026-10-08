// Tiny synthesized sounds (no audio files): a glass "clink" for drinks.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function clink(): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  for (const [freq, gain, decay] of [
    [2093, 0.12, 0.5],
    [3136, 0.06, 0.35],
    [4699, 0.03, 0.2],
  ] as const) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    o.connect(g).connect(ac.destination);
    o.start(now);
    o.stop(now + decay + 0.05);
  }
}

export function buzz(ms = 60): void {
  navigator.vibrate?.(ms);
}
