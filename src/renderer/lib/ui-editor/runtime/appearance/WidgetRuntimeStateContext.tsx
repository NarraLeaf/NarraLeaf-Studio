import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { STATIC_WIDGET_RUNTIME_SNAPSHOT, type WidgetRuntimeSnapshot, WidgetRuntimeStateStore } from "./WidgetRuntimeStateStore";
import {
    DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    type SystemInteractionSignals,
} from "./SystemInteractionState";

const WidgetRuntimeStateContext = createContext<WidgetRuntimeStateStore | null>(null);
const EMPTY_UNSUBSCRIBE = () => () => {};
const EMPTY_ELEMENT_SIGNATURE = "0|0|0|0|";
const STATIC_WIDGET_RUNTIME_ELEMENT_STATE = Object.freeze({
    variantOverrideId: null,
    signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
});

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

export type WidgetRuntimeElementState = {
    variantOverrideId: string | null;
    signals: SystemInteractionSignals;
};

function buildElementSignature(
    store: WidgetRuntimeStateStore | null,
    elementId: string,
    interactionDisabled: boolean,
): string {
    if (!store) {
        return EMPTY_ELEMENT_SIGNATURE;
    }
    const signals = store.getSignalsForElement(elementId, interactionDisabled);
    const variantOverrideId = store.getVariantOverride(elementId) ?? "";
    return [
        variantOverrideId,
        signals.hovered ? "1" : "0",
        signals.active ? "1" : "0",
        signals.focused ? "1" : "0",
        signals.disabled ? "1" : "0",
    ].join("|");
}

/**
 * Subscribe to the runtime state used by one widget only.
 * This avoids re-rendering every widget on unrelated hover/active/focus updates.
 */
export function useWidgetRuntimeElementState(
    elementId: string,
    interactionDisabled = false,
): WidgetRuntimeElementState {
    const store = useWidgetRuntimeStateStore();
    const signature = useSyncExternalStore(
        store?.subscribe ?? EMPTY_UNSUBSCRIBE,
        () => buildElementSignature(store, elementId, interactionDisabled),
        () => buildElementSignature(store, elementId, interactionDisabled),
    );

    return useMemo(() => {
        void signature;
        if (!store) {
            return STATIC_WIDGET_RUNTIME_ELEMENT_STATE;
        }
        return {
            variantOverrideId: store.getVariantOverride(elementId) ?? null,
            signals: store.getSignalsForElement(elementId, interactionDisabled),
        };
    }, [elementId, interactionDisabled, signature, store]);
}
