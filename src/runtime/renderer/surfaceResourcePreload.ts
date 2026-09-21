import { UI_FRAME_ELEMENT_TYPE, getUIFrameWidgetProps } from "@shared/types/ui-editor/frame";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import type { GameRuntimeAssetManifestEntry, GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { AssetVariantMap } from "@shared/types/assetSet";
import { UI_ASSET_ID_PROPERTY_NAMES } from "@shared/build/uiAssetSlots";
import { blueprintDocumentGraphs } from "@shared/build/blueprintAssetSets";
import { forEachBlueprintAssetSlot, type BlueprintAssetSlotKind } from "@shared/build/blueprintAssetSlots";
import { loadRuntimeFontFace } from "./runtimeFontFaces";

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

/**
 * The ids one record actually fetches, given the id it stores.
 *
 * A record that names an asset set keeps the set id in its props and carries the build's answer
 * beside it (`assetVariants`). The set id names no bytes - fetching it is a guaranteed miss, and in
 * a protected build, where there is no manifest to filter against, a miss that reaches the failure
 * log. What the record can fetch is its members.
 *
 * **Every** member, not the one the current language resolves to: the language button on a title
 * screen changes languages without restarting, so a preload keyed to the language at load would
 * leave the picture the player just switched to arriving late. A runtime axis ships all of its
 * variants for exactly this reason.
 */
function fetchableAssetIds(assetId: string, variants: AssetVariantMap | undefined): string[] {
    const map = variants?.[assetId];
    return map ? [...new Set(Object.values(map))] : [assetId];
}

function addAssetId(ctx: CollectContext, value: unknown, variants?: AssetVariantMap): void {
    const stored = typeof value === "string" ? value.trim() : "";
    if (!stored) {
        return;
    }
    for (const assetId of fetchableAssetIds(stored, variants)) {
        addResolvedAssetId(ctx, assetId);
    }
}

function addResolvedAssetId(ctx: CollectContext, assetId: string): void {
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
 * Literal property names that hold a library asset id.
 *
 * The build's own walk over the same documents (`@shared/build/uiAssetSlots`) publishes this list,
 * and reading it from there rather than keeping a copy is the point: a name only this walk knows is
 * an asset the shipped game fetches and no build ever resolves, and a name only the build knows is
 * an asset resolved into a package nothing preloads. Both failures are silent.
 */
const ASSET_ID_PROPERTY_NAMES = UI_ASSET_ID_PROPERTY_NAMES;

function collectAssetIdsFromValue(
    ctx: CollectContext,
    value: unknown,
    keyHint?: string,
    /** The answers the record being walked carries, so a set id becomes its members. */
    variants?: AssetVariantMap,
): void {
    if (keyHint !== undefined && ASSET_ID_PROPERTY_NAMES.has(keyHint)) {
        addAssetId(ctx, value, variants);
    }
    if (!value || typeof value !== "object") {
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectAssetIdsFromValue(ctx, item, undefined, variants);
        }
        return;
    }
    for (const [key, nextValue] of Object.entries(value as Record<string, unknown>)) {
        collectAssetIdsFromValue(ctx, nextValue, key, variants);
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
    collectAssetIdsFromValue(ctx, element.props, undefined, element.assetVariants);
    collectAssetIdsFromValue(ctx, element.extra, undefined, element.assetVariants);
    collectAssetIdsFromValue(ctx, element.valueBindings, undefined, element.assetVariants);

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

/**
 * The project's default fonts, which no widget names.
 *
 * The walk below is keyed on property names inside the UI document, and a font that every widget
 * inherits appears in none of them - so without this the one typeface the whole game is set in would
 * be the only asset not warmed before the first frame, and the title screen would repaint mid-fade
 * as it arrived. Filtered against the manifest by `addAssetId` like any other id, which is also what
 * drops the built-in system stacks: they are CSS literals with no bytes to fetch.
 */
function collectProjectFontAssetIds(ctx: CollectContext, pack: GameRuntimePackV1): void {
    for (const entry of pack.bundle.fonts ?? []) {
        addAssetId(ctx, entry.assetId);
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
    collectAssetIdsFromValue(ctx, surface.settings, undefined, surface.settings?.assetVariants);
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
    collectProjectFontAssetIds(ctx, pack);
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
    collectProjectFontAssetIds(ctx, pack);
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

const PRELOAD_KIND_FOR_SLOT: Record<BlueprintAssetSlotKind, PreloadKind> = {
    image: "image",
    audio: "audio",
    font: "font",
};

/**
 * Every asset a blueprint names, with the kind its pin says it carries.
 *
 * The interface walk above reads the UI document, and a graph is not in it: a button's click sound
 * (`Play Sound`), a picture a graph swaps in (`Set Image Asset`, an Image Asset literal), a typeface
 * set from a graph. Those used to be fetched - and in a protected build, decrypted whole - at the
 * moment they were first needed, which for a click sound is the player's first click.
 *
 * The walk is the build's own (`forEachBlueprintAssetSlot` over `blueprintDocumentGraphs`), macros
 * included, so there is no second list of which pins hold assets to fall behind the first. A slot
 * naming an asset set warms every member, for the reason the interface walk gives. Filtered against
 * the manifest the same way, which drops nothing in a protected build: that one ships none.
 */
export function collectRuntimeBlueprintAssets(pack: GameRuntimePackV1): { assetId: string; kind: PreloadKind }[] {
    const manifestIds = packManifestIds(pack);
    const found = new Map<string, PreloadKind>();
    for (const graph of blueprintDocumentGraphs(pack.bundle.ui.localBlueprints)) {
        forEachBlueprintAssetSlot(graph, slot => {
            const stored = slot.read();
            if (!stored) {
                return;
            }
            const members = slot.node.assetVariants?.[stored];
            for (const assetId of members ? new Set(Object.values(members)) : [stored]) {
                if (manifestIds && !manifestIds.has(assetId)) {
                    continue;
                }
                if (!found.has(assetId)) {
                    found.set(assetId, PRELOAD_KIND_FOR_SLOT[slot.kind]);
                }
            }
        });
    }
    return [...found].map(([assetId, kind]) => ({ assetId, kind }));
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

/**
 * What the pack's own manifest says an asset is, when it says anything.
 *
 * All four kinds are read off `type`, the image one included. Leaving image out was not a smaller
 * list, it was a round trip: a real pack records `{type:"image", ext:"bin",
 * mimeType:"application/octet-stream"}` for a library picture - the packer renames every asset to a
 * content-addressed `.bin` and does not sniff it - so every image fell through to
 * {@link probePreloadKind} and asked the shell what it was holding. The manifest had the answer all
 * along, and a protected build, which ships no manifest, still probes exactly as before.
 *
 * `ext` is compared without its dot, which is how the manifest stores it. The list used to be
 * written with dots and so matched nothing, ever; the font case was carried entirely by `type`.
 */
function kindFromEntry(entry: GameRuntimeAssetManifestEntry | undefined): PreloadKind | null {
    const type = entry?.type?.toLowerCase() ?? "";
    const ext = entry?.ext?.toLowerCase().replace(/^\./, "") ?? "";
    if (type.includes("font") || ["ttf", "otf", "woff", "woff2"].includes(ext)) {
        return "font";
    }
    if (type.includes("audio")) {
        return "audio";
    }
    if (type.includes("video")) {
        return "video";
    }
    if (type.includes("image")) {
        return "image";
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

/**
 * Warm a typeface by registering it, through the registry the widgets read.
 *
 * Registering rather than merely fetching is the whole point of warming a font: the bytes alone
 * would leave every text widget to build a `FontFace` of its own. See `runtimeFontFaces`.
 */
async function preloadFont(assetId: string, url: string): Promise<void> {
    await loadRuntimeFontFace(assetId, url);
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
    /** Known from where the id was found - a blueprint pin says what it carries. */
    kind?: PreloadKind;
}): Promise<void> {
    const url = input.assetUrl(input.assetId);
    const kind = input.kind ?? kindFromEntry(input.entry) ?? await probePreloadKind(url) ?? "image";
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

/**
 * Told after every asset, warmed or failed, with how far the pass has got.
 *
 * `settled` rather than `loaded`: a broken asset is one this pass will never come back to, so
 * counting it as still outstanding would leave a progress bar short of its end for the rest of the
 * boot. `total` never moves - the list is assembled before the first fetch.
 */
export type RuntimePreloadProgress = (settled: number, total: number) => void;

/**
 * How many assets the warm-up behind the first frame fetches at once.
 *
 * The first screen's assets are all requested together, because the player is waiting on exactly
 * those. The rest are not waited on by anyone, and a pack with a gallery's worth of pictures
 * requested in one go would put hundreds of reads and decodes in front of the story compile and the
 * opening scene - the work that decides when the player first sees the game move.
 */
const BACKGROUND_PRELOAD_CONCURRENCY = 4;

/**
 * Warm everything the shipped game's interface names, and say as soon as the first screen can show.
 *
 * # The wait is the first screen, not the pack
 *
 * This used to be one wait over every asset of every page: the boot held its first frame - and the
 * story compile behind it - until a settings page's backdrop and a gallery's thumbnails had all
 * decoded. `onFirstSurfaceSettled` is the moment the entry page's own assets (and the project's
 * fonts, which every page is set in) have settled, and it is the only thing a caller should gate on.
 * Everything else keeps warming afterwards, a few at a time, ahead of the player getting there.
 *
 * A page opened before its assets arrive still draws correctly - a picture decodes on first use and
 * the page's own prepaint waits for its fonts - it is only later than it would have been.
 *
 * # What is warmed
 *
 * The interface document (`collectRuntimePackAssetIds`) and every asset a blueprint names
 * (`collectRuntimeBlueprintAssets`): a button's click sound or a picture a graph swaps in is fetched
 * - and in a protected build decrypted - on first use otherwise, which is the first click.
 *
 * The returned promise settles when everything has, or when `timeoutMs` has passed; the same budget
 * caps how long `onFirstSurfaceSettled` can be held back by an asset that never answers.
 */
export async function preloadRuntimePackAssets(input: {
    pack: GameRuntimePackV1;
    firstSurface: UISurface;
    assetUrl: (assetId: string) => string;
    timeoutMs?: number;
    /** Progress of the first screen's assets - the wait a loading state is drawing. */
    onProgress?: RuntimePreloadProgress;
    /** Told once: the first screen may show. `complete` is false when the budget ran out first. */
    onFirstSurfaceSettled?: (outcome: { complete: boolean }) => void;
}): Promise<RuntimeSurfacePreloadResult> {
    const { firstSurfaceAssetIds, assetIds: interfaceAssetIds } = collectRuntimePackAssetIds(input.pack, input.firstSurface);
    const firstSurfaceAssetSet = new Set(firstSurfaceAssetIds);
    /**
     * The warm-up's order: what a click can need, then the other pages, then whatever else a graph
     * names. A blueprint's sounds come first because the first thing a player does on the title
     * screen is press something, and a click sound is small; measured on the shipped skeleton with a
     * heavy Load page, they arrived 2.4 s in when they queued behind that page's pictures.
     */
    const blueprintAssets = collectRuntimeBlueprintAssets(input.pack)
        .filter(named => !firstSurfaceAssetSet.has(named.assetId));
    const background: { assetId: string; kind?: PreloadKind }[] = [];
    const queued = new Set(firstSurfaceAssetIds);
    const enqueue = (item: { assetId: string; kind?: PreloadKind }) => {
        if (!queued.has(item.assetId)) {
            queued.add(item.assetId);
            background.push(item);
        }
    };
    blueprintAssets.filter(named => named.kind === "audio").forEach(enqueue);
    interfaceAssetIds.forEach(assetId => enqueue({ assetId }));
    blueprintAssets.forEach(enqueue);
    const assetIds = [...firstSurfaceAssetIds, ...background.map(item => item.assetId)];
    const timeoutMs = input.timeoutMs ?? RUNTIME_SURFACE_PRELOAD_TIMEOUT_MS;
    const failed: string[] = [];
    const firstSurfaceFailed: string[] = [];
    let loaded = 0;
    let firstSurfaceSettled = 0;
    let firstSurfaceLoaded = 0;
    let firstSurfaceComplete = false;
    let completed = false;

    const preloadOne = async (assetId: string, isFirstSurface: boolean, kind?: PreloadKind) => {
        try {
            await preloadAsset({
                assetId,
                entry: input.pack.assets.items[assetId],
                assetUrl: input.assetUrl,
                kind,
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
        // Only the first screen's assets move the bar: they are the whole of what anyone is waiting
        // for, and a bar that went on counting a gallery's thumbnails would be answering "how much
        // longer" for a wait that is already over.
        if (isFirstSurface) {
            firstSurfaceSettled += 1;
            input.onProgress?.(firstSurfaceSettled, firstSurfaceAssetIds.length);
        }
    };

    const budget = new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), timeoutMs));
    const firstPass = Promise.all(firstSurfaceAssetIds.map(assetId => preloadOne(assetId, true))).then(() => {
        firstSurfaceComplete = true;
    });

    const preloadAll = (async () => {
        const first = await Promise.race([firstPass.then(() => "done" as const), budget]);
        input.onFirstSurfaceSettled?.({ complete: first === "done" });
        let next = 0;
        const worker = async () => {
            while (next < background.length) {
                const item = background[next];
                next += 1;
                await preloadOne(item.assetId, false, item.kind);
            }
        };
        await Promise.all(Array.from(
            { length: Math.min(BACKGROUND_PRELOAD_CONCURRENCY, background.length) },
            () => worker(),
        ));
        await firstPass;
        completed = true;
    })();

    await Promise.race([preloadAll, budget]);

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
