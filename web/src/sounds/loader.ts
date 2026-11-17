/**
 * Fetches and decodes bundled sounds once per engine. Fetching (not decoding) can happen ahead of
 * time; decoding needs the engine's AudioContext, which only exists after a user gesture.
 */
export class SoundLoader {
  private readonly encoded = new Map<string, Promise<ArrayBuffer>>();
  private readonly decoded = new Map<string, Promise<AudioBuffer>>();

  constructor(private readonly context: () => BaseAudioContext) {}

  /** Fetch ahead of time, so playing reacts instantly. Errors are ignored here. */
  prefetch(src: string): void {
    void this.fetch(src).catch(() => undefined);
  }

  load(src: string): Promise<AudioBuffer> {
    let p = this.decoded.get(src);
    if (!p) {
      // decodeAudioData detaches its input, so decode a copy of the cached bytes.
      p = this.fetch(src).then((bytes) => this.context().decodeAudioData(bytes.slice(0)));
      this.decoded.set(src, p);
      p.catch(() => this.decoded.delete(src));
    }
    return p;
  }

  private fetch(src: string): Promise<ArrayBuffer> {
    let p = this.encoded.get(src);
    if (!p) {
      p = fetch(src).then((r) => {
        if (!r.ok) throw new Error(`Could not load sound ${src}`);
        return r.arrayBuffer();
      });
      this.encoded.set(src, p);
      p.catch(() => this.encoded.delete(src));
    }
    return p;
  }
}
