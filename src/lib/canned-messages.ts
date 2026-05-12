/**
 * Pre-canned short messages — pick-and-send, or insert into the compose box.
 * Stored in localStorage so the user's list persists across sessions.
 *
 * Defaults lean on radio-operator brevity ("QSL" = received, "73" = best regards)
 * + a few common situational phrases. The user is expected to edit these to
 * match their group's vocabulary.
 */

const STORAGE_KEY = 'openkb.chat.cannedMessages.v1';

const DEFAULTS: string[] = [
  'On my way',
  'ETA 5 min',
  'Copy that',
  'QSL — received',
  'Standby',
  'Need help',
  'Status?',
  '73 — best regards',
  'At rendezvous',
  'Heading home',
];

export function loadCanned(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS.slice();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed;
    }
    return DEFAULTS.slice();
  } catch {
    return DEFAULTS.slice();
  }
}

export function saveCanned(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* localStorage might be disabled — ignore */
  }
}

export function resetCanned(): string[] {
  const copy = DEFAULTS.slice();
  saveCanned(copy);
  return copy;
}
