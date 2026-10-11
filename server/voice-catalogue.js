export const VOICE_CHOICES = Object.freeze([
  { id: 'af_heart', label: 'Heart' },
  { id: 'af_bella', label: 'Bella' },
  { id: 'af_nicole', label: 'Nicole' },
  { id: 'am_michael', label: 'Michael' },
  { id: 'bf_emma', label: 'Emma' }
].map(Object.freeze));
export const VOICES = Object.freeze(VOICE_CHOICES.map(voice => voice.id));
export const DEFAULT_VOICE = VOICES[0];
export const LEGACY_VOICES = Object.freeze(['marin', 'cedar', 'coral', 'sage', 'ash']);

// Older backups remain importable without retaining a paid speech provider.
export function migrateVoice(voice) {
  return LEGACY_VOICES.includes(voice) ? DEFAULT_VOICE : voice;
}
