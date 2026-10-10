import { unpatchedFsPromises as fs } from "../../../utils/unpatchedFs";
import path from "path";
import {
    DEFAULT_PLUGIN_REGISTRY_URL,
    PLUGIN_REGISTRY_FETCH_TIMEOUT_MS,
    PLUGIN_REGISTRY_FORMAT_VERSION,
    PLUGIN_REGISTRY_MAX_DOWNLOAD_BYTES,
} from "@shared/constants/pluginRegistry";
import { PLUGIN_ICON_MAX_BYTES } from "@shared/constants/pluginIcon";
import { normalizeLocalizedTextPack } from "@shared/types/localizedText";
import type {
    PluginRegistryEntry,
    PluginRegistryIndex,
} from "@shared/types/pluginRegistry";
import type { StoreSourceChoice } from "@shared/constants/storeSource";
import { parseZipIndex, readEntryBytes } from "../../../buildWorker/mobile/zipModel";
import { applyDownloadRewrite } from "./downloadRewrites";
import { studioFetch } from "./downloadProxy";
import { resolveDownloadSource } from "@shared/utils/downloadSource";
import { fetchFromStore, readStoreCatalogue, storeChoiceKey, storeLinkOn, type StoreOrigin } from "./storeSource";

/**
 * Read-only client for the plugin store.
 *
 * Fetches the registry `index.json` and downloads a plugin's release `.zip`,
 * unpacking it with the repo's own zip reader ({@link parseZipIndex} /
 * {@link readEntryBytes}) so the store needs no new dependency. Everything here
 * treats the network as hostile: the index shape is validated, the archive is
 * size-capped before it touches disk, and every entry is guarded against
 * zip-slip path traversal.
 */

/** Resolve the effective registry URL: a configured value, else the official default. */
export function resolveRegistryUrl(configured: string | undefined | null): string {
    return resolveDownloadSource(configured, DEFAULT_PLUGIN_REGISTRY_URL);
}

/**
 * The one place this module turns a URL into a request, and therefore the one place the
 * author's rewrites apply.
 *
 * That matters most for the plugin package: its address comes out of the index as an absolute
 * `github.com` release URL, so `plugins.registryUrl` can never reach it. Before this, an author
 * behind a mirror could browse the entire store and have every Install time out.
 */
async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLUGIN_REGISTRY_FETCH_TIMEOUT_MS);
    try {
        return await studioFetch(applyDownloadRewrite(url), { redirect: "follow", signal: controller.signal });
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

/**
 * An `https` URL, or `undefined`.
 *
 * The store renders the icon URL directly in an `<img>`, so this is the point
 * where a hostile index is stopped from handing the renderer a `file:`,
 * `data:` or `javascript:` address.
 */
function asHttpsUrl(value: unknown): string | undefined {
    const raw = asString(value).trim();
    if (!raw) {
        return undefined;
    }
    try {
        return new URL(raw).protocol === "https:" ? raw : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Coerce one raw index record into a {@link PluginRegistryEntry}, or `null` if
 * it lacks the fields the store cannot work without (id / version / download).
 * Being lenient here keeps one malformed entry from blanking the whole store.
 */
function normalizeEntry(raw: unknown): PluginRegistryEntry | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const release = (record.release && typeof record.release === "object" ? record.release : {}) as Record<string, unknown>;
    const id = asString(record.id);
    const version = asString(record.version);
    const download = asString(release.download);
    if (!id || !version || !download) {
        return null;
    }
    const targets = asStringArray(record.targets).filter(
        (target): target is "studio" | "runtime" => target === "studio" || target === "runtime",
    );
    const locales = normalizeLocalizedTextPack(record.locales);
    return {
        id,
        name: asString(record.name) || id,
        version,
        description: asString(record.description),
        publisher: asString(record.publisher),
        targets,
        categories: asStringArray(record.categories),
        keywords: asStringArray(record.keywords),
        license: asString(record.license),
        icon: asHttpsUrl(record.icon),
        homepage: asString(record.homepage) || undefined,
        studioVersion: asString(record.studioVersion) || undefined,
        ...(Object.keys(locales).length > 0 ? { locales } : {}),
        permissions: Array.isArray(record.permissions) ? (record.permissions as PluginRegistryEntry["permissions"]) : [],
        release: {
            tag: asString(release.tag),
            page: asString(release.page),
            download,
        },
    };
}

/** The store's catalogue, and the host it came from - which is where its packages and icons come from. */
export type PluginCatalogue = { index: PluginRegistryIndex; origin: StoreOrigin };

/**
 * Last catalogue read per store choice.
 *
 * Only {@link fetchPluginCatalogue} with a `maxAgeMs` reads it, and nothing else
 * in the store does — a Refresh must really go to the network. It exists so the
 * icon proxy can resolve "which URL belongs to this plugin id" without one
 * index round trip per row. Keeping the origin with it also keeps the icons on
 * the host the list came from.
 */
const catalogueMemo = new Map<string, { at: number; catalogue: PluginCatalogue }>();

/** Read the catalogue from where the store source setting says (see `storeSource.ts`). */
export async function fetchPluginCatalogue(
    choice: StoreSourceChoice,
    options: { maxAgeMs?: number } = {},
): Promise<PluginCatalogue> {
    const key = storeChoiceKey(choice);
    const maxAgeMs = options.maxAgeMs ?? 0;
    if (maxAgeMs > 0) {
        const cached = catalogueMemo.get(key);
        if (cached && Date.now() - cached.at <= maxAgeMs) {
            return cached.catalogue;
        }
    }
    const { value: index, origin } = await readStoreCatalogue({
        choice,
        officialUrl: DEFAULT_PLUGIN_REGISTRY_URL,
        customUrl: resolveRegistryUrl(choice.customUrl),
        read: fetchRegistryIndex,
    });
    const catalogue = { index, origin };
    catalogueMemo.set(key, { at: Date.now(), catalogue });
    return catalogue;
}

/**
 * The catalogue as the renderer is handed it: the same entries, with the release page on the host
 * the catalogue came from, so "Open release page" opens where the author's network reaches. Every
 * address the main process downloads stays as the catalogue wrote it.
 */
export function presentPluginCatalogue(catalogue: PluginCatalogue): PluginRegistryIndex {
    return {
        ...catalogue.index,
        plugins: catalogue.index.plugins.map(plugin => ({
            ...plugin,
            release: { ...plugin.release, page: plugin.release.page && storeLinkOn(catalogue.origin, plugin.release.page) },
        })),
    };
}

/** Read and validate one registry index at `url`. */
export async function fetchRegistryIndex(url: string): Promise<PluginRegistryIndex> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Registry request failed (${response.status} ${response.statusText})`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await response.text());
    } catch {
        throw new Error("Registry index is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Registry index is not an object");
    }
    const record = parsed as Record<string, unknown>;
    if (record.formatVersion !== PLUGIN_REGISTRY_FORMAT_VERSION) {
        throw new Error(
            `Unsupported registry format version ${String(record.formatVersion)} (expected ${PLUGIN_REGISTRY_FORMAT_VERSION})`,
        );
    }
    const plugins = Array.isArray(record.plugins)
        ? record.plugins.map(normalizeEntry).filter((entry): entry is PluginRegistryEntry => entry !== null)
        : [];
    return {
        formatVersion: PLUGIN_REGISTRY_FORMAT_VERSION,
        repository: asString(record.repository),
        plugins,
    };
}

async function downloadPackage(url: string): Promise<Buffer> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Plugin download failed (${response.status} ${response.statusText})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > PLUGIN_REGISTRY_MAX_DOWNLOAD_BYTES) {
        throw new Error("Plugin package exceeds the maximum download size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > PLUGIN_REGISTRY_MAX_DOWNLOAD_BYTES) {
        throw new Error("Plugin package exceeds the maximum download size");
    }
    return buffer;
}

/**
 * Unpack a plugin `.zip` into `destDir` and return the directory that holds
 * `manifest.json` - the registry packages one top-level `<pluginId>/` folder, so
 * that is a nested subdirectory. The shallowest `manifest.json` wins, in case a
 * bundled dependency ships one of its own.
 */
export async function extractPluginZip(buffer: Buffer, destDir: string): Promise<string> {
    const index = parseZipIndex(buffer);
    const root = path.resolve(destDir);
    await fs.mkdir(root, { recursive: true });
    let manifestDir: string | null = null;

    for (const entry of index.entries) {
        if (entry.isDirectory) {
            continue;
        }
        const normalized = entry.name.replace(/\\/g, "/");
        const target = path.resolve(root, ...normalized.split("/"));
        const relative = path.relative(root, target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Plugin package entry escapes the extract directory: ${entry.name}`);
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, readEntryBytes(buffer, entry));
        if (path.basename(normalized) === "manifest.json") {
            const dir = path.dirname(target);
            if (!manifestDir || dir.length < manifestDir.length) {
                manifestDir = dir;
            }
        }
    }

    if (!manifestDir) {
        throw new Error("Plugin package does not contain a manifest.json");
    }
    return manifestDir;
}

/**
 * Download a registry entry's package from the catalogue's host and extract it, returning its
 * manifest directory and the address it came from.
 *
 * The archive's directory is read before it counts as downloaded, so a host that answers with
 * something other than a zip (a block page, a truncated body) hands over to the other host instead
 * of failing the install.
 */
export async function downloadAndExtract(
    entry: PluginRegistryEntry,
    origin: StoreOrigin,
    destDir: string,
): Promise<{ manifestDir: string; url: string }> {
    const { value: buffer, url } = await fetchFromStore(origin, entry.release.download, async address => {
        const bytes = await downloadPackage(address);
        parseZipIndex(bytes);
        return bytes;
    });
    return { manifestDir: await extractPluginZip(buffer, destDir), url };
}

/**
 * Fetch a store thumbnail, refusing anything past the icon byte budget.
 *
 * Separate from {@link downloadPackage} because the ceilings are three orders of
 * magnitude apart: a plugin may be 25 MB, an icon may not be half a megabyte,
 * and applying the package limit here would let the registry hand the cache an
 * arbitrary blob to keep forever.
 */
export async function downloadIcon(url: string): Promise<Buffer> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Plugin icon download failed (${response.status} ${response.statusText})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > PLUGIN_ICON_MAX_BYTES) {
        throw new Error("Plugin icon exceeds the maximum size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > PLUGIN_ICON_MAX_BYTES) {
        throw new Error("Plugin icon exceeds the maximum size");
    }
    return buffer;
}
