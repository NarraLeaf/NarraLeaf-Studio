/**
 * What a model says about itself, and how Studio decides whether that answer is still true.
 *
 * The engine's `PuppetInstance.describe()` exists so an editor never has to parse a model file: it
 * asks the *live model* what it contains and fills its own controls from the answer. Everything in
 * this module is the bookkeeping around that call — identity, staleness, and validation of a value
 * that arrived from a module the author supplied. Nothing here mounts anything, touches the DOM, or
 * imports the engine's runtime, so it is the part that can be reasoned about (and tested) on its
 * own.
 *
 * Two ideas do all the work:
 *
 * - **Key** — which model/runtime pair an answer belongs to. Stable across edits, so a cache file
 *   is overwritten rather than accumulating one file per keystroke.
 * - **Fingerprint** — whether that answer is still the truth. Everything that can change what a
 *   backend would report goes in, and a mismatch is a cache miss. This is the whole of the
 *   invalidation strategy: no watchers, no eviction hooks, no "clear cache" the author has to find.
 */

import type { PuppetDescription } from "narraleaf-react";

/** Bump when the record shape changes; every older file then reads as a miss. */
export const PUPPET_DESCRIPTION_CACHE_VERSION = 1;

/**
 * A puppet, as the description lookup needs to see one.
 *
 * Deliberately not "a character": the same lookup answers for a character's inspector, for a story
 * row's parameter list, and for anything else that ends up holding a model plus a runtime. A
 * character id is a convenience on top (see `PuppetDescriptionService.describeCharacter`), not the
 * primitive.
 */
export interface PuppetDescriptionRequest {
    /** The model bundle asset. */
    assetId: string;
    /** Backend name — a directory under the project's `runtimes/puppet/`. */
    backend: string;
    /** Entry override within the bundle; null/omitted uses the bundle's own declared entry. */
    entry?: string | null;
    /** Backend options, forwarded verbatim to the mount. A backend may load different files for different options. */
    options?: Record<string, unknown>;
    /** The box the model is asked to describe itself in. Only some backends report a size that depends on it. */
    size?: { width: number; height: number } | null;
}

/**
 * Why there is no description — each one a different thing for a caller to do.
 *
 * These are all normal states, not errors. A project may carry no runtime at all, and the editor
 * has to keep working when it does: every one of these degrades to free text rather than to an
 * empty control the author cannot fill.
 */
export type PuppetDescriptionUnavailableReason =
    /** No model asset, or the asset is gone, or its bundle declares no entry file. */
    | "no-model"
    /** The puppet names no backend. */
    | "no-backend"
    /** The named backend is not installed in this project — `runtimes/puppet/<name>/index.js` is absent. */
    | "backend-missing"
    /** The backend loaded and mounted, but implements no `describe()`. Explicitly allowed by the contract. */
    | "not-described"
    /** The backend threw, rejected, timed out, or returned something that is not a description. */
    | "failed";

export type PuppetDescriptionResult =
    | {
        status: "ok";
        description: PuppetDescription;
        /** Whether this answer came off disk or out of a model that was mounted just now. */
        origin: "memory" | "disk" | "live";
        fingerprint: string;
    }
    | {
        status: "unavailable";
        reason: PuppetDescriptionUnavailableReason;
        /** Diagnostic detail, already flattened to a string. Never shown as the primary UI. */
        message?: string;
    };

/** The on-disk record. Lives under `editor/cache/`, so it is derived data and may be deleted at any time. */
export interface PuppetDescriptionRecord {
    version: number;
    /** See {@link puppetDescriptionFingerprint}. A record whose fingerprint no longer matches is a miss. */
    fingerprint: string;
    /** ISO timestamp, for diagnostics only — freshness is decided by the fingerprint, never by age. */
    describedAt: string;
    description: PuppetDescription;
}

/**
 * Everything that can change what a backend would answer.
 *
 * The model can change under Studio (an author re-exports over a bundle), the runtime can change
 * under Studio (they drop in a new build), and the options change what the runtime loads. All three
 * are observations taken at lookup time, so a stale answer cannot survive the next lookup — which
 * is why nothing here watches the filesystem or hooks asset replacement.
 */
export interface PuppetDescriptionFingerprintInput {
    /** The bundle's own record hash — a digest of its file listing. */
    assetHash: string;
    /** Total bytes in the bundle tree. Catches a texture or skeleton edited in place, which the listing hash cannot. */
    bundleBytes: number;
    /** The entry the bundle actually resolved to, override already applied. */
    resolvedEntry: string;
    /** Backend directory name. */
    backend: string;
    /** A stamp for the backend module itself — see `readPuppetRuntimeStamp`. */
    backendStamp: string;
    options: Record<string, unknown>;
    size: { width: number; height: number } | null;
}

/**
 * A short, filesystem-safe, deterministic digest.
 *
 * FNV-1a over two 32-bit lanes rather than a real hash: this names a cache file and detects a
 * change, it does not defend against anything. `crypto.subtle.digest` is async and would push the
 * whole key derivation into a promise for no benefit.
 */
export function puppetDescriptionDigest(text: string): string {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b + code + index, 0x85ebca6b) >>> 0;
    }
    return (a >>> 0).toString(36).padStart(7, "0") + (b >>> 0).toString(36).padStart(7, "0");
}

/**
 * Order-independent JSON, tolerant of whatever an options bag holds.
 *
 * Not {@link import("@shared/documents/canonicalJson").encodeCanonicalJson}: that one throws on
 * `undefined`, `NaN` and friends because a *document* must never lose data silently. This encodes a
 * fingerprint input, where the only requirement is that two equal bags produce equal text and two
 * different ones usually do not — so an unrepresentable value is stamped rather than rejected. An
 * options bag is the author's, and a throw here would take the description down with it.
 */
export function stablePuppetJson(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "?";
    const type = typeof value;
    if (type === "number") return Number.isFinite(value as number) ? String(value) : "?num";
    if (type === "boolean" || type === "bigint") return String(value);
    if (type === "string") return JSON.stringify(value);
    if (type === "function" || type === "symbol") return "?opaque";
    if (Array.isArray(value)) {
        return `[${value.map(stablePuppetJson).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stablePuppetJson(item)}`).join(",")}}`;
}

/**
 * Which model/runtime pair an answer belongs to — the cache file's name.
 *
 * Only the identity goes in, never the observations: a bundle re-exported in place must land on the
 * same file so the stale record is replaced rather than orphaned. The entry override is part of the
 * identity because two characters can point at two skeletons in one bundle and describe differently.
 */
export function puppetDescriptionKey(request: PuppetDescriptionRequest): string {
    return puppetDescriptionDigest(stablePuppetJson({
        assetId: request.assetId,
        backend: request.backend,
        entry: request.entry ?? null,
        options: request.options ?? {},
    }));
}

/** See {@link PuppetDescriptionFingerprintInput}. */
export function puppetDescriptionFingerprint(input: PuppetDescriptionFingerprintInput): string {
    return `${PUPPET_DESCRIPTION_CACHE_VERSION}.${puppetDescriptionDigest(stablePuppetJson({
        assetHash: input.assetHash,
        bundleBytes: input.bundleBytes,
        resolvedEntry: input.resolvedEntry,
        backend: input.backend,
        backendStamp: input.backendStamp,
        options: input.options,
        size: input.size,
    }))}`;
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") {
            continue;
        }
        const name = item.trim();
        // A duplicate would render as two identical options an author cannot tell apart, and an
        // empty name cannot be selected at all - both are dropped rather than shown.
        if (!name || seen.has(name)) {
            continue;
        }
        seen.add(name);
        names.push(name);
    }
    return names;
}

/**
 * Take a value a backend handed back and make it a description, or reject it.
 *
 * The backend is an ES module the *author* dropped into their project, compiled separately from
 * Studio and from the engine, so nothing has type-checked what crosses this line. An unvalidated
 * answer would reach a `<Select>` as `undefined.map` — a blank inspector with a console trace,
 * where the honest outcome is "this model did not describe itself" and free text.
 *
 * Returns null only when the value is not a description at all. A description with no motions is a
 * legitimate answer (plenty of models have skins and no animations) and comes back intact.
 */
export function normalizePuppetDescription(value: unknown): PuppetDescription | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const raw = value as Partial<PuppetDescription>;
    if (!Array.isArray(raw.motions) && !Array.isArray(raw.expressions)
        && !Array.isArray(raw.skins) && !Array.isArray(raw.params)) {
        // Every field optional-and-absent means this is some other object entirely, not a model
        // with nothing to say.
        return null;
    }
    const params: PuppetDescription["params"] = [];
    if (Array.isArray(raw.params)) {
        const seen = new Set<string>();
        for (const item of raw.params) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const entry = item as Partial<PuppetDescription["params"][number]>;
            const id = typeof entry.id === "string" ? entry.id.trim() : "";
            if (!id || seen.has(id)) {
                continue;
            }
            // `Number()` rather than a typeof check would turn a missing bound into 0, and a
            // parameter whose min and max are both 0 is a control that cannot be moved.
            const bound = (value: unknown, fallback: number): number =>
                typeof value === "number" && Number.isFinite(value) ? value : fallback;
            seen.add(id);
            params.push({
                id,
                min: bound(entry.min, 0),
                max: bound(entry.max, 1),
                default: bound(entry.default, 0),
            });
        }
    }
    const width = Number((raw.size as { width?: unknown } | null | undefined)?.width);
    const height = Number((raw.size as { height?: unknown } | null | undefined)?.height);
    return {
        motions: stringList(raw.motions),
        expressions: stringList(raw.expressions),
        skins: stringList(raw.skins),
        params,
        size: Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
            ? { width, height }
            : null,
    };
}

/** Read a cache file back, rejecting anything a different Studio (or a hand edit) left behind. */
export function parsePuppetDescriptionRecord(value: unknown): PuppetDescriptionRecord | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const raw = value as Partial<PuppetDescriptionRecord>;
    if (raw.version !== PUPPET_DESCRIPTION_CACHE_VERSION || typeof raw.fingerprint !== "string" || !raw.fingerprint) {
        return null;
    }
    const description = normalizePuppetDescription(raw.description);
    if (!description) {
        return null;
    }
    return {
        version: PUPPET_DESCRIPTION_CACHE_VERSION,
        fingerprint: raw.fingerprint,
        describedAt: typeof raw.describedAt === "string" ? raw.describedAt : "",
        description,
    };
}

/**
 * The choices for one named field, given what the model said and what the puppet currently holds.
 *
 * The current value is prepended when the model does not list it, rather than dropped. A name that
 * has gone missing — the model was re-exported without that animation, or the author typed it
 * before the runtime was installed — is exactly the case the author needs to *see*; silently
 * replacing it with the first option would rewrite the character on open.
 *
 * An empty result means "this model has nothing to offer here", and the caller falls back to free
 * text. That is per field, not per model: a skeleton with eleven animations and no expressions
 * should still get a list for its animations.
 */
export function puppetChoiceOptions(available: readonly string[], current: string | null): string[] {
    const value = current?.trim() ?? "";
    if (available.length === 0) {
        return [];
    }
    return value && !available.includes(value) ? [value, ...available] : [...available];
}
