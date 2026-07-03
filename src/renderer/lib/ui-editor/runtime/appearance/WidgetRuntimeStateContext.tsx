import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import {
    STATIC_WIDGET_RUNTIME_SNAPSHOT,
    type UIDisplayableMotionOverride,
    type WidgetRuntimeSnapshot,
    WidgetRuntimeStateStore,
} from "./WidgetRuntimeStateStore";
import {
    DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    type SystemInteractionSignals,
} from "./SystemInteractionState";

const WidgetRuntimeStateContext = createContext<WidgetRuntimeStateStore | null>(null);
const WidgetRuntimeScopeContext = createContext<string | null>(null);
const EMPTY_UNSUBSCRIBE = () => () => {};
const EMPTY_ELEMENT_SIGNATURE = "||0|0|0|0";
const STATIC_WIDGET_RUNTIME_ELEMENT_STATE = Object.freeze({
    variantOverrideId: null,
    signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    displayableMotion: null,
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

export function WidgetRuntimeScopeProvider(props: {
    runtimeScopeId?: string | null;
    children: React.ReactNode;
}): React.ReactElement {
    return (
        <WidgetRuntimeScopeContext.Provider value={props.runtimeScopeId ?? null}>
            {props.children}
        </WidgetRuntimeScopeContext.Provider>
    );
}

export function useWidgetRuntimeStateStore(): WidgetRuntimeStateStore | null {
    return useContext(WidgetRuntimeStateContext);
}

export function useWidgetRuntimeElementKey(elementId: string): string {
    const runtimeScopeId = useContext(WidgetRuntimeScopeContext);
    return runtimeScopeId ? `${runtimeScopeId}\0${elementId}` : elementId;
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
    displayableMotion: UIDisplayableMotionOverride | null;
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
    const displayableMotionId = store.getDisplayableMotion(elementId)?.id ?? "";
    return [
        variantOverrideId,
        displayableMotionId,
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
    const runtimeElementKey = useWidgetRuntimeElementKey(elementId);
    const signature = useSyncExternalStore(
        store?.subscribe ?? EMPTY_UNSUBSCRIBE,
        () => buildElementSignature(store, runtimeElementKey, interactionDisabled),
        () => buildElementSignature(store, runtimeElementKey, interactionDisabled),
    );

    return useMemo(() => {
        void signature;
        if (!store) {
            return STATIC_WIDGET_RUNTIME_ELEMENT_STATE;
        }
        return {
            variantOverrideId: store.getVariantOverride(runtimeElementKey) ?? null,
            signals: store.getSignalsForElement(runtimeElementKey, interactionDisabled),
            displayableMotion: store.getDisplayableMotion(runtimeElementKey),
        };
    }, [interactionDisabled, runtimeElementKey, signature, store]);
}
