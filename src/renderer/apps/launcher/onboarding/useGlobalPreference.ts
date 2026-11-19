import { useCallback, useEffect, useRef, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { GlobalStateKeys } from "@shared/types/state/globalState";

/**
 * One global-state preference, read once and then followed - and written back.
 *
 * Local to the setup flow rather than a shared hook: this is the third or fourth surface in the
 * product to read a preference directly, and each of the others has a reason to do it its own way
 * (the settings window edits a whole registry at once, the appearance bootstrap runs before React
 * exists). Lifting this into `lib` would mean claiming it fits all of them.
 *
 * `resolve` turns a stored value into the one the interface uses, exactly as
 * {@link import("@/lib/settings/useGlobalSetting").useGlobalSetting} does, and for the same reason:
 * `undefined` is both what an unwritten key reads as and what a reset broadcasts, and several of the
 * preferences this flow sets (the "/" alias, the language) only reach their real default when
 * nothing is stored at all. The reader resolves; the store does not.
 *
 * Optimistic on write so the preview follows typing and dragging. Writes for a preference are
 * serialised, and a newer local edit stays visible while earlier reads and broadcasts arrive.
 *
 * `deferMs` separates the two halves of a write for the controls that produce a stream of them: the
 * value in hand moves at once (so the preview beside the control keeps up, character by character
 * and pixel by pixel) while the store is written after the stream settles. Without it a name typed
 * into a field is one JSON file rewritten per keystroke. A pending write is flushed on unmount, so
 * walking to the next screen mid-stream still records what was typed.
 */
export function useGlobalPreference<T>(
    key: GlobalStateKeys,
    resolve: (stored: unknown) => T,
    deferMs = 0,
): [T, (next: unknown) => void] {
    const [value, setValue] = useState<T>(() => resolve(undefined));
    /** The write this control owes the store, while its stream of changes is still arriving. */
    const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: unknown; revision: number } | null>(null);
    const revision = useRef(0);
    const settled = useRef(0);
    const confirmed = useRef<T>(resolve(undefined));
    const confirmedByWrite = useRef(false);
    const latestBroadcast = useRef<{ value: unknown } | null>(null);
    const writes = useRef<Promise<void>>(Promise.resolve());
    const alive = useRef(false);

    const send = useCallback((next: unknown, writeRevision: number) => {
        writes.current = writes.current.then(async () => {
            latestBroadcast.current = null;
            let saved = false;
            try {
                const result = await getInterface().app.state.setGlobalState(key, next as never);
                saved = result.success;
            } catch {
                // Keep later edits in the queue even if this request failed.
            }
            // A broadcast can arrive while the IPC request is in flight.
            const broadcast = latestBroadcast.current as { value: unknown } | null;
            if (saved) {
                confirmed.current = resolve(broadcast ? broadcast.value : next);
                confirmedByWrite.current = true;
            }
            if (revision.current === writeRevision) {
                settled.current = writeRevision;
                latestBroadcast.current = null;
                if (alive.current) setValue(() => confirmed.current);
            }
        });
        // `resolve` belongs to the preference identified by `key`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    useEffect(() => {
        alive.current = true;
        let active = true;
        let pushed = false;
        const initialRevision = revision.current;

        // Subscribed before the read: a change landing while the read is in flight would otherwise
        // reach nobody, and the control would go on showing the previous value.
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key !== key) {
                return;
            }
            pushed = true;
            confirmed.current = resolve(change.value);
            if (revision.current !== settled.current) {
                latestBroadcast.current = { value: change.value };
            } else {
                setValue(() => resolve(change.value));
            }
        });

        void getInterface()
            .app.state.getGlobalState(key)
            .then(result => {
                if (active && !pushed && !confirmedByWrite.current && result.success) {
                    confirmed.current = resolve(result.data.value);
                    if (revision.current === initialRevision || revision.current === settled.current) {
                        setValue(() => confirmed.current);
                    }
                }
            })
            .catch(() => undefined);

        return () => {
            active = false;
            alive.current = false;
            token?.cancel();
        };
        // `resolve` is deliberately not a dependency: it is a function of the stored value alone, so
        // an inline one re-subscribing on every render would cost an IPC read per keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    // Flush whatever is owed when this control goes away with the screen it is on.
    useEffect(() => () => {
        const owed = pending.current;
        if (owed) {
            clearTimeout(owed.timer);
            pending.current = null;
            send(owed.value, owed.revision);
        }
    }, [send]);

    const write = useCallback((next: unknown) => {
        const nextRevision = ++revision.current;
        setValue(() => resolve(next));
        if (pending.current) {
            clearTimeout(pending.current.timer);
            pending.current = null;
        }
        if (deferMs <= 0) {
            send(next, nextRevision);
            return;
        }
        pending.current = {
            value: next,
            revision: nextRevision,
            timer: setTimeout(() => {
                pending.current = null;
                send(next, nextRevision);
            }, deferMs),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [send, deferMs]);

    return [value, write];
}
