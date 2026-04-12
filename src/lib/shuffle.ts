/** Fisher–Yates shuffle (in-place copy). */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickCount<T>(items: T[], count: number, seed?: number): T[] {
  const shuffled = shuffle(items, seededRandom(seed));
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function seededRandom(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let t = seed + 0x6d2b79f5;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
