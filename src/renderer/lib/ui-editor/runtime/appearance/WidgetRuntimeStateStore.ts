import type { SystemInteractionSignals } from "./SystemInteractionState";

export type WidgetRuntimeSnapshot = {
    hoverTargetId: string | null;
    activePointerId: string | null;
    focusedId: string | null;
    /** Copy for external readers; treat as immutable after getSnapshot. */
    variantOverrides: ReadonlyMap<string, string>;
};

/** Stable snapshot when no provider is mounted (e.g. Dev Mode without store). */
export const STATIC_WIDGET_RUNTIME_SNAPSHOT: WidgetRuntimeSnapshot = Object.freeze({
    hoverTargetId: null,
    activePointerId: null,
    focusedId: null,
    variantOverrides: new Map<string, string>(),
});

/**
 * Widget-local runtime: hover/active/focus targets and optional variant overrides (blueprint in P4).
 * Not persisted; not surface blueprint state.
 */
export class WidgetRuntimeStateStore {
    private hoverTargetId: string | null = null;
    private activePointerId: string | null = null;
    private focusedId: string | null = null;
    private readonly variantOverrides = new Map<string, string>();
    private readonly listeners = new Set<() => void>();
    private snapshot: WidgetRuntimeSnapshot;

    constructor() {
        this.snapshot = this.rebuildSnapshot();
    }

    subscribe = (onStoreChange: () => void): (() => void) => {
        this.listeners.add(onStoreChange);
        return () => this.listeners.delete(onStoreChange);
    };

    getSnapshot = (): WidgetRuntimeSnapshot => this.snapshot;

    private rebuildSnapshot(): WidgetRuntimeSnapshot {
        return {
            hoverTargetId: this.hoverTargetId,
            activePointerId: this.activePointerId,
            focusedId: this.focusedId,
            variantOverrides: new Map(this.variantOverrides),
        };
    }

    private emit(): void {
        this.snapshot = this.rebuildSnapshot();
        for (const fn of this.listeners) {
            fn();
        }
    }

    setHoverTarget(id: string): void {
        if (this.hoverTargetId === id) {
            return;
        }
        this.hoverTargetId = id;
        this.emit();
    }

    clearHoverIf(id: string): void {
        if (this.hoverTargetId !== id) {
            return;
        }
        this.hoverTargetId = null;
        this.emit();
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

    getSignalsForElement(elementId: string, interactionDisabled: boolean | undefined): SystemInteractionSignals {
        return {
            hovered: this.hoverTargetId === elementId,
            active: this.activePointerId === elementId,
            focused: this.focusedId === elementId,
            disabled: Boolean(interactionDisabled),
        };
    }
}
