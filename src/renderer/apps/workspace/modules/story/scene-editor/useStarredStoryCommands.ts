import { useCallback } from "react";
import { FAVORITES_SETTING_KEY, migrateStarredActionIds } from "./storyActionCreatorFavorites";
import { useSharedStoryPreference, type SharedStoryPreferenceCodec } from "./useSharedStoryPreference";

export type StarredStoryCommands = {
    /** The starred command ids, already migrated onto spec ids. */
    starredIds: ReadonlySet<string>;
    toggleStarred: (commandId: string) => void;
};

function resolveStarredIds(stored: unknown): ReadonlySet<string> {
    // Migrated on every read rather than once and written back: every reader of the key comes
    // through here, so a stored legacy id can never reach a surface unconverted.
    return new Set(Array.isArray(stored) ? migrateStarredActionIds(stored as readonly string[]) : []);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const id of a) {
        if (!b.has(id)) {
            return false;
        }
    }
    return true;
}

const STARRED: SharedStoryPreferenceCodec<ReadonlySet<string>> = {
    key: FAVORITES_SETTING_KEY,
    resolve: resolveStarredIds,
    same: sameIds,
    serialize: ids => [...ids],
    label: "starred commands",
};

/**
 * The author's starred story commands, shared by every surface that lists commands: the command
 * manual beside the scene and the `/` menu on the line being typed, either of which can change it
 * (see {@link useSharedStoryPreference}).
 */
export function useStarredStoryCommands(): StarredStoryCommands {
    const { value: starredIds, update } = useSharedStoryPreference(STARRED);
    const toggleStarred = useCallback((commandId: string) => {
        update(previous => {
            const next = new Set(previous);
            if (next.has(commandId)) {
                next.delete(commandId);
            } else {
                next.add(commandId);
            }
            return next;
        });
    }, [update]);
    return { starredIds, toggleStarred };
}
