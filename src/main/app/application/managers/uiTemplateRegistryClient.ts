import {
    DEFAULT_UI_TEMPLATE_REGISTRY_URL,
    UI_TEMPLATE_MAX_ASSET_BYTES,
    UI_TEMPLATE_MAX_ASSETS,
    UI_TEMPLATE_MAX_DOCUMENT_BYTES,
    UI_TEMPLATE_REGISTRY_FETCH_TIMEOUT_MS,
    UI_TEMPLATE_REGISTRY_FORMAT_VERSION,
} from "@shared/constants/uiTemplateRegistry";
import type {
    UITemplateAssetRef,
    UITemplateBundle,
    UITemplateFetchedAsset,
    UITemplatePreview,
    UIThemeDescriptor,
    UITemplateRegistryEntry,
    UITemplateRegistryIndex,
    UITemplateSurfacePlacement,
} from "@shared/types/uiTemplateRegistry";
import { isSafeRelativeEntry } from "@shared/utils/pluginManifest";
import { resolveDownloadSource } from "@shared/utils/downloadSource";
import { applyDownloadRewrite } from "./downloadRewrites";

/**
 * Read-only client for the UI template store.
 *
 * Fetches the registry `index.json` and, for one template, its `UIDocument` +
 * `UIGraphDocument` JSON (plus any declared resources) — all from the same raw
 * blob directory, resolved against the index URL. Unlike the plugin store there
 * is no zip and no release: a template is applied into the open project, never
 * installed to disk. Everything here treats the network as hostile: the index
 * shape is validated, every path is checked against traversal and kept under the
 * registry directory, and each response is size-capped before it is buffered.
 */

const STAGE_SLOT_IDS = new Set(["onStage", "dialog", "notification", "choice", "nvl"]);

const MIME_BY_EXTENSION: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
};

/** Resolve the effective registry URL: a configured value, else the official default. */
export function resolveTemplateRegistryUrl(configured: string | undefined | null): string {
    return resolveDownloadSource(configured, DEFAULT_UI_TEMPLATE_REGISTRY_URL);
}

/**
 * As in the plugin client: the single point a URL becomes a request, so the single point the
 * author's rewrites apply. Template files already follow `uiTemplates.registryUrl` to a mirror
 * (they resolve against its directory), so here a rewrite mostly matters for an author who
 * would rather redirect the official host than restate it.
 */
async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UI_TEMPLATE_REGISTRY_FETCH_TIMEOUT_MS);
    try {
        return await fetch(applyDownloadRewrite(url), { redirect: "follow", signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSurfacePlacement(raw: unknown): UITemplateSurfacePlacement {
    const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = record.kind === "stageSurface" ? "stageSurface" : "appSurface";
    if (kind === "stageSurface") {
        const slotId = asString(record.slotId);
        return { kind, slotId: STAGE_SLOT_IDS.has(slotId) ? (slotId as UITemplateSurfacePlacement["slotId"]) : "onStage" };
    }
    return { kind };
}

function normalizeAssets(raw: unknown): UITemplateAssetRef[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const assets: UITemplateAssetRef[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const record = item as Record<string, unknown>;
        const id = asString(record.id);
        const path = asString(record.path);
        // Drop anything unsafe here so the fetch step never sees a traversal path.
        if (!id || !path || !isSafeRelativeEntry(path)) {
            continue;
        }
        assets.push({ id, path });
    }
    return assets;
}

/**
 * Coerce one raw index record into a {@link UITemplateRegistryEntry}, or `null`
 * if it lacks the fields the store cannot work without (id / path / document /
 * graphs). Being lenient here keeps one malformed entry from blanking the store.
 */
function normalizeUITemplateEntry(raw: unknown): UITemplateRegistryEntry | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const id = asString(record.id);
    const path = asString(record.path);
    const document = asString(record.document);
    const graphs = asString(record.graphs);
    const preview = asString(record.preview);
    // The document/graphs/preview paths must stay inside the template directory.
    if (!id || !path || !document || !graphs) {
        return null;
    }
    if (!isSafeRelativeEntry(document) || !isSafeRelativeEntry(graphs)) {
        return null;
    }
    if (preview && !isSafeRelativeEntry(preview)) {
        return null;
    }
    const theme = asString(record.theme);
    return {
        id,
        theme: theme || undefined,
        name: asString(record.name) || id,
        version: asString(record.version),
        description: asString(record.description),
        publisher: asString(record.publisher),
        categories: asStringArray(record.categories),
        path,
        document,
        graphs,
        preview: preview || undefined,
        surface: normalizeSurfacePlacement(record.surface),
        assets: normalizeAssets(record.assets),
    };
}

/**
 * Coerce one raw theme record, or `null` if it lacks what the store needs to draw
 * a card. `templateCount` is trusted only as a number — the renderer counts the
 * entries it actually has rather than relying on it.
 */
function normalizeThemeDescriptor(raw: unknown): UIThemeDescriptor | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const id = asString(record.id);
    const path = asString(record.path);
    const preview = asString(record.preview);
    if (!id || !path) {
        return null;
    }
    if (preview && !isSafeRelativeEntry(preview)) {
        return null;
    }
    return {
        id,
        name: asString(record.name) || id,
        version: asString(record.version),
        description: asString(record.description),
        publisher: asString(record.publisher),
        path,
        preview: preview || undefined,
        templateCount: typeof record.templateCount === "number" ? record.templateCount : 0,
    };
}

/**
 * Last index read per URL.
 *
 * Opt-in through `maxAgeMs`, exactly as the plugin registry's memo is: a Refresh
 * passes nothing and therefore really goes to the network, while the calls that
 * only need the index to resolve a path — "which file belongs to this template
 * id" — reuse it. Without this, opening the store, entering a theme and adding
 * one screen fetched index.json four times over.
 */
const indexMemo = new Map<string, { at: number; index: UITemplateRegistryIndex }>();

export async function fetchTemplateIndex(
    url: string,
    options: { maxAgeMs?: number } = {},
): Promise<UITemplateRegistryIndex> {
    const maxAgeMs = options.maxAgeMs ?? 0;
    if (maxAgeMs > 0) {
        const cached = indexMemo.get(url);
        if (cached && Date.now() - cached.at <= maxAgeMs) {
            return cached.index;
        }
    }
    const index = await readTemplateIndex(url);
    indexMemo.set(url, { at: Date.now(), index });
    return index;
}

async function readTemplateIndex(url: string): Promise<UITemplateRegistryIndex> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Template registry request failed (${response.status} ${response.statusText})`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await response.text());
    } catch {
        throw new Error("Template registry index is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Template registry index is not an object");
    }
    const record = parsed as Record<string, unknown>;
    if (record.formatVersion !== UI_TEMPLATE_REGISTRY_FORMAT_VERSION) {
        throw new Error(
            `Unsupported template registry format version ${String(record.formatVersion)} (expected ${UI_TEMPLATE_REGISTRY_FORMAT_VERSION})`,
        );
    }
    const templates = Array.isArray(record.templates)
        ? record.templates
            .map(normalizeUITemplateEntry)
            .filter((entry): entry is UITemplateRegistryEntry => entry !== null)
        : [];
    // Additive: a registry that predates themes simply has none, and the store
    // falls back to one flat shelf rather than showing an empty browse level.
    const themes = Array.isArray(record.themes)
        ? record.themes
            .map(normalizeThemeDescriptor)
            .filter((theme): theme is UIThemeDescriptor => theme !== null)
        : [];
    return {
        formatVersion: UI_TEMPLATE_REGISTRY_FORMAT_VERSION,
        repository: asString(record.repository),
        themes,
        templates,
    };
}

/**
 * The directory the index lives in, e.g. `https://.../UI-Templates/master/`.
 * Every template file is resolved against this and required to stay under it, so
 * a crafted `path` cannot walk out of the registry even past the per-segment
 * traversal checks.
 */
function registryBaseDir(indexUrl: string): string {
    const url = new URL(indexUrl);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/[^/]*$/, "");
    return url.toString();
}

/** Resolve a template-relative file to an absolute raw URL, guarding traversal. */
function resolveTemplateFileUrl(baseDir: string, entryPath: string, relativePath: string): string {
    if (!isSafeRelativeEntry(entryPath) || !isSafeRelativeEntry(relativePath)) {
        throw new Error(`Unsafe template path: ${entryPath}/${relativePath}`);
    }
    const joined = `${entryPath.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
    const resolved = new URL(joined, baseDir).toString();
    if (!resolved.startsWith(baseDir)) {
        throw new Error(`Template path escapes the registry directory: ${joined}`);
    }
    return resolved;
}

async function fetchJsonFile(url: string): Promise<unknown> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Template file request failed (${response.status} ${response.statusText})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > UI_TEMPLATE_MAX_DOCUMENT_BYTES) {
        throw new Error("Template document exceeds the maximum size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > UI_TEMPLATE_MAX_DOCUMENT_BYTES) {
        throw new Error("Template document exceeds the maximum size");
    }
    try {
        return JSON.parse(buffer.toString("utf-8"));
    } catch {
        throw new Error("Template document is not valid JSON");
    }
}

function inferMime(fileName: string): string {
    const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
    return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

async function fetchAssetFile(url: string, ref: UITemplateAssetRef): Promise<UITemplateFetchedAsset> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Template resource request failed (${response.status} ${response.statusText})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > UI_TEMPLATE_MAX_ASSET_BYTES) {
        throw new Error("Template resource exceeds the maximum size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > UI_TEMPLATE_MAX_ASSET_BYTES) {
        throw new Error("Template resource exceeds the maximum size");
    }
    const fileName = ref.path.slice(ref.path.lastIndexOf("/") + 1) || ref.id;
    return {
        id: ref.id,
        fileName,
        mime: inferMime(fileName),
        dataBase64: buffer.toString("base64"),
    };
}

/**
 * Fetch each requested theme's poster image.
 *
 * The renderer never reaches the network itself, so the bytes come back base64 and
 * it turns them into a data URL. One theme failing costs its own card.
 */
/** Raw poster bytes, before the cache turns them into a `data:` URL. */
export type FetchedThemePoster = { id: string; mime: string; dataBase64: string };

export async function fetchThemePreviews(
    themes: UIThemeDescriptor[],
    indexUrl: string,
): Promise<FetchedThemePoster[]> {
    const baseDir = registryBaseDir(indexUrl);
    const previews: FetchedThemePoster[] = [];
    for (const theme of themes) {
        if (!theme.preview) {
            continue;
        }
        try {
            const url = resolveTemplateFileUrl(baseDir, theme.path, theme.preview);
            const fetched = await fetchAssetFile(url, { id: theme.id, path: theme.preview });
            previews.push({ id: theme.id, mime: fetched.mime, dataBase64: fetched.dataBase64 });
        } catch (error) {
            console.warn(`[uiTemplates] theme poster unavailable for ${theme.id}`, error);
        }
    }
    return previews;
}

/**
 * Fetch just the `UIDocument` of each requested template, for the store's cards.
 *
 * Deliberately not {@link fetchTemplateBundle} per card: a card is only looked at,
 * and the bundle would pull every template's logic graph and every byte of its
 * resources to draw a thumbnail. One template failing yields no entry for it
 * rather than failing the grid — a card that cannot draw is better than a store
 * that cannot open.
 */
export async function fetchTemplatePreviews(
    entries: UITemplateRegistryEntry[],
    indexUrl: string,
): Promise<UITemplatePreview[]> {
    const baseDir = registryBaseDir(indexUrl);
    const previews: UITemplatePreview[] = [];
    for (const entry of entries) {
        try {
            const document = await fetchJsonFile(resolveTemplateFileUrl(baseDir, entry.path, entry.document));
            previews.push({ id: entry.id, document });
        } catch (error) {
            console.warn(`[uiTemplates] preview unavailable for ${entry.id}`, error);
        }
    }
    return previews;
}

/**
 * Fetch one template's full bundle — both documents and every declared resource —
 * from the registry directory the index came from. Nothing is written to disk;
 * the renderer migrates and applies the result into the open project.
 */
export async function fetchTemplateBundle(
    entry: UITemplateRegistryEntry,
    indexUrl: string,
): Promise<UITemplateBundle> {
    const baseDir = registryBaseDir(indexUrl);

    const document = await fetchJsonFile(resolveTemplateFileUrl(baseDir, entry.path, entry.document));
    const graphs = await fetchJsonFile(resolveTemplateFileUrl(baseDir, entry.path, entry.graphs));

    if (entry.assets.length > UI_TEMPLATE_MAX_ASSETS) {
        throw new Error("Template declares too many resources");
    }
    const assets: UITemplateFetchedAsset[] = [];
    for (const ref of entry.assets) {
        const url = resolveTemplateFileUrl(baseDir, entry.path, ref.path);
        assets.push(await fetchAssetFile(url, ref));
    }

    return {
        id: entry.id,
        surface: entry.surface,
        document,
        graphs,
        assets,
    };
}
