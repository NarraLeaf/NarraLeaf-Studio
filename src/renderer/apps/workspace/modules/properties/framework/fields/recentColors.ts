import { useSyncExternalStore } from "react";
import { RecentColorsService } from "@/lib/workspace/services/core/RecentColorsService";

/**
 * Recently used project colors (most-recent first, de-duplicated, capped). Backed by the
 * per-project {@link RecentColorsService} singleton, so the palette history is saved with the
 * project and resets when switching projects. Used by ProjectPalette / the rich-text toolbar in
 * place of a static web-color list.
 */
function service(): RecentColorsService {
    return RecentColorsService.getInstance();
}

// Module-level so the reference stays stable across renders (avoids useSyncExternalStore re-subscribes).
function subscribe(listener: () => void): () => void {
    return service().subscribe(listener);
}

function getSnapshot(): string[] {
    return service().getColors();
}

export function addRecentColor(color: string): void {
    service().addColor(color);
}

export function getRecentColors(): string[] {
    return service().getColors();
}

export function useRecentColors(): string[] {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
