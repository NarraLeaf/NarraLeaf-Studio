import { createHash } from "crypto";
import {
    DEFAULT_SPELLCHECK_REGISTRY_URL,
    SPELLCHECK_CODE_PATTERN,
    SPELLCHECK_MAX_DOWNLOAD_BYTES,
    SPELLCHECK_REGISTRY_FETCH_TIMEOUT_MS,
    SPELLCHECK_REGISTRY_FORMAT_VERSION,
} from "@shared/constants/spellcheckRegistry";
import type { SpellcheckRegistryEntry, SpellcheckRegistryIndex } from "@shared/types/spellcheckRegistry";
import { resolveDownloadSource } from "@shared/utils/downloadSource";
import { applyDownloadRewrite } from "../downloadRewrites";

/**
 * Read-only client for the dictionary registry.
 *
 * Modelled on `pluginRegistryClient` deliberately - it is the same job with a different payload,
 * and a second mechanism for "fetch an index, validate it, download one entry" would be a second
 * place for the network to be got wrong. Everything here treats the index as hostile: the shape is
 * validated field by field, `https:` is the only scheme accepted, the download is size-capped
 * before and after it arrives, and the bytes are refused unless their sha256 is the one the index
 * named.
 *
 * Every request goes through {@link applyDownloadRewrite}, so an author behind a national firewall
 * can point both the index and the per-entry download at a mirror. That matters here for the same
 * reason it does in the plugin store: an entry's `download` is an absolute URL out of the index, so
 * redirecting the index alone would leave every install timing out.
 */

/** Resolve the effective registry URL: a configured value, else the official default. */
export function resolveDictionaryRegistryUrl(configured: string | undefined | null): string {
    return resolveDownloadSource(configured, DEFAULT_SPELLCHECK_REGISTRY_URL);
}

/** The one place this module turns a URL into a request, and therefore where rewrites apply. */
async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPELLCHECK_REGISTRY_FETCH_TIMEOUT_MS);
    try {
        return await fetch(applyDownloadRewrite(url), { redirect: "follow", signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * An `https` URL, or `undefined`.
 *
 * The point where a hostile index is stopped from handing the downloader a `file:` address and
 * having Studio "download" something off the author's own disk into its cache - or a `data:` one,
 * which would let the index carry bytes no server ever served.
 */
function asHttpsUrl(value: unknown): string | undefined {
    const raw = asString(value);
    if (!raw) {
        return undefined;
    }
    try {
        return new URL(raw).protocol === "https:" ? raw : undefined;
    } catch {
        return undefined;
    }
}

/** A sha256 as the index must state it: 64 lower-case hex characters, and nothing else. */
function asSha256(value: unknown): string | undefined {
    const raw = asString(value).toLowerCase();
    return /^[0-9a-f]{64}$/.test(raw) ? raw : undefined;
}

/**
 * Coerce one raw index record into a {@link SpellcheckRegistryEntry}, or `null` if it lacks
 * anything the download cannot proceed without.
 *
 * Strict about five fields and lenient about the rest, the same trade the plugin store makes: one
 * malformed record must not blank the whole registry, but a record missing its code, its address,
 * its checksum or its licence is not a dictionary Studio can offer.
 */
export function normalizeDictionaryEntry(raw: unknown): SpellcheckRegistryEntry | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const code = asString(record.code);
    const download = asHttpsUrl(record.download);
    const sha256 = asSha256(record.sha256);
    const license = asString(record.license);
    if (!SPELLCHECK_CODE_PATTERN.test(code) || !download || !sha256 || !license) {
        return null;
    }
    const bytes = typeof record.bytes === "number" && Number.isFinite(record.bytes) && record.bytes >= 0
        ? Math.floor(record.bytes)
        : 0;
    const words = typeof record.words === "number" && Number.isFinite(record.words) && record.words >= 0
        ? Math.floor(record.words)
        : undefined;
    return {
        code,
        name: asString(record.name) || code,
        bytes,
        license,
        sha256,
        download,
        ...(words === undefined ? {} : { words }),
    };
}

export async function fetchDictionaryIndex(url: string): Promise<SpellcheckRegistryIndex> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`Dictionary registry request failed (${response.status} ${response.statusText})`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await response.text());
    } catch {
        throw new Error("Dictionary registry index is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Dictionary registry index is not an object");
    }
    const record = parsed as Record<string, unknown>;
    if (record.formatVersion !== SPELLCHECK_REGISTRY_FORMAT_VERSION) {
        throw new Error(
            `Unsupported dictionary registry format version ${String(record.formatVersion)} `
            + `(expected ${SPELLCHECK_REGISTRY_FORMAT_VERSION})`,
        );
    }
    const dictionaries = Array.isArray(record.dictionaries)
        ? record.dictionaries
            .map(normalizeDictionaryEntry)
            .filter((entry): entry is SpellcheckRegistryEntry => entry !== null)
        : [];
    return {
        formatVersion: SPELLCHECK_REGISTRY_FORMAT_VERSION,
        repository: asString(record.repository),
        dictionaries,
    };
}

/**
 * Fetch one dictionary's gzipped bytes, verified.
 *
 * The size is refused twice - once on the declared length, once on what actually arrived - because
 * `content-length` is the server's claim and the second check is the only one that is a fact. The
 * digest is checked before this returns, so nothing that fails it ever reaches the caller, let
 * alone the disk.
 */
export async function downloadDictionary(entry: SpellcheckRegistryEntry): Promise<Buffer> {
    const response = await fetchWithTimeout(entry.download);
    if (!response.ok) {
        throw new Error(`Dictionary download failed (${response.status} ${response.statusText})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > SPELLCHECK_MAX_DOWNLOAD_BYTES) {
        throw new Error("Dictionary exceeds the maximum download size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > SPELLCHECK_MAX_DOWNLOAD_BYTES) {
        throw new Error("Dictionary exceeds the maximum download size");
    }
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== entry.sha256) {
        throw new Error(
            `Dictionary "${entry.code}" does not match the checksum the registry published `
            + `(expected ${entry.sha256}, got ${digest})`,
        );
    }
    return buffer;
}
