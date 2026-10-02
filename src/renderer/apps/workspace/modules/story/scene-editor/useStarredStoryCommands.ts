import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { FAVORITES_SETTING_KEY, migrateStarredActionIds } from "./storyActionCreatorFavorites";

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

/**
 * The author's starred story commands, shared by every surface that lists commands.
 *
 * Two surfaces read the set - the command manual beside the scene and the `/` menu on the line being
 * typed - and either can change it, so neither keeps a copy of its own. The write goes to the global
 * store, whose broadcast reaches every reader in every window, the writer included; a star set in
 * one place is lit in the other on the same frame.
 *
 * Seeded from the settings service's cache rather than from an IPC read. The `/` menu mounts a new
 * reader every time a line opens, and an empty first frame would draw the menu without its starred
 * rows, put the highlight on the first subject row, and keep it there when the starred rows arrived
 * above it - Enter would take a command the author was not looking at.
 */
export function useStarredStoryCommands(): StarredStoryCommands {
    const workspace = useOptionalWorkspace();
    const context = workspace?.context ?? null;
    const isInitialized = workspace?.isInitialized ?? false;
    const settings = useMemo(
        () => context && isInitialized ? context.services.get<GlobalSettingsService>(Services.GlobalSettings) : null,
        [context, isInitialized],
    );
    const [starredIds, setStarredIds] = useState<ReadonlySet<string>>(
        () => resolveStarredIds(settings?.getSync(FAVORITES_SETTING_KEY)),
    );
    /**
     * What the next toggle builds on. Moved by the toggle itself, not by the echo, so two stars set
     * before the first write comes back are both kept.
     */
    const latest = useRef(starredIds);

    const adopt = useCallback((next: ReadonlySet<string>) => {
        latest.current = next;
        // Same content keeps the same set, so an echo of the write that is already on screen does
        // not hand every list memoized against it a new identity.
        setStarredIds(current => (sameIds(current, next) ? current : next));
    }, []);

    useEffect(() => {
        let cancelled = false;
        let pushed = false;
        // Subscribed before any read, so a change landing while the read is in flight is not lost.
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key !== FAVORITES_SETTING_KEY) {
                return;
            }
            pushed = true;
            adopt(resolveStarredIds(change.value));
        });
        if (settings?.has(FAVORITES_SETTING_KEY)) {
            adopt(resolveStarredIds(settings.getSync(FAVORITES_SETTING_KEY)));
        } else {
            void getInterface().app.state.getGlobalState(FAVORITES_SETTING_KEY)
                .then(result => {
                    if (!cancelled && !pushed) {
                        adopt(resolveStarredIds(result.success ? result.data.value : undefined));
                    }
                })
                .catch(() => undefined);
        }
        return () => {
            cancelled = true;
            token?.cancel();
        };
    }, [adopt, settings]);

    const toggleStarred = useCallback((commandId: string) => {
        const previous = latest.current;
        const next = new Set(previous);
        if (next.has(commandId)) {
            next.delete(commandId);
        } else {
            next.add(commandId);
        }
        adopt(next);
        void getInterface().app.state.setGlobalState(FAVORITES_SETTING_KEY, [...next])
            .then(result => {
                if (!result.success) {
                    console.warn("[useStarredStoryCommands] failed to save starred commands", result);
                    adopt(previous);
                }
            })
            .catch(error => {
                console.warn("[useStarredStoryCommands] failed to save starred commands", error);
                adopt(previous);
            });
    }, [adopt]);

    return { starredIds, toggleStarred };
}
