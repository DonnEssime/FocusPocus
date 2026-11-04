/**
 * Hybrid clock: wall-clock time, but strictly greater than every timestamp seen so far
 * (own commands *and* commands merged from other writers). This keeps locally issued
 * commands at the end of the merged order even when another computer's clock runs ahead,
 * so they can be applied incrementally instead of triggering a rebuild.
 */
export class HybridClock {
  private last = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  observe(at: number): void {
    if (at > this.last) this.last = at;
  }

  next(): number {
    const t = Math.max(this.now(), this.last + 1);
    this.last = t;
    return t;
  }
}
