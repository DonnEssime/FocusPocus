import { DEFAULT_FOCUS_SETTINGS } from '@focuspocus/modules/focus';
import type { AppMessageKey } from '@focuspocus/registry';
import bellSingle from './sounds/bell-single.ogg?url';
import bellTriple from './sounds/bell-triple.ogg?url';
import chimeSoft from './sounds/chime-soft.ogg?url';
import clockTick from './sounds/clock-tick.ogg?url';
import rainforestRain from './sounds/rainforest-rain.ogg?url';

export type SoundKind = 'ticking' | 'finishing';

export interface SoundDefinition {
  /** Stored in settings and sessions: never reuse an id for a different sound. */
  id: string;
  kind: SoundKind;
  labelKey: AppMessageKey;
  src: string;
}

/** Adding a sound = one file in ./sounds (plus LICENSES.md row) and one entry here. */
export const SOUNDS: readonly SoundDefinition[] = [
  { id: 'clock-tick', kind: 'ticking', labelKey: 'focus.sound.clock-tick', src: clockTick },
  { id: 'rainforest-rain', kind: 'ticking', labelKey: 'focus.sound.rainforest-rain', src: rainforestRain },
  { id: 'bell-single', kind: 'finishing', labelKey: 'focus.sound.bell-single', src: bellSingle },
  { id: 'bell-triple', kind: 'finishing', labelKey: 'focus.sound.bell-triple', src: bellTriple },
  { id: 'chime-soft', kind: 'finishing', labelKey: 'focus.sound.chime-soft', src: chimeSoft },
];

export const DEFAULT_SOUND_IDS: Readonly<Record<SoundKind, string>> = {
  ticking: DEFAULT_FOCUS_SETTINGS.tickingSoundId,
  finishing: DEFAULT_FOCUS_SETTINGS.finishingSoundId,
};

export function soundsOf(kind: SoundKind): SoundDefinition[] {
  return SOUNDS.filter((s) => s.kind === kind);
}

/** Unknown ids (e.g. from a newer build) fall back to the kind's default sound. */
export function resolveSound(kind: SoundKind, id: string | undefined): SoundDefinition {
  return (
    SOUNDS.find((s) => s.kind === kind && s.id === id) ??
    SOUNDS.find((s) => s.kind === kind && s.id === DEFAULT_SOUND_IDS[kind])!
  );
}
