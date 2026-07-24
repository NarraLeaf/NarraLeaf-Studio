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
    UITemplateRegistryEntry,
    UITemplateRegistryIndex,
    UITemplateSurfacePlacement,
} from "@shared/types/uiTemplateRegistry";
import { isSafeRelativeEntry } from "@shared/utils/pluginManifest";

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
    const trimmed = typeof configured === "string" ? configured.trim() : "";
    return trimmed.length > 0 ? trimmed : DEFAULT_UI_TEMPLATE_REGISTRY_URL;
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UI_TEMPLATE_REGISTRY_FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { redirect: "follow", signal: controller.signal });
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
    return {
        id,
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

export async function fetchTemplateIndex(url: string): Promise<UITemplateRegistryIndex> {
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
    return {
        formatVersion: UI_TEMPLATE_REGISTRY_FORMAT_VERSION,
        repository: asString(record.repository),
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
