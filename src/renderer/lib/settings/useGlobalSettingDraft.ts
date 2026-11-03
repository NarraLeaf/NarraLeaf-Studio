import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import { GlobalSettingDraft } from "./globalSettingDraft";
import { observeGlobalSettings } from "./observeGlobalSettings";

/** Resolvers and normalizers are stable functions owned by the preference's schema. */
export function useGlobalSettingDraft<T>(
    key: GlobalStateKeys,
    resolve: (stored: unknown) => T,
    normalize: (value: T) => T = resolve,
) {
    const draft = useMemo(() => new GlobalSettingDraft(resolve(undefined), normalize, async value => {
        const result = await getInterface().app.state.setGlobalState(key, value as GlobalStateValue<typeof key>);
        if (!result.success) throw new Error("Setting write failed");
    }), [key, resolve, normalize]);
    useEffect(() => {
        draft.activate();
        const watched = observeGlobalSettings([key], (_key, value) => draft.receive(resolve(value)));
        return () => { watched.dispose(); draft.dispose(); };
    }, [draft, key, resolve]);
    return { ...useSyncExternalStore(draft.subscribe, draft.getSnapshot), update: draft.edit, retry: draft.retry };
}
