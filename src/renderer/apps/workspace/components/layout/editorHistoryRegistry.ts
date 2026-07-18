import { useEffect, useRef } from "react";

/**
 * The unified editor-history contract. Every editor with undo/redo registers one of these per
 * tab; the shared toolbar controls (EditorHistoryControls) and the History panel read whatever
 * the *active* tab registered — they never know which editor they are talking to.
 *
 * `canUndo/canRedo` are advisory display state: editors with ref-based stacks (story, story
 * motion) cannot always report precisely, so `undo()`/`redo()` must be safe to call when there
 * is nothing to do.
 */
export interface EditorHistorySnapshot {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
}

const providers = new Map<string, EditorHistorySnapshot>();
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function getEditorHistory(tabId: string | null | undefined): EditorHistorySnapshot | undefined {
    return tabId ? providers.get(tabId) : undefined;
}

/** Notifies on any provider registration, removal, or snapshot change. */
export function subscribeEditorHistory(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Register/refresh this tab's history capabilities. Call every render with current values — the
 * registry broadcasts only when the observable state actually changed, so render-frequency calls
 * are free. The registration is removed when the component unmounts.
 */
export function useEditorHistoryProvider(tabId: string | undefined, snapshot: EditorHistorySnapshot): void {
    const snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;

    // Stable delegating callbacks, so consumers can hold one object identity per tab.
    const stableRef = useRef<EditorHistorySnapshot | null>(null);

    useEffect(() => {
        if (!tabId) {
            return;
        }
        stableRef.current = {
            canUndo: snapshotRef.current.canUndo,
            canRedo: snapshotRef.current.canRedo,
            undo: () => snapshotRef.current.undo(),
            redo: () => snapshotRef.current.redo(),
        };
        providers.set(tabId, stableRef.current);
        emit();
        return () => {
            providers.delete(tabId);
            stableRef.current = null;
            emit();
        };
    }, [tabId]);

    // Push can-state changes into the stable registration (and notify) without re-registering.
    useEffect(() => {
        const registered = stableRef.current;
        if (!registered) {
            return;
        }
        if (registered.canUndo !== snapshot.canUndo || registered.canRedo !== snapshot.canRedo) {
            registered.canUndo = snapshot.canUndo;
            registered.canRedo = snapshot.canRedo;
            emit();
        }
    });
}
