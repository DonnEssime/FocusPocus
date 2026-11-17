import type { AppMessageKey } from '@focuspocus/registry';
import bellSingle from './bell-single.ogg?url';
import bellTriple from './bell-triple.ogg?url';
import chimeSoft from './chime-soft.ogg?url';
import clockTick from './clock-tick.ogg?url';
import rainforestRain from './rainforest-rain.ogg?url';

/**
 * The sounds that ship with the app, shared by every module that plays one (focus timer, timers).
 * `ticking` sounds loop; `finishing` sounds play once.
 */
export type SoundKind = 'ticking' | 'finishing';

export interface SoundDefinition {
  /** Stored in settings and commands: never reuse an id for a different sound. */
  id: string;
  kind: SoundKind;
  labelKey: AppMessageKey;
  src: string;
}

/** Adding a sound = one file in this folder (plus LICENSES.md row) and one entry here. */
export const SOUNDS: readonly SoundDefinition[] = [
  { id: 'clock-tick', kind: 'ticking', labelKey: 'shell.sound.clock-tick', src: clockTick },
  { id: 'rainforest-rain', kind: 'ticking', labelKey: 'shell.sound.rainforest-rain', src: rainforestRain },
  { id: 'bell-single', kind: 'finishing', labelKey: 'shell.sound.bell-single', src: bellSingle },
  { id: 'bell-triple', kind: 'finishing', labelKey: 'shell.sound.bell-triple', src: bellTriple },
  { id: 'chime-soft', kind: 'finishing', labelKey: 'shell.sound.chime-soft', src: chimeSoft },
];

/** What an unknown id of each kind falls back to. */
export const DEFAULT_SOUND_IDS: Readonly<Record<SoundKind, string>> = {
  ticking: 'clock-tick',
  finishing: 'bell-single',
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
