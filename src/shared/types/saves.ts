/**
 * Automatic saving: the authored configuration and the reserved slot namespace
 * it writes into.
 *
 * Autosaves are ordinary save records - same store, same shape - kept in a small
 * rotating ring of reserved ids. Reserving the ids is what keeps the two halves
 * apart: the author's own save/load screen lists player slots (`List Saves`) and
 * never sees an autosave, while an autosave screen lists the ring
 * (`List Auto Saves`) and never sees a player slot.
 *
 * Shared because all three sides need it: the project settings UI writes the
 * config into `.nlproj`, the main-process bundle assembler bakes it into the
 * bundle, and the game app runs the scheduler off it.
 */

export type AutoSaveConfiguration = {
  /** Write an autosave on a timer while a game is running. */
  enabled: boolean;
  /**
   * Seconds between autosave writes. The scheduler only writes when the story
   * advanced since the last one, so an idle game costs nothing regardless of
   * how short this is.
   */
  intervalSeconds: number;
  /** How many rotating slots the ring keeps; the oldest is overwritten. */
  slots: number;
};

/**
 * On by default: a visual novel that loses a playthrough to a crash has failed
 * the player, and an author who does not want it can say so in one click.
 */
export const DEFAULT_AUTO_SAVE_CONFIGURATION: AutoSaveConfiguration = {
  enabled: true,
  intervalSeconds: 5,
  slots: 3
};

/** Guard rails for the authored numbers; the UI offers the same range. */
export const AUTO_SAVE_INTERVAL_SECONDS_MIN = 1;
export const AUTO_SAVE_INTERVAL_SECONDS_MAX = 600;
export const AUTO_SAVE_SLOTS_MIN = 1;
export const AUTO_SAVE_SLOTS_MAX = 20;

/**
 * Prefix of every reserved autosave id. Chosen to be unmistakable in a save
 * directory listing and to survive `normalizeRuntimeSaveId` (no path segments,
 * no control characters).
 */
export const AUTO_SAVE_ID_PREFIX = "@autosave.";

/** The reserved id of one ring slot. */
export function autoSaveSlotId(index: number): string {
  return `${AUTO_SAVE_ID_PREFIX}${Math.max(0, Math.trunc(index))}`;
}

/** Whether a save id belongs to the reserved autosave ring. */
export function isAutoSaveId(id: string): boolean {
  return id.startsWith(AUTO_SAVE_ID_PREFIX);
}

/**
 * Slot index encoded in a reserved id, or null when the id is not a well-formed
 * ring member. Ids left behind by a larger ring (the author lowered `slots`)
 * parse fine; the caller decides whether they are still in range.
 */
export function parseAutoSaveSlotIndex(id: string): number | null {
  if (!isAutoSaveId(id)) {
    return null;
  }
  const raw = id.slice(AUTO_SAVE_ID_PREFIX.length);
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Coerce an unknown (persisted, partially-migrated, or absent) value into a
 * complete configuration. Projects predating the feature have no `app.autoSave`
 * and get the defaults - which is the point of the default being "on".
 */
export function normalizeAutoSaveConfiguration(value: unknown): AutoSaveConfiguration {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_AUTO_SAVE_CONFIGURATION };
  }
  const record = value as Record<string, unknown>;
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : DEFAULT_AUTO_SAVE_CONFIGURATION.enabled,
    intervalSeconds: clampInteger(
      record.intervalSeconds,
      DEFAULT_AUTO_SAVE_CONFIGURATION.intervalSeconds,
      AUTO_SAVE_INTERVAL_SECONDS_MIN,
      AUTO_SAVE_INTERVAL_SECONDS_MAX
    ),
    slots: clampInteger(
      record.slots,
      DEFAULT_AUTO_SAVE_CONFIGURATION.slots,
      AUTO_SAVE_SLOTS_MIN,
      AUTO_SAVE_SLOTS_MAX
    )
  };
}

/**
 * One autosave as a blueprint graph sees it. Deliberately carries the *id*
 * rather than the serialized game: a graph cannot do anything with a
 * `SavedGameData` blob, whereas the id feeds straight into the existing
 * `Load Save` / `Get Save Preview` / `Get Save Metadata` / `Delete Save` nodes.
 */
/**
 * When one save slot was written, as `Get Save Time` publishes it.
 *
 * The store has always stamped its records; this is the shape that carries the stamps out to a
 * graph. Epoch milliseconds, matching {@link AutoSaveEntry} and every Time node, rather than the ISO
 * strings the record holds - a graph compares and formats numbers, and parsing a string first would
 * be a step every save screen has to take.
 *
 * `null` from a reader means no such slot. A record the store could not stamp answers 0 for the
 * field it is missing, which is a real slot with an unknown time - not the same thing.
 */
export type SaveRecordTimes = {
  /** When this slot was last written, epoch milliseconds; 0 when the record carries no stamp. */
  savedAt: number;
  /** When this slot was first written, epoch milliseconds; 0 when the record carries no stamp. */
  createdAt: number;
};

/**
 * Where one save slot stopped, as `Get Save Line` publishes it.
 *
 * The engine writes both fields into `SavedGameMetaData` on every serialize, so they describe the
 * line the save is actually resuming from. A graph could only ever approximate that by reading the
 * live backlog at `Save Game` time and writing the last entry into the save's own metadata - a
 * second copy that drifts, because the newest backlog entry is not always the line being saved
 * (saving from an overlay, a say followed by non-say actions, or a backlog past its cap all move
 * the two apart).
 *
 * `null` from a reader means no such slot. A slot whose engine metadata carries no sentence - the
 * save was taken before any line played - answers with empty strings, which is a real slot with
 * nothing to quote.
 */
export type SaveRecordLine = {
  /** The last sentence shown, or "" when the record carries none. */
  line: string;
  /** Who spoke it, or "" when the record carries no speaker (narration, or none yet). */
  speaker: string;
};

export type AutoSaveEntry = {
  id: string;
  /** Slot index within the ring. */
  slot: number;
  /** When this slot was last written, epoch milliseconds. */
  timestamp: number;
  /** When this slot was first written, epoch milliseconds. */
  createdAt: number;
  /** Whatever the writer attached as user metadata (null when none). */
  metadata: unknown;
};
