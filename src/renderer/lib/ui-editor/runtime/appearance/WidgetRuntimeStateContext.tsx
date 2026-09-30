import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
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

/**
 * One drawn instance of a template, when the template is drawn more than once.
 *
 * A list draws the same elements once per row, so `elementId` stops identifying anything that can
 * hold state: hovering row three used to light up all of them, because hover was recorded against
 * the element and every row read it back. Everything that reads or writes widget runtime state does
 * so through {@link useWidgetRuntimeElementKey}, so putting the row here is what makes hover, press,
 * focus and the selected state belong to one row instead of to the template.
 */
export type WidgetRuntimeInstance = {
    /** Distinguishes this drawing of the template from the others. */
    key: string;
    /** Whether the owning list has this row selected. */
    selected: boolean;
};

const WidgetRuntimeInstanceContext = createContext<WidgetRuntimeInstance | null>(null);
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

/**
 * Marks its subtree as one surface's drawing, under that surface's runtime scope.
 *
 * It also starts the instance over. A surface is drawn from its root with no row and no placement of
 * its own, and the runtime writes its widgets' state that way - so a page drawn by a frame that sits
 * in a list row or a component placement must not read its state under the row's or the
 * placement's key. It used to inherit that key from the frame around it, and read every value its
 * own graphs wrote through the template fallback, which nothing subscribes to: a page's Set Variant
 * on its own button changed nothing on screen until something else redrew the button.
 */
export function WidgetRuntimeScopeProvider(props: {
    runtimeScopeId?: string | null;
    children: React.ReactNode;
}): React.ReactElement {
    return (
        <WidgetRuntimeScopeContext.Provider value={props.runtimeScopeId ?? null}>
            <WidgetRuntimeInstanceContext.Provider value={null}>{props.children}</WidgetRuntimeInstanceContext.Provider>
        </WidgetRuntimeScopeContext.Provider>
    );
}

/**
 * Marks its subtree as one drawn instance of a repeated template.
 *
 * The value is rebuilt only when one of its fields changes: it keys every widget runtime read
 * below, so a fresh object each render would resubscribe the whole row.
 */
export function WidgetRuntimeInstanceProvider(props: {
    instance: WidgetRuntimeInstance;
    children: React.ReactNode;
}): React.ReactElement {
    const { key, selected } = props.instance;
    const value = useMemo(() => ({ key, selected }), [key, selected]);
    return (
        <WidgetRuntimeInstanceContext.Provider value={value}>{props.children}</WidgetRuntimeInstanceContext.Provider>
    );
}

export function useWidgetRuntimeStateStore(): WidgetRuntimeStateStore | null {
    return useContext(WidgetRuntimeStateContext);
}

export function useWidgetRuntimeElementKey(elementId: string): string {
    const runtimeScopeId = useContext(WidgetRuntimeScopeContext);
    const instance = useContext(WidgetRuntimeInstanceContext);
    // One spelling with the write side: the host API keys everything it stores by the same address
    // (`widgetAddress.ts`), and a key built two ways stops matching the first time either is touched.
    const address = buildUIWidgetAddress(elementId, instance?.key);
    return runtimeScopeId ? `${runtimeScopeId}\0${address}` : address;
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

/**
 * One value a widget keeps in the runtime store - a slider's value, a switch's check, a text field's
 * text - handed back again only when that value itself moved.
 *
 * Those widgets used to subscribe to the whole snapshot just to be told to read their own value
 * again, so every hover, press and focus anywhere on the page re-rendered every one of them and every
 * part each one places: on a settings page with eighteen sliders, a single pointer moving onto the
 * page cost about two hundred component renders per write, ten writes in a row. The store replaces
 * such a value with a new object whenever it changes and never edits one in place, so its identity
 * is the whole comparison.
 */
export function useWidgetRuntimeStoreValue<T>(read: (store: WidgetRuntimeStateStore) => T): T | undefined {
    const store = useWidgetRuntimeStateStore();
    return useSyncExternalStore(
        store?.subscribe ?? EMPTY_UNSUBSCRIBE,
        () => (store ? read(store) : undefined),
        () => (store ? read(store) : undefined),
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
    const instance = useContext(WidgetRuntimeInstanceContext);
    const runtimeScopeId = useContext(WidgetRuntimeScopeContext);
    /**
     * The key a writer that knows nothing about rows would have used.
     *
     * Kept as a fallback so a blueprint that sets a variant on a template still shows it on every
     * row - which is what it does today, and what it should keep doing until the write side can
     * name a row. A row-specific value, when one exists, wins.
     */
    const templateKey = instance
        ? (runtimeScopeId ? `${runtimeScopeId}\0${elementId}` : elementId)
        : null;
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
        const signals = store.getSignalsForElement(runtimeElementKey, interactionDisabled);
        return {
            variantOverrideId:
                store.getVariantOverride(runtimeElementKey)
                ?? (templateKey ? store.getVariantOverride(templateKey) : undefined)
                ?? null,
            signals: instance?.selected ? { ...signals, selected: true } : signals,
            displayableMotion:
                store.getDisplayableMotion(runtimeElementKey)
                ?? (templateKey ? store.getDisplayableMotion(templateKey) : null),
        };
    }, [instance?.selected, interactionDisabled, runtimeElementKey, signature, store, templateKey]);
}
