import { useSyncExternalStore } from "react";

/**
 * Session-scoped list of recently used project colors (most-recent first, de-duplicated, capped).
 * Used by {@link ProjectPalette} in place of a static web-color list.
 */
const MAX_RECENT_COLORS = 16;

let recent: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function addRecentColor(color: string): void {
    const value = color.trim();
    if (!value) {
        return;
    }
    const next = [value, ...recent.filter(existing => existing.toLowerCase() !== value.toLowerCase())].slice(0, MAX_RECENT_COLORS);
    recent = next;
    emit();
}

export function getRecentColors(): string[] {
    return recent;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useRecentColors(): string[] {
    return useSyncExternalStore(subscribe, getRecentColors, getRecentColors);
}
