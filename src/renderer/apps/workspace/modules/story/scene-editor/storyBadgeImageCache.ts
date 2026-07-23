import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";

/**
 * Where a story-editor avatar's bytes come from. A character's differential sprite is a *project*
 * asset (the shared asset library, addressed by its `Asset` object); a character's thumbnail is an
 * *editor* asset (the private `editor/assets/` store, addressed by a file id). The two live in
 * different id spaces and load through different services, so a source has to name which — routing by
 * id string alone silently misses (a project id handed to `readRaw` returns not-found and the avatar
 * quietly falls back to the category icon, which was the M1 differential-avatar defect).
 */
export type BadgeImageSource =
    | { kind: "project"; asset: Asset<AssetType.Image> }
    | { kind: "editor"; fileId: string };

/**
 * One shared object URL per asset. `refs` counts the mounted rows subscribed to it; `disposed` guards
 * the in-flight load against a release that lands before the bytes do (so a URL is never created for
 * an entry nobody is watching, which would leak).
 */
type Entry = { url: string | null; refs: number; disposed: boolean };

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function sourceKey(source: BadgeImageSource): string {
    return source.kind === "project" ? `project:${source.asset.id}` : `editor:${source.fileId}`;
}

function emit(key: string): void {
    const set = listeners.get(key);
    if (!set) return;
    for (const listener of set) {
        listener();
    }
}

function retain(key: string, load: () => Promise<Uint8Array | null>): void {
    const existing = entries.get(key);
    if (existing) {
        existing.refs++;
        return;
    }

    const entry: Entry = { url: null, refs: 1, disposed: false };
    entries.set(key, entry);
    void load()
        .then(bytes => {
            // Released while loading: the entry is gone from the map and marked disposed, so drop the
            // bytes rather than mint a URL that would never be revoked.
            if (entry.disposed || !bytes || bytes.byteLength === 0) {
                return;
            }
            // Copy into a fresh Uint8Array so the Blob part is backed by a plain ArrayBuffer (not the
            // SharedArrayBuffer-permitting `ArrayBufferLike` the reader returns).
            entry.url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
            emit(key);
        })
        .catch(() => {
            /* a missing/unreadable asset just stays icon-only */
        });
}

function release(key: string): void {
    const entry = entries.get(key);
    if (!entry) {
        return;
    }
    entry.refs--;
    if (entry.refs > 0) {
        return;
    }
    entry.disposed = true;
    if (entry.url) {
        URL.revokeObjectURL(entry.url);
    }
    entries.delete(key);
}

function addListener(key: string, listener: () => void): void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
}

function removeListener(key: string, listener: () => void): void {
    const set = listeners.get(key);
    if (!set) {
        return;
    }
    set.delete(listener);
    if (set.size === 0) {
        listeners.delete(key);
    }
}

/**
 * The shared object URL for a badge image, deduplicated by asset id across every row that pictures it.
 * All rows showing one sprite share a single blob URL, so its bytes are read once and — because
 * `headCrop`'s silhouette analysis is keyed on the URL — its face is located once, not once per row.
 * The URL is revoked when the last subscribing row unmounts.
 */
export function useBadgeImageUrl(source: BadgeImageSource | null): string | null {
    const { context, isInitialized } = useWorkspace();
    const services = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return {
            assets: context.services.get<AssetsService>(Services.Assets),
            serviceAssets: context.services.get<ServiceAssetsService>(Services.ServiceAssets),
        };
    }, [context, isInitialized]);

    const key = source && services ? sourceKey(source) : null;

    // The loader closes over the current source; held in a ref so the memoized `subscribe` (which only
    // re-runs when `key` changes) always reads a fresh loader without re-subscribing every render.
    const loadRef = useRef<() => Promise<Uint8Array | null>>(() => Promise.resolve(null));
    loadRef.current = () => {
        if (!source || !services) {
            return Promise.resolve(null);
        }
        if (source.kind === "project") {
            return services.assets.fetch(source.asset).then(result => (result.success ? new Uint8Array(result.data.data) : null));
        }
        return services.serviceAssets.readRaw(source.fileId).then(result => (result.ok ? result.data : null));
    };

    const subscribe = useCallback((onChange: () => void) => {
        if (!key) {
            return () => {};
        }
        addListener(key, onChange);
        retain(key, () => loadRef.current());
        return () => {
            removeListener(key, onChange);
            release(key);
        };
    }, [key]);

    const getSnapshot = useCallback(() => (key ? entries.get(key)?.url ?? null : null), [key]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
