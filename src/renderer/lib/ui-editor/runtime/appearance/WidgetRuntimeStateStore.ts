import type { SystemInteractionSignals } from "./SystemInteractionState";
import {
    resolveSliderRuntimeValue,
    type UISliderRuntimeValue,
    type UISliderWidgetProps,
} from "@shared/types/ui-editor/slider";
import {
    resolveTextInputRuntimeValue,
    type UITextInputRuntimeValue,
    type UITextInputWidgetProps,
} from "@shared/types/ui-editor/textInput";

export type UIListRuntimeScrollRequest =
    | { version: number; kind: "index"; index: number }
    | { version: number; kind: "top" }
    | { version: number; kind: "bottom" };
type UIListRuntimeScrollRequestInput = UIListRuntimeScrollRequest extends infer Request
    ? Request extends { version: number }
        ? Omit<Request, "version">
        : never
    : never;

export type UIDisplayableMotionFromCurrentValue = {
    from: "current";
    to: number;
};

export type UIDisplayableMotionValue = number | number[] | UIDisplayableMotionFromCurrentValue;

export type UIDisplayableMotionTarget = {
    x?: UIDisplayableMotionValue;
    y?: UIDisplayableMotionValue;
    scale?: UIDisplayableMotionValue;
    rotate?: UIDisplayableMotionValue;
    opacity?: UIDisplayableMotionValue;
};

export type UIDisplayableMotionTransition =
    | {
          type: "tween";
          durationMs: number;
          delayMs?: number;
          easing?: string;
      }
    | {
          type: "spring";
          delayMs?: number;
          stiffness: number;
          damping: number;
          mass: number;
      };

export type UIDisplayableMotionOverride = {
    id: string;
    target: UIDisplayableMotionTarget;
    transition: UIDisplayableMotionTransition;
    /** One-shot effects such as shake/pulse should hand control back to authored layout when finished. */
    resetOnComplete?: boolean;
};

/**
 * Persistent transform pose layered between the authored layout and the one-shot motion slot.
 * Displayable offsets (and held scale commits) live here instead of inside a motion so that a
 * later motion (variant opacity transition, shake, ...) replacing the single motion slot cannot
 * evict them; motions reset back to this pose, never to the raw origin.
 */
export type UIDisplayableBaseTransform = {
    /** Persistent translate offset in px relative to the authored layout position. */
    offsetX: number;
    offsetY: number;
    /** Persistent scale multiplier committed by held scale animations; 1 = authored size. */
    scale: number;
};

export const DEFAULT_DISPLAYABLE_BASE_TRANSFORM: UIDisplayableBaseTransform = Object.freeze({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
});

function isDefaultDisplayableBaseTransform(value: UIDisplayableBaseTransform): boolean {
    return value.offsetX === 0 && value.offsetY === 0 && value.scale === 1;
}

export type WidgetRuntimeSnapshot = {
    /** Most recently entered hovered widget, kept for compact debug display and backwards compatibility. */
    hoverTargetId: string | null;
    /** All widgets whose pointer boundary currently contains the cursor, including ancestors. */
    hoverTargetIds: ReadonlySet<string>;
    activePointerId: string | null;
    focusedId: string | null;
    /** Copy for external readers; treat as immutable after getSnapshot. */
    variantOverrides: ReadonlyMap<string, string>;
    /** Copy for external readers; treat as immutable after getSnapshot. */
    sliderProperties: ReadonlyMap<string, UISliderRuntimeValue>;
    /** Copy for external readers; treat as immutable after getSnapshot. */
    textInputProperties: ReadonlyMap<string, UITextInputRuntimeValue>;
    /** Runtime List content overrides keyed by runtime-scope element key. */
    listItems: ReadonlyMap<string, readonly unknown[]>;
    listSelectedIndexes: ReadonlyMap<string, number>;
    listScrollRequests: ReadonlyMap<string, UIListRuntimeScrollRequest>;
    displayableMotions: ReadonlyMap<string, UIDisplayableMotionOverride>;
    displayableBaseTransforms: ReadonlyMap<string, UIDisplayableBaseTransform>;
};

/** Stable snapshot when no provider is mounted (e.g. Dev Mode without store). */
export const STATIC_WIDGET_RUNTIME_SNAPSHOT: WidgetRuntimeSnapshot = Object.freeze({
    hoverTargetId: null,
    hoverTargetIds: new Set<string>(),
    activePointerId: null,
    focusedId: null,
    variantOverrides: new Map<string, string>(),
    sliderProperties: new Map<string, UISliderRuntimeValue>(),
    textInputProperties: new Map<string, UITextInputRuntimeValue>(),
    listItems: new Map<string, readonly unknown[]>(),
    listSelectedIndexes: new Map<string, number>(),
    listScrollRequests: new Map<string, UIListRuntimeScrollRequest>(),
    displayableMotions: new Map<string, UIDisplayableMotionOverride>(),
    displayableBaseTransforms: new Map<string, UIDisplayableBaseTransform>(),
});

/**
 * Widget-local runtime: hover/active/focus targets and optional variant overrides (blueprint in P4).
 * Not persisted; not surface blueprint state.
 */
export class WidgetRuntimeStateStore {
    private readonly hoverTargetIds = new Set<string>();
    private activePointerId: string | null = null;
    private focusedId: string | null = null;
    private readonly variantOverrides = new Map<string, string>();
    private readonly sliderProperties = new Map<string, UISliderRuntimeValue>();
    private readonly textInputProperties = new Map<string, UITextInputRuntimeValue>();
    private readonly listItems = new Map<string, unknown[]>();
    private readonly listSelectedIndexes = new Map<string, number>();
    private readonly listScrollRequests = new Map<string, UIListRuntimeScrollRequest>();
    private readonly displayableMotions = new Map<string, UIDisplayableMotionOverride>();
    private readonly displayableBaseTransforms = new Map<string, UIDisplayableBaseTransform>();
    private readonly listeners = new Set<() => void>();
    private readonly runtimePatchListeners = new Set<() => void>();
    private snapshot: WidgetRuntimeSnapshot;
    private listScrollRequestVersion = 0;
    private displayableMotionVersion = 0;

    constructor() {
        this.snapshot = this.rebuildSnapshot();
    }

    subscribe = (onStoreChange: () => void): (() => void) => {
        this.listeners.add(onStoreChange);
        return () => this.listeners.delete(onStoreChange);
    };

    subscribeRuntimePatches = (onStoreChange: () => void): (() => void) => {
        this.runtimePatchListeners.add(onStoreChange);
        return () => this.runtimePatchListeners.delete(onStoreChange);
    };

    getSnapshot = (): WidgetRuntimeSnapshot => this.snapshot;

    private rebuildSnapshot(): WidgetRuntimeSnapshot {
        return {
            hoverTargetId: this.getPrimaryHoverTargetId(),
            hoverTargetIds: new Set(this.hoverTargetIds),
            activePointerId: this.activePointerId,
            focusedId: this.focusedId,
            variantOverrides: new Map(this.variantOverrides),
            sliderProperties: new Map(this.sliderProperties),
            textInputProperties: new Map(this.textInputProperties),
            listItems: new Map(this.listItems),
            listSelectedIndexes: new Map(this.listSelectedIndexes),
            listScrollRequests: new Map(this.listScrollRequests),
            displayableMotions: new Map(this.displayableMotions),
            displayableBaseTransforms: new Map(this.displayableBaseTransforms),
        };
    }

    private emit(): void {
        this.snapshot = this.rebuildSnapshot();
        for (const fn of this.listeners) {
            fn();
        }
    }

    private emitRuntimePatches(): void {
        for (const fn of this.runtimePatchListeners) {
            fn();
        }
    }

    notifyRuntimePatchesChanged(options?: { widgetStateChanged?: boolean }): void {
        if (options?.widgetStateChanged) {
            this.snapshot = this.rebuildSnapshot();
            for (const fn of this.listeners) {
                fn();
            }
        }
        this.emitRuntimePatches();
    }

    private getPrimaryHoverTargetId(): string | null {
        let latest: string | null = null;
        for (const id of this.hoverTargetIds) {
            latest = id;
        }
        return latest;
    }

    setHoverTarget(id: string): void {
        if (this.hoverTargetIds.has(id)) {
            return;
        }
        this.hoverTargetIds.add(id);
        this.emit();
    }

    clearHoverIf(id: string): void {
        if (!this.hoverTargetIds.delete(id)) {
            return;
        }
        this.emit();
    }

    clearInteractionStateForScope(runtimeScopeId?: string | null): void {
        const prefix = runtimeScopeId ? `${runtimeScopeId}\0` : null;
        let changed = false;
        const belongsToScope = (id: string | null): boolean =>
            id != null && (prefix ? id.startsWith(prefix) : true);

        for (const id of [...this.hoverTargetIds]) {
            if (belongsToScope(id)) {
                this.hoverTargetIds.delete(id);
                changed = true;
            }
        }

        if (belongsToScope(this.activePointerId)) {
            this.activePointerId = null;
            changed = true;
        }

        if (belongsToScope(this.focusedId)) {
            this.focusedId = null;
            changed = true;
        }

        if (changed) {
            this.emit();
        }
    }

    setActivePointerTarget(id: string | null): void {
        if (this.activePointerId === id) {
            return;
        }
        this.activePointerId = id;
        this.emit();
    }

    setFocusedTarget(id: string | null): void {
        if (this.focusedId === id) {
            return;
        }
        this.focusedId = id;
        this.emit();
    }

    setVariantOverride(elementId: string, variantId: string | null): void {
        if (variantId === null) {
            if (!this.variantOverrides.has(elementId)) {
                return;
            }
            this.variantOverrides.delete(elementId);
        } else if (this.variantOverrides.get(elementId) === variantId) {
            return;
        } else {
            this.variantOverrides.set(elementId, variantId);
        }
        this.emit();
    }

    getVariantOverride(elementId: string): string | null {
        return this.variantOverrides.get(elementId) ?? null;
    }

    getSliderProperties(elementId: string): UISliderRuntimeValue | undefined {
        return this.sliderProperties.get(elementId);
    }

    setSliderProperties(
        elementId: string,
        currentProps: Partial<UISliderWidgetProps>,
        patch: Partial<UISliderWidgetProps>,
    ): UISliderRuntimeValue {
        const current = this.sliderProperties.get(elementId) ?? resolveSliderRuntimeValue(currentProps);
        const next = resolveSliderRuntimeValue({
            ...currentProps,
            ...current,
            ...patch,
        });
        if (
            current.value === next.value &&
            current.normalizedValue === next.normalizedValue &&
            current.min === next.min &&
            current.max === next.max &&
            current.step === next.step
        ) {
            return current;
        }
        this.sliderProperties.set(elementId, next);
        this.emit();
        return next;
    }

    getTextInputProperties(elementId: string): UITextInputRuntimeValue | undefined {
        return this.textInputProperties.get(elementId);
    }

    setTextInputProperties(
        elementId: string,
        currentProps: Partial<UITextInputWidgetProps>,
        patch: Partial<UITextInputWidgetProps>,
    ): UITextInputRuntimeValue {
        const current = this.textInputProperties.get(elementId) ?? resolveTextInputRuntimeValue(currentProps);
        const next = resolveTextInputRuntimeValue({
            ...currentProps,
            ...current,
            ...patch,
        });
        if (current.value === next.value) {
            return current;
        }
        this.textInputProperties.set(elementId, next);
        this.emit();
        return next;
    }

    getListItems(elementId: string): unknown[] | undefined {
        const items = this.listItems.get(elementId);
        return items ? cloneJson(items) : undefined;
    }

    setListItems(elementId: string, items: readonly unknown[]): void {
        this.listItems.set(elementId, cloneJson([...items]));
        this.emit();
    }

    clearListItems(elementId: string): void {
        const hadItems = this.listItems.delete(elementId);
        const hadSelected = this.listSelectedIndexes.delete(elementId);
        const hadScroll = this.listScrollRequests.delete(elementId);
        if (hadItems || hadSelected || hadScroll) {
            this.emit();
        }
    }

    getListSelectedIndex(elementId: string): number | undefined {
        return this.listSelectedIndexes.get(elementId);
    }

    setListSelectedIndex(elementId: string, index: number): void {
        if (this.listSelectedIndexes.get(elementId) === index) {
            return;
        }
        this.listSelectedIndexes.set(elementId, index);
        this.emit();
    }

    requestListScroll(elementId: string, request: UIListRuntimeScrollRequestInput): void {
        this.listScrollRequestVersion += 1;
        this.listScrollRequests.set(elementId, {
            ...request,
            version: this.listScrollRequestVersion,
        } as UIListRuntimeScrollRequest);
        this.emit();
    }

    /**
     * Returns the persistent base transform pose for an element (stable reference; the shared
     * default object is returned while the element sits at the authored pose).
     */
    getDisplayableBaseTransform(elementId: string): UIDisplayableBaseTransform {
        return this.displayableBaseTransforms.get(elementId) ?? DEFAULT_DISPLAYABLE_BASE_TRANSFORM;
    }

    /**
     * Merges a partial pose into the persistent base transform. Callers batching a base commit
     * with other store mutations (e.g. clearing a completed motion) pass `silent` and notify once
     * through notifyRuntimePatchesChanged so subscribers see a single consistent update.
     */
    setDisplayableBaseTransform(
        elementId: string,
        patch: Partial<UIDisplayableBaseTransform>,
        options?: { silent?: boolean },
    ): boolean {
        const current = this.getDisplayableBaseTransform(elementId);
        const next: UIDisplayableBaseTransform = {
            offsetX: patch.offsetX ?? current.offsetX,
            offsetY: patch.offsetY ?? current.offsetY,
            scale: patch.scale ?? current.scale,
        };
        if (next.offsetX === current.offsetX && next.offsetY === current.offsetY && next.scale === current.scale) {
            return false;
        }
        if (isDefaultDisplayableBaseTransform(next)) {
            this.displayableBaseTransforms.delete(elementId);
        } else {
            this.displayableBaseTransforms.set(elementId, Object.freeze(next));
        }
        if (!options?.silent) {
            this.emit();
            this.emitRuntimePatches();
        }
        return true;
    }

    /**
     * One-shot motion slot: each element holds at most ONE motion and a new motion replaces the
     * previous one. Persistent pose state must therefore live in the base transform (see
     * setDisplayableBaseTransform), never in this slot, or a replacement would silently drop it.
     */
    setDisplayableMotion(
        elementId: string,
        motion: Omit<UIDisplayableMotionOverride, "id"> & { id?: string },
    ): UIDisplayableMotionOverride {
        this.displayableMotionVersion += 1;
        const next: UIDisplayableMotionOverride = {
            ...motion,
            id: motion.id ?? `${this.displayableMotionVersion}`,
        };
        this.displayableMotions.set(elementId, next);
        this.emit();
        this.emitRuntimePatches();
        return next;
    }

    getDisplayableMotion(elementId: string): UIDisplayableMotionOverride | null {
        return this.displayableMotions.get(elementId) ?? null;
    }

    clearDisplayableMotion(elementId: string, options?: { silent?: boolean }): boolean {
        if (!this.displayableMotions.delete(elementId)) {
            return false;
        }
        if (!options?.silent) {
            this.emit();
            this.emitRuntimePatches();
        }
        return true;
    }

    clearDisplayableMotionById(motionId: string): { elementId: string; motion: UIDisplayableMotionOverride } | null {
        for (const [elementId, motion] of this.displayableMotions) {
            if (motion.id !== motionId) {
                continue;
            }
            this.displayableMotions.delete(elementId);
            this.emit();
            this.emitRuntimePatches();
            return { elementId, motion };
        }
        return null;
    }

    completeDisplayableMotion(elementId: string, motionId: string): void {
        const current = this.displayableMotions.get(elementId);
        if (!current || current.id !== motionId || !current.resetOnComplete) {
            return;
        }
        this.displayableMotions.delete(elementId);
        this.emit();
        this.emitRuntimePatches();
    }

    getSignalsForElement(elementId: string, interactionDisabled: boolean | undefined): SystemInteractionSignals {
        return {
            hovered: this.hoverTargetIds.has(elementId),
            active: this.activePointerId === elementId,
            focused: this.focusedId === elementId,
            disabled: Boolean(interactionDisabled),
        };
    }
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
