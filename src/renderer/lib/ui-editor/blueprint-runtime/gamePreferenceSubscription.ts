/**
 * Shared helper for subscribing to NarraLeaf React game preference changes.
 * Used by both the Dev Mode runtime and the packaged game runtime to feed the
 * `gamePreferenceChanged` blueprint lifecycle event. Comments in English per
 * project convention.
 */

export type GamePreferenceChangeToken = { cancel(): void };

type NlrPreferenceApi = {
    getPreferences?: () => Record<string, unknown>;
    onPreferenceChange: (listener: (key: string, value: unknown) => void) => GamePreferenceChangeToken;
};

type LiveGameLike = {
    game?: {
        preference?: NlrPreferenceApi;
    };
};

/**
 * Subscribe to preference changes on a NarraLeaf live game.
 *
 * Seeds `snapshotRef.current` with the current preference values so the first
 * change can report an accurate `previousValue`, then keeps the snapshot in sync
 * as each change arrives. Returns `null` when the live game does not expose a
 * usable preference dispatcher (e.g. an older renderer), in which case the caller
 * simply gets no preference-change events.
 */
export function subscribeGamePreferenceChanges(
    liveGame: unknown,
    snapshotRef: { current: Record<string, unknown> },
    onChange: (key: string, value: unknown, previousValue: unknown) => void,
): GamePreferenceChangeToken | null {
    const preference = (liveGame as LiveGameLike | null)?.game?.preference;
    if (!preference || typeof preference.onPreferenceChange !== "function") {
        return null;
    }
    try {
        snapshotRef.current = { ...(preference.getPreferences?.() ?? {}) };
    } catch {
        snapshotRef.current = {};
    }
    try {
        return preference.onPreferenceChange((rawKey, value) => {
            const key = String(rawKey);
            const snapshot = snapshotRef.current;
            const previousValue = Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : null;
            snapshot[key] = value;
            onChange(key, value, previousValue);
        });
    } catch {
        return null;
    }
}
