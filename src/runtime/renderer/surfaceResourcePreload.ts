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
    manifestIds: Set<string>;
    assetIds: Set<string>;
    visitedSurfaces: Set<string>;
    visitedElements: Set<string>;
    visitedComponents: Set<string>;
};

function addAssetId(ctx: CollectContext, value: unknown): void {
    const assetId = typeof value === "string" ? value.trim() : "";
    if (!assetId || !ctx.manifestIds.has(assetId)) {
        return;
    }
    ctx.assetIds.add(assetId);
}

function collectAssetIdsFromValue(ctx: CollectContext, value: unknown, keyHint?: string): void {
    if (keyHint === "assetId" || keyHint === "fontAssetId") {
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
    collectElementTree(ctx, ctx.document.elements[surface.rootElementId], `surface:${surface.id}`);
}

export function collectRuntimeSurfaceAssetIds(pack: GameRuntimePackV1, surface: UISurface): string[] {
    const ctx: CollectContext = {
        document: pack.bundle.ui.uidoc,
        manifestIds: new Set(Object.keys(pack.assets.items)),
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
        manifestIds: new Set(Object.keys(pack.assets.items)),
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

function isFontAsset(entry: GameRuntimeAssetManifestEntry | undefined): boolean {
    const type = entry?.type?.toLowerCase() ?? "";
    const mime = entry?.mimeType?.toLowerCase() ?? "";
    const ext = entry?.ext?.toLowerCase() ?? "";
    return type.includes("font") || mime.startsWith("font/") || [".ttf", ".otf", ".woff", ".woff2"].includes(ext);
}

function isAudioAsset(entry: GameRuntimeAssetManifestEntry | undefined): boolean {
    const type = entry?.type?.toLowerCase() ?? "";
    const mime = entry?.mimeType?.toLowerCase() ?? "";
    return type.includes("audio") || mime.startsWith("audio/");
}

function isVideoAsset(entry: GameRuntimeAssetManifestEntry | undefined): boolean {
    const type = entry?.type?.toLowerCase() ?? "";
    const mime = entry?.mimeType?.toLowerCase() ?? "";
    return type.includes("video") || mime.startsWith("video/");
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
            if (typeof image.decode !== "function") {
                resolve();
                return;
            }
            void image.decode().then(resolve).catch(reject);
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
    if (isFontAsset(input.entry)) {
        await preloadFont(input.assetId, url);
        return;
    }
    if (isAudioAsset(input.entry)) {
        await preloadMedia(url, "audio");
        return;
    }
    if (isVideoAsset(input.entry)) {
        await preloadMedia(url, "video");
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
