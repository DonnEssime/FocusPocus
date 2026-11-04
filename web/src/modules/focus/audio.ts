import { type FocusSession, type FocusState, sessionEndsAt } from '@focuspocus/modules/focus';
import { resolveSound, type SoundKind } from './sounds';

const FADE_S = 0.05;
const PREVIEW_S = 3;
const PREVIEW_FADE_S = 0.6;

interface PlayingSession {
  id: string;
  tick: AudioBufferSourceNode;
  tickGain: GainNode;
  finish: AudioBufferSourceNode;
  /** AudioContext time at which the countdown reaches 0. */
  endTime: number;
}

/**
 * Plays the focus timer's sounds in this window. Only the window that pressed Start calls
 * `playSession`; every other window (and computer) shows the countdown silently.
 *
 * The ticking loop's end and the finishing sound are scheduled on the Web Audio clock when the
 * session starts, so the end stays exact even when the tab is in the background.
 */
export class FocusAudio {
  private ctx: AudioContext | null = null;
  private readonly encoded = new Map<string, Promise<ArrayBuffer>>();
  private readonly decoded = new Map<string, Promise<AudioBuffer>>();
  private session: PlayingSession | null = null;
  private preview: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private sessionToken = 0;
  private previewToken = 0;
  private readonly listeners = new Set<() => void>();

  /** Id of the session whose sounds this window is playing, if any. */
  get playingSessionId(): string | null {
    return this.session?.id ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fetch (not decode) sounds ahead of time, so Start and previews react instantly. */
  prefetch(kind: SoundKind, id: string): void {
    void this.fetchEncoded(resolveSound(kind, id).src).catch(() => undefined);
  }

  /** Create/resume the AudioContext. Call synchronously from a click or change handler (autoplay policy). */
  unlock(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  async playSession(session: FocusSession): Promise<void> {
    const ctx = this.unlock();
    this.stopSession();
    const token = ++this.sessionToken;
    const [tickBuffer, finishBuffer] = await Promise.all([
      this.load(resolveSound('ticking', session.tickingSoundId).src),
      this.load(resolveSound('finishing', session.finishingSoundId).src),
    ]);
    if (token !== this.sessionToken) return; // stopped (or restarted) while loading
    const remainingS = (sessionEndsAt(session) - Date.now()) / 1000;
    if (remainingS <= 0) return;

    const now = ctx.currentTime;
    const endTime = now + remainingS;
    const tickGain = ctx.createGain();
    tickGain.connect(ctx.destination);
    tickGain.gain.setValueAtTime(0, now);
    tickGain.gain.linearRampToValueAtTime(1, now + FADE_S);
    tickGain.gain.setValueAtTime(1, Math.max(now + FADE_S, endTime - FADE_S));
    tickGain.gain.linearRampToValueAtTime(0, endTime);

    const tick = ctx.createBufferSource();
    tick.buffer = tickBuffer;
    tick.loop = true;
    tick.connect(tickGain);
    tick.start(now);
    tick.stop(endTime);

    const finish = ctx.createBufferSource();
    finish.buffer = finishBuffer;
    finish.connect(ctx.destination);
    finish.start(endTime);
    finish.onended = () => {
      if (this.session?.finish !== finish) return;
      this.session = null;
      tickGain.disconnect();
      this.emit();
    };

    this.session = { id: session.id, tick, tickGain, finish, endTime };
    this.emit();
  }

  /** Cut the ticking short and cancel the finishing sound (unless it is already ringing). */
  stopSession(): void {
    this.sessionToken++;
    const s = this.session;
    if (!s || !this.ctx) return;
    this.session = null;
    const now = this.ctx.currentTime;
    if (now < s.endTime) {
      s.tickGain.gain.cancelScheduledValues(now);
      s.tickGain.gain.setValueAtTime(s.tickGain.gain.value, now);
      s.tickGain.gain.linearRampToValueAtTime(0, now + FADE_S);
      s.tick.stop(now + FADE_S);
      s.finish.onended = null;
      s.finish.stop();
    }
    this.emit();
  }

  /**
   * React to state changes from any window or computer: if the session this window plays was
   * stopped or replaced, silence it. A natural end needs nothing: it is already scheduled.
   */
  sync(state: FocusState): void {
    const s = this.session;
    if (!s) return;
    const current = state.session;
    if (!current || current.id !== s.id || current.stoppedAt !== null) this.stopSession();
  }

  async playPreview(kind: SoundKind, id: string): Promise<void> {
    const ctx = this.unlock();
    this.stopPreview();
    const token = ++this.previewToken;
    const buffer = await this.load(resolveSound(kind, id).src);
    if (token !== this.previewToken) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(1, now);
    gain.gain.setValueAtTime(1, now + PREVIEW_S - PREVIEW_FADE_S);
    gain.gain.linearRampToValueAtTime(0, now + PREVIEW_S);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = kind === 'ticking';
    source.connect(gain);
    source.start(now);
    source.stop(now + PREVIEW_S);
    source.onended = () => {
      if (this.preview?.source === source) this.preview = null;
      gain.disconnect();
    };
    this.preview = { source, gain };
  }

  stopPreview(): void {
    this.previewToken++;
    const p = this.preview;
    if (!p || !this.ctx) return;
    this.preview = null;
    const now = this.ctx.currentTime;
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(p.gain.gain.value, now);
    p.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
    p.source.stop(now + FADE_S);
  }

  dispose(): void {
    this.stopSession();
    this.stopPreview();
    this.listeners.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  private fetchEncoded(src: string): Promise<ArrayBuffer> {
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

  private load(src: string): Promise<AudioBuffer> {
    let p = this.decoded.get(src);
    if (!p) {
      // decodeAudioData detaches its input, so decode a copy of the cached bytes.
      p = this.fetchEncoded(src).then((bytes) => this.unlock().decodeAudioData(bytes.slice(0)));
      this.decoded.set(src, p);
      p.catch(() => this.decoded.delete(src));
    }
    return p;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

const engines = new WeakMap<object, FocusAudio>();

/** One audio engine per open vault session (disposed with it). */
export function focusAudioFor(owner: { onDispose(fn: () => void): void }): FocusAudio {
  let engine = engines.get(owner);
  if (!engine) {
    engine = new FocusAudio();
    engines.set(owner, engine);
    const created = engine;
    owner.onDispose(() => created.dispose());
  }
  return engine;
}
