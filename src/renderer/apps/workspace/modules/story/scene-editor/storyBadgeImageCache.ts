import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
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
 * an entry nobody is watching, which would leak). `failed` marks an entry whose last load produced no
 * bytes: it stays icon-only, but the next subscriber retries it rather than being pinned to the icon
 * for the entry's whole life. `load` is stored so an asset-content change can re-run it in place.
 */
type Entry = {
    url: string | null;
    refs: number;
    disposed: boolean;
    loading: boolean;
    failed: boolean;
    /** Bumped by every (re)load and by an invalidation. A load that settles after its generation was
     *  superseded (the asset was replaced or deleted mid-fetch) drops its bytes instead of re-minting a
     *  stale URL — which would otherwise resurrect a deleted image or clobber a newer replacement. */
    generation: number;
    load: () => Promise<Uint8Array | null>;
};

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

/**
 * Run the entry's loader and swap its URL in on success. The currently-shown URL survives until the
 * fresh bytes arrive, so a re-load (asset replaced) never flashes back to the fallback icon. No bytes
 * (missing/unreadable) leaves the entry icon-only but `failed`, so a later subscriber can retry.
 */
function beginLoad(key: string, entry: Entry): void {
    // This load owns `entry.generation`; a later load or invalidation bumps it, marking this one stale.
    const generation = ++entry.generation;
    entry.loading = true;
    entry.failed = false;
    void entry.load()
        .then(bytes => {
            // Released (disposed) or superseded (asset replaced/deleted mid-fetch): drop the bytes rather
            // than mint a URL that would leak, clobber a newer image, or resurrect a deleted one.
            if (entry.disposed || entry.generation !== generation) {
                return;
            }
            if (!bytes || bytes.byteLength === 0) {
                entry.failed = true;
                return;
            }
            // Copy into a fresh Uint8Array so the Blob part is backed by a plain ArrayBuffer (not the
            // SharedArrayBuffer-permitting `ArrayBufferLike` the reader returns).
            const nextUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
            if (entry.url) {
                URL.revokeObjectURL(entry.url);
            }
            entry.url = nextUrl;
            emit(key);
        })
        .catch(() => {
            if (!entry.disposed && entry.generation === generation) {
                entry.failed = true;
            }
        })
        .finally(() => {
            // Only the current generation's load owns `loading`; a superseded one must not clear it.
            if (entry.generation === generation) {
                entry.loading = false;
            }
        });
}

function retain(key: string, load: () => Promise<Uint8Array | null>): void {
    const existing = entries.get(key);
    if (existing) {
        existing.refs++;
        // Keep the freshest loader (services/source may have re-resolved) and, if the last attempt
        // came up empty, give this new subscriber a fresh try instead of the pinned fallback icon.
        existing.load = load;
        if (existing.failed && !existing.loading) {
            beginLoad(key, existing);
        }
        return;
    }

    const entry: Entry = { url: null, refs: 1, disposed: false, loading: false, failed: false, generation: 0, load };
    entries.set(key, entry);
    beginLoad(key, entry);
}

/**
 * The bytes behind a project asset changed (`updated`) or the asset is gone (`deleted`). Reload the
 * matching entry so a live sprite replacement refreshes every row picturing it; on delete, drop the
 * stale URL and mark the entry for retry should the id come back.
 */
function invalidate(key: string, gone: boolean): void {
    const entry = entries.get(key);
    if (!entry) {
        return;
    }
    if (gone) {
        // Supersede any in-flight load (so it cannot re-mint the deleted image) and drop the URL. A
        // returning id reloads on the next subscribe via `failed`.
        entry.generation++;
        entry.loading = false;
        if (entry.url) {
            URL.revokeObjectURL(entry.url);
            entry.url = null;
        }
        entry.failed = true;
        emit(key);
        return;
    }
    // Replaced content: a fresh load supersedes any in-flight one and swaps the URL on success.
    beginLoad(key, entry);
}

/**
 * Subscribe the cache to project-asset changes exactly once per `AssetsService`. Differential sprites
 * are project assets (see `BadgeImageSource`), so a content replacement fires `updated`/`deleted` here
 * and the matching `project:<id>` entry refreshes. Never unsubscribed: the service and this module are
 * both window-lifetime singletons (one project = one window), and a new project mounts a new service.
 */
let wiredAssets: AssetsService | null = null;
function ensureAssetInvalidationWired(assets: AssetsService): void {
    if (wiredAssets === assets) {
        return;
    }
    wiredAssets = assets;
    const events = assets.getEvents();
    events.on("updated", asset => invalidate(`project:${asset.id}`, false));
    events.on("deleted", asset => invalidate(`project:${asset.id}`, true));
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

    // Wire the cache to project-asset changes once the services are up, so a live sprite replacement
    // invalidates the shared entry (idempotent per service instance).
    useEffect(() => {
        if (services) {
            ensureAssetInvalidationWired(services.assets);
        }
    }, [services]);

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
