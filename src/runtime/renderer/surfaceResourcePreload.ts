import { UI_FRAME_ELEMENT_TYPE, getUIFrameWidgetProps } from "@shared/types/ui-editor/frame";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import type { GameRuntimeAssetManifestEntry, GameRuntimePackV1 } from "@shared/types/gameRuntime";

export const RUNTIME_SURFACE_PRELOAD_TIMEOUT_MS = 10_000;

export type RuntimeSurfacePreloadResult = {
    assetIds: string[];
    firstSurfaceAssetIds: string[];
    loaded: number;
    firstSurfaceLoaded: number;
    failed: string[];
    firstSurfaceFailed: string[];
    firstSurfaceComplete: boolean;
    timedOut: boolean;
};

type CollectContext = {
    document: UIDocument;
    manifestIds: Set<string> | null;
    assetIds: Set<string>;
    visitedSurfaces: Set<string>;
    visitedElements: Set<string>;
    visitedComponents: Set<string>;
};

function addAssetId(ctx: CollectContext, value: unknown): void {
    const assetId = typeof value === "string" ? value.trim() : "";
    if (!assetId) {
        return;
    }
    // A null set means the pack ships no manifest to check against (a protected build), so the
    // property name is the only evidence that a string is an asset id - which is what it was here
    // anyway: this walk is keyed on exact property names, and the manifest check only ever caught
    // references to assets that had been removed. Those now fail their own fetch instead, which
    // costs one 404 and reports through the same failure list.
    if (ctx.manifestIds && !ctx.manifestIds.has(assetId)) {
        return;
    }
    ctx.assetIds.add(assetId);
}

/**
 * Literal property names that hold a library asset id. `posterAssetId` is here because the walk is
 * keyed on exact names, not a suffix: `nl.video`'s poster would otherwise be skipped and the still
 * shown before playback would pop in mid-scene rather than arriving with the Surface.
 */
const ASSET_ID_PROPERTY_NAMES = new Set(["assetId", "fontAssetId", "posterAssetId"]);

function collectAssetIdsFromValue(ctx: CollectContext, value: unknown, keyHint?: string): void {
    if (keyHint !== undefined && ASSET_ID_PROPERTY_NAMES.has(keyHint)) {
        addAssetId(ctx, value);
    }
    if (!value || typeof value !== "object") {
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectAssetIdsFromValue(ctx, item);
        }
        return;
    }
    for (const [key, nextValue] of Object.entries(value as Record<string, unknown>)) {
        collectAssetIdsFromValue(ctx, nextValue, key);
    }
}

function collectElementTree(
    ctx: CollectContext,
    element: UIElement | undefined,
    sourceKey: string,
    elementMap: Record<string, UIElement> = ctx.document.elements,
): void {
    if (!element) {
        return;
    }
    const visitKey = `${sourceKey}:${element.id}`;
    if (ctx.visitedElements.has(visitKey)) {
        return;
    }
    ctx.visitedElements.add(visitKey);
    collectAssetIdsFromValue(ctx, element.props);
    collectAssetIdsFromValue(ctx, element.extra);
    collectAssetIdsFromValue(ctx, element.valueBindings);

    const link = getUIComponentLink(element);
    if (link && !ctx.visitedComponents.has(link.componentId)) {
        ctx.visitedComponents.add(link.componentId);
        const component = ctx.document.components?.find(item => item.id === link.componentId);
        if (component) {
            collectElementTree(
                ctx,
                component.elements[component.rootElementId],
                `component:${component.id}`,
                component.elements,
            );
        }
    }

    if (element.type === UI_FRAME_ELEMENT_TYPE) {
        const frame = getUIFrameWidgetProps(element);
        if (frame.targetSurfaceId) {
            collectSurfaceAssetIds(ctx, frame.targetSurfaceId);
        }
    }

    for (const childId of element.childrenIds ?? []) {
        collectElementTree(ctx, elementMap[childId], sourceKey, elementMap);
    }
}

function collectSurfaceAssetIds(ctx: CollectContext, surfaceId: string): void {
    if (ctx.visitedSurfaces.has(surfaceId)) {
        return;
    }
    ctx.visitedSurfaces.add(surfaceId);
    const surface = ctx.document.surfaces.find(item => item.id === surfaceId);
    if (!surface) {
        return;
    }
    // The Surface's own settings, not just its widgets: a background picture is the largest thing on
    // the page and the first one an author would notice popping in a frame after the reveal.
    collectAssetIdsFromValue(ctx, surface.settings);
    collectElementTree(ctx, ctx.document.elements[surface.rootElementId], `surface:${surface.id}`);
}

export function collectRuntimeSurfaceAssetIds(pack: GameRuntimePackV1, surface: UISurface): string[] {
    const ctx: CollectContext = {
        document: pack.bundle.ui.uidoc,
        manifestIds: packManifestIds(pack),
        assetIds: new Set(),
        visitedSurfaces: new Set(),
        visitedElements: new Set(),
        visitedComponents: new Set(),
    };
    collectSurfaceAssetIds(ctx, surface.id);
    return [...ctx.assetIds];
}

export function collectRuntimePackAssetIds(pack: GameRuntimePackV1, firstSurface: UISurface): {
    firstSurfaceAssetIds: string[];
    assetIds: string[];
} {
    const firstSurfaceAssetIds = collectRuntimeSurfaceAssetIds(pack, firstSurface);
    const ctx: CollectContext = {
        document: pack.bundle.ui.uidoc,
        manifestIds: packManifestIds(pack),
        assetIds: new Set(),
        visitedSurfaces: new Set(),
        visitedElements: new Set(),
        visitedComponents: new Set(),
    };
    for (const surface of pack.bundle.ui.uidoc.surfaces) {
        collectSurfaceAssetIds(ctx, surface.id);
    }
    const prioritized = new Set<string>();
    for (const assetId of firstSurfaceAssetIds) {
        prioritized.add(assetId);
    }
    for (const assetId of ctx.assetIds) {
        prioritized.add(assetId);
    }
    return {
        firstSurfaceAssetIds,
        assetIds: [...prioritized],
    };
}

/**
 * The manifest ids this pack can be checked against, or null when it ships none.
 *
 * A protected build carries an empty `items` on purpose - see `GameRuntimePackV1.assets` - and a
 * project with no assets at all reaches the same place, which is why "empty" and "absent" answer
 * the same here: in both cases there is nothing to validate against and nothing lost by not trying.
 */
function packManifestIds(pack: GameRuntimePackV1): Set<string> | null {
    const ids = Object.keys(pack.assets.items);
    return ids.length > 0 ? new Set(ids) : null;
}

/** How an asset has to be warmed. The four are warmed by four different browser primitives. */
type PreloadKind = "font" | "audio" | "video" | "image";

function kindFromMediaType(mediaType: string | null | undefined): PreloadKind | null {
    const mime = mediaType?.toLowerCase().split(";")[0].trim() ?? "";
    if (mime.startsWith("font/") || mime === "application/font-woff" || mime === "application/x-font-ttf") {
        return "font";
    }
    if (mime.startsWith("audio/")) {
        return "audio";
    }
    if (mime.startsWith("video/")) {
        return "video";
    }
    if (mime.startsWith("image/")) {
        return "image";
    }
    return null;
}

function kindFromEntry(entry: GameRuntimeAssetManifestEntry | undefined): PreloadKind | null {
    const type = entry?.type?.toLowerCase() ?? "";
    const ext = entry?.ext?.toLowerCase() ?? "";
    if (type.includes("font") || [".ttf", ".otf", ".woff", ".woff2"].includes(ext)) {
        return "font";
    }
    if (type.includes("audio")) {
        return "audio";
    }
    if (type.includes("video")) {
        return "video";
    }
    return kindFromMediaType(entry?.mimeType);
}

/**
 * Ask the shell what an asset is by requesting one byte of it.
 *
 * A shipped protected pack says nothing about its assets, so the only thing that knows a font from
 * a video is the protocol handler, which sniffs the bytes it serves. A one-byte range request gets
 * that answer back in a `Content-Type` for the cost of a round trip - and not a wasted one: the
 * handler reads the entry whole and caches it, so the real request that follows is served from
 * memory rather than decrypted twice.
 *
 * Null on any failure. The caller falls back to warming it as an image, which is what an
 * unrecognised asset got before any of this existed.
 */
async function probePreloadKind(url: string): Promise<PreloadKind | null> {
    try {
        const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
        if (!response.ok && response.status !== 206) {
            return null;
        }
        // The body is unused, but leaving it unread keeps the stream open on some engines.
        await response.arrayBuffer().catch(() => undefined);
        return kindFromMediaType(response.headers.get("content-type"));
    } catch {
        return null;
    }
}

function fontFamilyForAssetId(assetId: string): string {
    return `nlRuntimeFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

async function preloadFont(assetId: string, url: string): Promise<void> {
    if (typeof FontFace === "undefined" || typeof document === "undefined") {
        await fetch(url).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        });
        return;
    }
    const face = new FontFace(fontFamilyForAssetId(assetId), `url("${url.replace(/"/g, '\\"')}")`);
    const loaded = await face.load();
    document.fonts.add(loaded);
}

function preloadImage(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            // decode() pre-rasterizes so the reveal doesn't jank, but the
            // decode queue is tied to rendering: in a hidden page (a web
            // export opened in a background tab) it can stay pending until
            // the tab is fronted, stalling the whole preload into its
            // timeout. The bytes are already loaded here, so when nothing
            // can paint anyway, loading is all that matters.
            const pageHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
            if (typeof image.decode !== "function" || pageHidden) {
                resolve();
                return;
            }
            // A rejected decode() with loaded bytes is environmental
            // (decoder pressure, hidden-page aborts) - truly corrupt images
            // already failed via onerror. Count it preloaded either way.
            void image.decode().then(resolve).catch(() => resolve());
        };
        image.onerror = () => reject(new Error(`Image failed to load: ${url}`));
        image.src = url;
    });
}

function preloadMedia(url: string, kind: "audio" | "video"): Promise<void> {
    return new Promise(resolve => {
        const element = document.createElement(kind);
        const done = () => resolve();
        element.preload = "auto";
        element.addEventListener("canplaythrough", done, { once: true });
        element.addEventListener("loadeddata", done, { once: true });
        element.addEventListener("error", done, { once: true });
        element.src = url;
        element.load();
    });
}

async function preloadAsset(input: {
    assetId: string;
    entry: GameRuntimeAssetManifestEntry | undefined;
    assetUrl: (assetId: string) => string;
}): Promise<void> {
    const url = input.assetUrl(input.assetId);
    const kind = kindFromEntry(input.entry) ?? await probePreloadKind(url) ?? "image";
    if (kind === "font") {
        await preloadFont(input.assetId, url);
        return;
    }
    if (kind === "audio" || kind === "video") {
        await preloadMedia(url, kind);
        return;
    }
    await preloadImage(url);
}

export async function preloadRuntimeSurfaceAssets(input: {
    pack: GameRuntimePackV1;
    surface: UISurface;
    assetUrl: (assetId: string) => string;
    timeoutMs?: number;
}): Promise<RuntimeSurfacePreloadResult> {
    const assetIds = collectRuntimeSurfaceAssetIds(input.pack, input.surface);
    const failed: string[] = [];
    let loaded = 0;
    let completed = false;
    const preloadAll = Promise.all(assetIds.map(async assetId => {
        try {
            await preloadAsset({
                assetId,
                entry: input.pack.assets.items[assetId],
                assetUrl: input.assetUrl,
            });
            loaded += 1;
        } catch {
            failed.push(assetId);
        }
    })).then(() => {
        completed = true;
    });

    await Promise.race([
        preloadAll,
        new Promise(resolve => setTimeout(resolve, input.timeoutMs ?? RUNTIME_SURFACE_PRELOAD_TIMEOUT_MS)),
    ]);

    return {
        assetIds,
        firstSurfaceAssetIds: assetIds,
        loaded,
        firstSurfaceLoaded: loaded,
        failed,
        firstSurfaceFailed: failed,
        firstSurfaceComplete: completed,
        timedOut: !completed,
    };
}

export async function preloadRuntimePackAssets(input: {
    pack: GameRuntimePackV1;
    firstSurface: UISurface;
    assetUrl: (assetId: string) => string;
    timeoutMs?: number;
}): Promise<RuntimeSurfacePreloadResult> {
    const { firstSurfaceAssetIds, assetIds } = collectRuntimePackAssetIds(input.pack, input.firstSurface);
    const firstSurfaceAssetSet = new Set(firstSurfaceAssetIds);
    const remainingAssetIds = assetIds.filter(assetId => !firstSurfaceAssetSet.has(assetId));
    const failed: string[] = [];
    const firstSurfaceFailed: string[] = [];
    let loaded = 0;
    let firstSurfaceLoaded = 0;
    let firstSurfaceComplete = false;
    let completed = false;

    const preloadOne = async (assetId: string, isFirstSurface: boolean) => {
        try {
            await preloadAsset({
                assetId,
                entry: input.pack.assets.items[assetId],
                assetUrl: input.assetUrl,
            });
            loaded += 1;
            if (isFirstSurface) {
                firstSurfaceLoaded += 1;
            }
        } catch {
            failed.push(assetId);
            if (isFirstSurface) {
                firstSurfaceFailed.push(assetId);
            }
        }
    };

    const preloadAll = (async () => {
        await Promise.all(firstSurfaceAssetIds.map(assetId => preloadOne(assetId, true)));
        firstSurfaceComplete = true;
        await Promise.all(remainingAssetIds.map(assetId => preloadOne(assetId, false)));
        completed = true;
    })();

    await Promise.race([
        preloadAll,
        new Promise(resolve => setTimeout(resolve, input.timeoutMs ?? RUNTIME_SURFACE_PRELOAD_TIMEOUT_MS)),
    ]);

    return {
        assetIds,
        firstSurfaceAssetIds,
        loaded,
        firstSurfaceLoaded,
        failed,
        firstSurfaceFailed,
        firstSurfaceComplete,
        timedOut: !completed,
    };
}
