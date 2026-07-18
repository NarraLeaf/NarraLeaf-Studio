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

    // Registrations are replaced, never mutated: `useSyncExternalStore` compares snapshots by
    // identity, so an in-place can-state edit would notify subscribers that then see no change
    // and skip the re-render. The delegating callbacks read the ref, so the identity swap costs
    // nothing but a shallow object.
    const register = (id: string, canUndo: boolean, canRedo: boolean) => {
        providers.set(id, {
            canUndo,
            canRedo,
            undo: () => snapshotRef.current.undo(),
            redo: () => snapshotRef.current.redo(),
        });
        emit();
    };

    useEffect(() => {
        if (!tabId) {
            return;
        }
        register(tabId, snapshotRef.current.canUndo, snapshotRef.current.canRedo);
        return () => {
            providers.delete(tabId);
            emit();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabId]);

    // Re-register whenever the observable state changes, so subscribers see a new identity.
    useEffect(() => {
        if (!tabId) {
            return;
        }
        const registered = providers.get(tabId);
        if (registered && (registered.canUndo !== snapshot.canUndo || registered.canRedo !== snapshot.canRedo)) {
            register(tabId, snapshot.canUndo, snapshot.canRedo);
        }
    });
}
