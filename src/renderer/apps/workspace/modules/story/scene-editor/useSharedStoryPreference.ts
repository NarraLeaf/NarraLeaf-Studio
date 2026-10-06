import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";

/** How one preference is read from, compared in, and written back to global state. */
export type SharedStoryPreferenceCodec<T> = {
    /** The global-state key. */
    key: string;
    /** The stored value as the interface uses it; has to accept `undefined` (never written, or reset). */
    resolve: (stored: unknown) => T;
    /** Content equality, so an echo of a write already on screen keeps the value's identity. */
    same: (a: T, b: T) => boolean;
    /** The value as it is written. */
    serialize: (value: T) => unknown;
    /** Names the preference in the warning a failed write leaves. */
    label: string;
};

export type SharedStoryPreference<T> = {
    value: T;
    /** Apply a change to the latest value, show it at once, and write it; a failed write rolls it back. */
    update: (change: (latest: T) => T) => void;
};

/**
 * One per-user story-editor preference that several surfaces read and any of them can change: the
 * starred commands and the command abbreviations, both of which the command manual beside the scene
 * and the `/` menu on the line being typed share.
 *
 * Neither surface keeps a copy of its own. The write goes to the global store, whose broadcast
 * reaches every reader in every window, the writer included; a change made in one place shows in the
 * other on the same frame.
 *
 * Seeded from the settings service's cache rather than from an IPC read. The `/` menu mounts a new
 * reader every time a line opens, and an empty first frame would draw that menu without what the
 * preference adds to it - the starred rows, the abbreviation's row at the top - and put the highlight
 * on a row that is not where the author is looking. Outside a workspace (no cache) it reads the store.
 *
 * `codec` should be a module constant; it is read through a ref, so an inline one still works but
 * costs a re-render's worth of comparisons.
 */
export function useSharedStoryPreference<T>(codec: SharedStoryPreferenceCodec<T>): SharedStoryPreference<T> {
    const codecRef = useRef(codec);
    codecRef.current = codec;
    const { key } = codec;

    const workspace = useOptionalWorkspace();
    const context = workspace?.context ?? null;
    const isInitialized = workspace?.isInitialized ?? false;
    const settings = useMemo(
        () => context && isInitialized ? context.services.get<GlobalSettingsService>(Services.GlobalSettings) : null,
        [context, isInitialized],
    );
    const [value, setValue] = useState<T>(() => codec.resolve(settings?.getSync(key)));
    /**
     * What the next update builds on. Moved by the update itself, not by the echo, so two changes made
     * before the first write comes back are both kept.
     */
    const latest = useRef(value);

    const adopt = useCallback((next: T) => {
        latest.current = next;
        setValue(current => (codecRef.current.same(current, next) ? current : next));
    }, []);

    useEffect(() => {
        let cancelled = false;
        let pushed = false;
        // Subscribed before any read, so a change landing while the read is in flight is not lost.
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key !== key) {
                return;
            }
            pushed = true;
            adopt(codecRef.current.resolve(change.value));
        });
        if (settings?.has(key)) {
            adopt(codecRef.current.resolve(settings.getSync(key)));
        } else {
            void getInterface().app.state.getGlobalState(key)
                .then(result => {
                    if (!cancelled && !pushed) {
                        adopt(codecRef.current.resolve(result.success ? result.data.value : undefined));
                    }
                })
                .catch(() => undefined);
        }
        return () => {
            cancelled = true;
            token?.cancel();
        };
    }, [adopt, key, settings]);

    const update = useCallback((change: (latest: T) => T) => {
        const previous = latest.current;
        const next = change(previous);
        adopt(next);
        const { label, serialize } = codecRef.current;
        void getInterface().app.state.setGlobalState(key, serialize(next))
            .then(result => {
                if (!result.success) {
                    console.warn(`[useSharedStoryPreference] failed to save ${label}`, result);
                    adopt(previous);
                }
            })
            .catch(error => {
                console.warn(`[useSharedStoryPreference] failed to save ${label}`, error);
                adopt(previous);
            });
    }, [adopt, key]);

    return { value, update };
}
