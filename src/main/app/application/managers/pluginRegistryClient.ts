import fs from "fs/promises";
import path from "path";
import {
    DEFAULT_PLUGIN_REGISTRY_URL,
    PLUGIN_REGISTRY_FETCH_TIMEOUT_MS,
    PLUGIN_REGISTRY_FORMAT_VERSION,
    PLUGIN_REGISTRY_MAX_DOWNLOAD_BYTES,
} from "@shared/constants/pluginRegistry";
import type {
    PluginRegistryEntry,
    PluginRegistryIndex,
} from "@shared/types/pluginRegistry";
import { parseZipIndex, readEntryBytes } from "../../../buildWorker/mobile/zipModel";

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
    const trimmed = typeof configured === "string" ? configured.trim() : "";
    return trimmed.length > 0 ? trimmed : DEFAULT_PLUGIN_REGISTRY_URL;
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLUGIN_REGISTRY_FETCH_TIMEOUT_MS);
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
        homepage: asString(record.homepage) || undefined,
        studioVersion: asString(record.studioVersion) || undefined,
        permissions: Array.isArray(record.permissions) ? (record.permissions as PluginRegistryEntry["permissions"]) : [],
        release: {
            tag: asString(release.tag),
            page: asString(release.page),
            download,
        },
    };
}

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

/** Download a registry entry's package and extract it, returning its manifest directory. */
export async function downloadAndExtract(entry: PluginRegistryEntry, destDir: string): Promise<string> {
    const buffer = await downloadPackage(entry.release.download);
    return extractPluginZip(buffer, destDir);
}
