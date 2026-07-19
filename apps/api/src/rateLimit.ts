/**
 * Rate-limit du quick audit public (§9) — anti-abus du lead magnet.
 * Fenêtre glissante en mémoire : suffisant pour un process unique MVP.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number
  ) {}

  /** true si la requête est autorisée. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.maxHits) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Purge périodique pour éviter la croissance mémoire. */
  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}
