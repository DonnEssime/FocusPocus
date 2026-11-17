import type { Timer, TimersState } from '@focuspocus/modules/timers';
import { SoundLoader } from '../../sounds/loader';
import { resolveSound } from '../../sounds/registry';

/** Longest wait before the wall clock is checked again (a sleeping computer stalls timeouts). */
const WATCHDOG_MS = 30_000;
/** Only arm the audio clock this close to the end: it stalls during sleep, and long waits drift. */
const AUDIO_ARM_MS = 90_000;
const PREVIEW_S = 3;
const PREVIEW_FADE_S = 0.6;
const FADE_S = 0.05;

interface Pending {
  timer: Timer;
  watchdog: ReturnType<typeof setTimeout> | null;
  /** The finishing sound, scheduled on the audio clock once the end is near. */
  source: AudioBufferSourceNode | null;
  /** AudioContext time at which `source` starts. */
  when: number;
}

/**
 * Rings the timers of one open vault in this window. Every window follows the vault state, but
 * only one window per browser rings: the one holding a Web Lock. Only windows that may play audio
 * (the user clicked or typed in them) compete for the lock, so the alarm never falls to a window
 * that would stay silent.
 *
 * A timer rings when its end is reached while this window watches it. A timer that ended before
 * the window opened (or comes back through undo after it ended) is shown as finished, silently.
 *
 * Timing: the sound is scheduled on the audio clock shortly before the end, which stays exact in
 * background tabs. A wall-clock watchdog backs it up, for a computer that slept through the end.
 */
export class TimerAlarms {
  private ctx: AudioContext | null = null;
  private readonly sounds = new SoundLoader(() => this.audio());
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<() => void>();
  private readonly lockAbort = new AbortController();
  private releaseLock: (() => void) | null = null;
  private competing = false;
  private preview: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private previewToken = 0;
  private disposed = false;
  private readonly onGesture = () => this.unlock();

  /** Whether this window is the one in this browser that rings. */
  leader = false;
  /** How many alarms this window has rung. */
  rings = 0;

  constructor(private readonly lockName: string) {
    if (navigator.userActivation?.hasBeenActive) this.unlock();
    else {
      document.addEventListener('pointerdown', this.onGesture, { capture: true });
      document.addEventListener('keydown', this.onGesture, { capture: true });
    }
  }

  /** Whether sounds can play in this window right now. */
  get audioReady(): boolean {
    return this.ctx?.state === 'running';
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Create/resume the AudioContext and join the election. Call from a click or key handler. */
  unlock(): void {
    if (this.disposed) return;
    document.removeEventListener('pointerdown', this.onGesture, { capture: true });
    document.removeEventListener('keydown', this.onGesture, { capture: true });
    const ctx = this.audio();
    if (ctx.state === 'suspended') void ctx.resume();
    this.compete();
  }

  /** Follow the vault: watch new timers, forget removed ones. */
  sync(state: TimersState): void {
    if (this.disposed) return;
    const now = Date.now();
    for (const [id, p] of this.pending) {
      const t = state.timers[id];
      if (!t || t.endsAt !== p.timer.endsAt || t.soundId !== p.timer.soundId) this.drop(id);
    }
    for (const timer of Object.values(state.timers)) {
      if (timer.endsAt > now && !this.pending.has(timer.id)) {
        this.pending.set(timer.id, { timer, watchdog: null, source: null, when: 0 });
        this.arm(timer.id);
      }
    }
  }

  /** Play a sound briefly, as when choosing it. */
  async playPreview(soundId: string): Promise<void> {
    this.unlock();
    this.stopPreview();
    const token = ++this.previewToken;
    const buffer = await this.sounds.load(resolveSound('finishing', soundId).src).catch(() => null);
    if (!buffer || token !== this.previewToken || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(1, now);
    gain.gain.setValueAtTime(1, now + PREVIEW_S - PREVIEW_FADE_S);
    gain.gain.linearRampToValueAtTime(0, now + PREVIEW_S);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(now);
    source.stop(now + PREVIEW_S);
    source.onended = () => {
      if (this.preview?.source === source) this.preview = null;
      gain.disconnect();
    };
    this.preview = { source, gain };
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('pointerdown', this.onGesture, { capture: true });
    document.removeEventListener('keydown', this.onGesture, { capture: true });
    for (const id of [...this.pending.keys()]) this.drop(id);
    this.stopPreview();
    this.lockAbort.abort();
    this.releaseLock?.();
    this.listeners.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.ctx.addEventListener('statechange', () => {
        this.armAll();
        this.emit();
      });
    }
    return this.ctx;
  }

  private compete(): void {
    if (this.competing) return;
    this.competing = true;
    const become = () => {
      this.leader = true;
      this.armAll();
      this.emit();
    };
    if (!navigator.locks) return become();
    navigator.locks
      .request(this.lockName, { signal: this.lockAbort.signal }, () => {
        if (this.disposed) return;
        become();
        // Held until this window goes away; the next window in line then takes over.
        return new Promise<void>((resolve) => (this.releaseLock = resolve));
      })
      .catch(() => undefined); // aborted on dispose
  }

  private armAll(): void {
    for (const id of this.pending.keys()) this.arm(id);
  }

  /** (Re)check one timer against the wall clock: ring, schedule its sound, or wait some more. */
  private arm(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.watchdog !== null) clearTimeout(p.watchdog);
    const remaining = p.timer.endsAt - Date.now();
    if (remaining <= 0) return this.ring(p);
    if (remaining <= AUDIO_ARM_MS) void this.schedule(p);
    p.watchdog = setTimeout(() => this.arm(id), Math.min(remaining, WATCHDOG_MS));
  }

  /** Put the sound on the audio clock, exact even when the tab is in the background. */
  private async schedule(p: Pending): Promise<void> {
    if (p.source || !this.leader || !this.audioReady) return;
    const buffer = await this.sounds.load(resolveSound('finishing', p.timer.soundId).src).catch(() => null);
    const ctx = this.ctx;
    if (!buffer || !ctx || this.pending.get(p.timer.id) !== p || p.source || !this.leader) return;
    const remaining = p.timer.endsAt - Date.now();
    if (remaining <= 0) return;
    p.source = ctx.createBufferSource();
    p.source.buffer = buffer;
    p.source.connect(ctx.destination);
    p.when = ctx.currentTime + remaining / 1000;
    p.source.start(p.when);
  }

  private ring(p: Pending): void {
    this.pending.delete(p.timer.id);
    if (p.watchdog !== null) clearTimeout(p.watchdog);
    const ctx = this.ctx;
    // The audio clock already started it (or is about to): leave it be. Otherwise (the audio clock
    // stalled while the computer slept, or nothing was scheduled) ring now.
    const onTime = p.source && ctx && ctx.currentTime >= p.when - 0.25;
    if (!onTime) {
      this.silence(p);
      if (this.leader && this.audioReady) void this.playNow(p.timer.soundId);
    }
    if (this.leader && this.audioReady) {
      this.rings++;
      this.emit();
    }
  }

  private async playNow(soundId: string): Promise<void> {
    const buffer = await this.sounds.load(resolveSound('finishing', soundId).src).catch(() => null);
    const ctx = this.ctx;
    if (!buffer || !ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  }

  /** Forget a timer that was cancelled or changed; a sound already ringing is left to finish. */
  private drop(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.watchdog !== null) clearTimeout(p.watchdog);
    if (!this.ctx || this.ctx.currentTime < p.when) this.silence(p);
  }

  private silence(p: Pending): void {
    if (!p.source) return;
    p.source.onended = null;
    try {
      p.source.stop();
    } catch {
      // never started
    }
    p.source.disconnect();
    p.source = null;
  }

  private stopPreview(): void {
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

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

const engines = new WeakMap<object, TimerAlarms>();

/** One alarm engine per open vault session (disposed with it). */
export function timerAlarmsFor(owner: { vaultId: string; onDispose(fn: () => void): void }): TimerAlarms {
  let engine = engines.get(owner);
  if (!engine) {
    engine = new TimerAlarms(`focuspocus:timer-alarms:${owner.vaultId}`);
    engines.set(owner, engine);
    const created = engine;
    owner.onDispose(() => created.dispose());
  }
  return engine;
}
