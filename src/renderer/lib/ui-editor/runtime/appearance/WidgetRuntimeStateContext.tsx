import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { STATIC_WIDGET_RUNTIME_SNAPSHOT, type WidgetRuntimeSnapshot, WidgetRuntimeStateStore } from "./WidgetRuntimeStateStore";

const WidgetRuntimeStateContext = createContext<WidgetRuntimeStateStore | null>(null);

export type WidgetRuntimeStateProviderProps = {
    children: React.ReactNode;
    /** When set, use this store (e.g. Dev Mode shares one instance with Blueprint Host API). */
    externalStore?: WidgetRuntimeStateStore;
};

/**
 * Provides a per-surface widget runtime store (hover/active/focus + variant overrides).
 * Mount with `key={surfaceId}` when switching surfaces so state resets.
 */
export function WidgetRuntimeStateProvider(props: WidgetRuntimeStateProviderProps): React.ReactElement {
    const { children, externalStore } = props;
    const internalStore = useMemo(() => new WidgetRuntimeStateStore(), []);
    const store = externalStore ?? internalStore;
    return <WidgetRuntimeStateContext.Provider value={store}>{children}</WidgetRuntimeStateContext.Provider>;
}

export function useWidgetRuntimeStateStore(): WidgetRuntimeStateStore | null {
    return useContext(WidgetRuntimeStateContext);
}

/** Subscribe to any widget-runtime change (hover/active/focus/variant override). */
export function useWidgetRuntimeSnapshot(): WidgetRuntimeSnapshot {
    const store = useWidgetRuntimeStateStore();
    return useSyncExternalStore(
        store?.subscribe ?? (() => () => {}),
        () => (store ? store.getSnapshot() : STATIC_WIDGET_RUNTIME_SNAPSHOT),
        () => (store ? store.getSnapshot() : STATIC_WIDGET_RUNTIME_SNAPSHOT)
    );
}
