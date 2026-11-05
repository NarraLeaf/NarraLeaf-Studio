import { useEffect, useState } from "react";
import type { GlobalStateKeys } from "@shared/types/state/globalState";
import { observeGlobalSettings } from "./observeGlobalSettings";

/** Raw stored preferences, followed live through one subscription for the requested keys. */
export function useGlobalSettings(keys: readonly GlobalStateKeys[]): {
    values: Record<string, unknown>;
    loading: boolean;
} {
    const identity = JSON.stringify([...new Set(keys)].sort());
    const [snapshot, setSnapshot] = useState<{
        identity: string;
        values: Record<string, unknown>;
        loading: boolean;
    }>(() => ({ identity, values: {}, loading: true }));
    useEffect(() => {
        let disposed = false;
        setSnapshot({ identity, values: {}, loading: true });
        const watched = observeGlobalSettings(JSON.parse(identity) as GlobalStateKeys[], (key, value) => {
            setSnapshot(previous => ({ ...previous, values: { ...previous.values, [key]: value } }));
        });
        void watched.ready.then(() => {
            if (!disposed) setSnapshot(previous => ({ ...previous, loading: false }));
        });
        return () => { disposed = true; watched.dispose(); };
    }, [identity]);
    return snapshot.identity === identity ? snapshot : { values: {}, loading: true };
}
