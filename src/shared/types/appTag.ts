/**
 * App tags - the build variants a project can be shipped as.
 *
 * A tag is one *edition* of the same project: the release build, a demo, an all-ages cut, a
 * storefront-specific build. Every project has at least one, the release tag, and everything else an
 * author creates sits beside it.
 *
 * # What a tag is made of
 *
 * A tag carries an id, an author-facing name, and an **override record**. It does not carry a copy
 * of the project's configuration. Reading a value for a tag means reading the tag's override for
 * that key if it has one, and the project's own value if it does not - so a tag that overrides
 * nothing is the project, and "restore this key to the inherited value" is `delete overrides[key]`
 * rather than a second place to store the same number. The release tag has no overrides by
 * construction: it *is* the value everything else inherits from.
 *
 * There is deliberately **no enabled flag**. A tag exists or it does not, and its existence is the
 * whole fact - the editor, the checks and the build surface all ask the same question of the same
 * record. A flag would let a tag be present and off at the same time, which is two states for one
 * thing and a place for them to disagree.
 *
 * Of those three readers, only the build surface has a subject today: it lists the tags, one is
 * picked, and that tag's overrides are what the artifacts carry. The editor and the checks have
 * nothing to read the fact for yet - there is no authored construct that belongs to a tag, so there
 * is nothing to gate and nothing to hold against the list. Both arrive with the first construct that
 * does, and neither needs a second fact when it does.
 *
 * # Where a tag lives, and why here
 *
 * Tags are a project document (`editor/app-tags.json`), the same layer as the variable registry and
 * the audio buses, and not a field on the `.nlproj` and not a field on each entity that a tag can
 * affect.
 *
 * - **Not on the `.nlproj`.** That file holds the values a tag overrides. Putting the override sets
 *   inside the thing they override makes "the release value" and "the demo value" the same kind of
 *   entry at the same level, and there is then no expression for "this key is inherited" that is not
 *   also a legal spelling of "this key is set". The `.nlproj` is also one opaque blob to version
 *   control, while a registered document is diffed and merged key by key.
 * - **Not on each entity.** A tag would then have to be created by touching every character, surface
 *   and asset record that might vary, deleted by sweeping all of them, and there would be no single
 *   record to answer whether the tag exists at all.
 * - **A registry rather than one file per tag**, because whether a tag exists has to be answerable
 *   synchronously from anywhere - a dropdown being built, a check running, a build being described -
 *   and a per-tag file makes that question a disk read.
 *
 * # How this extends to per-tag asset variants
 *
 * "The same character resolves to a different image in the demo" is another key in the same override
 * record: a map from entity id to asset id, absent when inherited, removed to restore. It needs no
 * new storage, no new lifetime and no new restore rule, because the tag already owns a keyed
 * override set and already answers "is this inherited or set" per key.
 *
 * # Determinacy
 *
 * Resolving a tag always answers. An unknown id, a blank one, a deleted one, a missing document, one
 * whose contents will not parse, and a project that predates tags all resolve to the release tag,
 * which is synthesized rather than stored - so there is no file edit, no merge and no migration that
 * can leave a project without one.
 *
 * The one thing outside that guarantee is reaching the file at all. A read that fails for any reason
 * other than "not there" - a permission denied, a disk error - propagates, and the project does not
 * open. Resolution is still total; it is the loading that stopped, which is deliberate and is how
 * every other project document behaves.
 *
 * # Names
 *
 * Names are unique among the tags a project has, because a tag is named to be picked: two variants
 * called "Demo" are two answers to one name, and every surface that resolves a name would have to
 * refuse both. {@link uniqueAppTagName} is what keeps that true, and it is applied on the way in
 * rather than checked on the way out - an author who types a name in use gets a numbered one they
 * can see and edit, not a rejected edit and a field that snaps back.
 */

/** Persisted document version for `editor/app-tags.json`. Independent of every other document. */
export const APP_TAG_SCHEMA_VERSION = 1 as const;

export type AppTagSchemaVersion = typeof APP_TAG_SCHEMA_VERSION;

/**
 * The release tag's id.
 *
 * A fixed word rather than a generated id, because it is the value every unresolvable reference
 * falls back to and the one id that has to mean the same thing in a project nobody has opened yet.
 */
export const APP_TAG_ID_RELEASE = "release";

/**
 * The keys a tag may override.
 *
 * All three are project identity: what the build is called, what the operating system installs it
 * as, and which version it claims to be. They are the fields that have to differ for two editions of
 * one project to coexist on a player's machine, and they are strings end to end, which is what lets
 * one field editor serve all of them.
 */
export const APP_TAG_OVERRIDE_KEYS = ["displayName", "identifier", "version"] as const;

export type AppTagOverrideKey = (typeof APP_TAG_OVERRIDE_KEYS)[number];

/**
 * What a tag says differently from the project.
 *
 * An absent key is inherited; that is the only spelling of "inherited", so clearing an override is a
 * delete rather than a write. An empty string is not a value - it would ship a build with no name -
 * so the normalizer drops it, and clearing a field in the editor and restoring it are the same act.
 */
export type AppTagOverrides = {
    displayName?: string;
    identifier?: string;
    version?: string;
};

export interface ProjectAppTag {
    /** Stable. What every stored reference holds, so renaming a tag never invalidates one. */
    id: string;
    /** Author-facing. Shown wherever a tag is named; the id is never displayed. */
    name: string;
    /** Only what this tag says differently. See {@link AppTagOverrides}. */
    overrides: AppTagOverrides;
    /** Set on the release tag. Derived from the id, never authored, never stored. */
    builtin?: true;
}

/**
 * The release tag.
 *
 * Synthesized on every read rather than seeded into the document, because it is what resolution
 * falls back to: a stored release tag could be deleted by a bad merge or a hand edit, and every
 * unresolvable reference in the project would then have nowhere to land. It carries no overrides -
 * it is the project's own values - and its name is the untranslated fallback for callers with no
 * catalog (compiler messages, exported files). Surfaces show the translated name.
 */
export const RELEASE_APP_TAG: ProjectAppTag = Object.freeze({
    id: APP_TAG_ID_RELEASE,
    name: "Release",
    overrides: Object.freeze({}) as AppTagOverrides,
    builtin: true as const,
}) as ProjectAppTag;

/** The persisted document. An array because author ordering is meaningful and a map loses it. */
export type ProjectAppTagDocument = {
    schemaVersion: AppTagSchemaVersion;
    /** Author-created tags only. The release tag is never stored; see {@link RELEASE_APP_TAG}. */
    tags: ProjectAppTag[];
    meta?: {
        createdAt?: string;
        updatedAt?: string;
    };
};

/**
 * The field names a stored reference to a tag uses.
 *
 * Declared here so every holder agrees on one spelling, and so the "how many things use this tag"
 * count has a single place to learn about a new one.
 */
export const APP_TAG_REFERENCE_FIELDS = ["appTagId"] as const;

export function isBuiltinAppTagId(id: string): boolean {
    return id === APP_TAG_ID_RELEASE;
}

/**
 * One tag, from whatever was on disk. `null` when there is no id to hold references by, and for the
 * release tag, which is synthesized rather than read - a stored copy would be a second answer to a
 * question that already has one.
 */
export function normalizeProjectAppTag(raw: unknown): ProjectAppTag | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || isBuiltinAppTagId(id)) {
        return null;
    }
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;

    return {
        id,
        name,
        overrides: normalizeAppTagOverrides(record.overrides),
    };
}

/** Known keys only, blanks dropped. An unknown key is discarded rather than carried. */
export function normalizeAppTagOverrides(raw: unknown): AppTagOverrides {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const record = raw as Record<string, unknown>;
    const overrides: AppTagOverrides = {};
    for (const key of APP_TAG_OVERRIDE_KEYS) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            overrides[key] = value.trim();
        }
    }
    return overrides;
}

/**
 * The stored tag list as the rest of Studio may assume it: every id unique, no release tag among
 * them, every override known and non-blank.
 *
 * A bad list degrades, it never throws. A project must open even when this document was merged badly
 * or edited by hand, because everything the author can do about it is behind the surface that needs
 * the project open.
 */
export function normalizeProjectAppTags(raw: unknown): ProjectAppTag[] {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map<string, ProjectAppTag>();

    for (const entry of source) {
        const tag = normalizeProjectAppTag(entry);
        // First wins. A duplicated id is one row on the surface either way, and taking the later one
        // would silently discard whichever of the two the author had been editing first.
        if (tag && !byId.has(tag.id)) {
            byId.set(tag.id, tag);
        }
    }
    return [...byId.values()];
}

/** An absent or unreadable document is a project that has only ever had the release tag. */
export function createEmptyAppTagDocument(now?: string): ProjectAppTagDocument {
    return {
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags: [],
        ...(now ? { meta: { createdAt: now, updatedAt: now } } : {}),
    };
}

export function migrateProjectAppTagDocument(raw: unknown): ProjectAppTagDocument {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    const meta = record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
        ? record.meta as ProjectAppTagDocument["meta"]
        : undefined;

    return {
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags: normalizeProjectAppTags(record.tags),
        ...(meta ? { meta } : {}),
    };
}

/**
 * Every tag the project has, release first.
 *
 * Release first rather than in author order because it is the one every other tag is read against,
 * and a list whose base moves as tags are added reads as an ordinary row.
 */
export function listAppTags(stored: readonly ProjectAppTag[]): ProjectAppTag[] {
    return [RELEASE_APP_TAG, ...stored];
}

/**
 * Whether the project has a tag under this id - the single fact that decides whether a tag can be
 * named anywhere. The release tag is always present.
 */
export function hasAppTag(stored: readonly ProjectAppTag[], id: string | null | undefined): boolean {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed) {
        return false;
    }
    return isBuiltinAppTagId(trimmed) || stored.some(tag => tag.id === trimmed);
}

/**
 * The tag a reference resolves to. Total by construction: an unknown id, a blank one and a deleted
 * one all answer the release tag, so no caller ever holds a null tag and no surface has to invent a
 * reading for one.
 */
export function resolveAppTag(
    stored: readonly ProjectAppTag[],
    id: string | null | undefined,
): ProjectAppTag {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed || isBuiltinAppTagId(trimmed)) {
        return RELEASE_APP_TAG;
    }
    return stored.find(tag => tag.id === trimmed) ?? RELEASE_APP_TAG;
}

/**
 * `desired`, or `desired` with a number after it, whichever is free.
 *
 * Case-insensitive, because the names are matched case-insensitively wherever they are typed - a
 * "demo" beside a "Demo" would resolve to neither. `taken` is every name the result must differ
 * from, which the caller assembles: the other tags, plus whatever the release tag is called on
 * screen, which this module cannot know because it has no catalog.
 */
export function uniqueAppTagName(taken: readonly string[], desired: string): string {
    const base = desired.trim() || RELEASE_APP_TAG.name;
    const used = new Set(taken.map(name => name.trim().toLowerCase()));
    if (!used.has(base.toLowerCase())) {
        return base;
    }
    // From 2, the way a duplicated audio bus is named: "Demo 2" reads as the second of them, while
    // "Demo 1" would imply a first one that is not called that.
    for (let suffix = 2; suffix < used.size + 3; suffix += 1) {
        const candidate = `${base} ${suffix}`;
        if (!used.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
    // Unreachable: the loop tries more spellings than there are taken names. Answering the base is
    // still better than answering nothing, and the caller's own uniqueness is what would suffer.
    return base;
}

/** By display name, case-insensitively. `"ambiguous"` when two tags answer to it. */
export function findAppTagByName(
    tags: readonly ProjectAppTag[],
    name: string,
): ProjectAppTag | "ambiguous" | null {
    const needle = name.trim().toLowerCase();
    if (!needle) {
        return null;
    }
    const matches = tags.filter(tag => tag.name.trim().toLowerCase() === needle);
    if (matches.length > 1) {
        return "ambiguous";
    }
    return matches[0] ?? null;
}

/** The project's own values - what a tag with no overrides resolves to. */
export type AppTagBaseIdentity = Record<AppTagOverrideKey, string>;

/** One resolved key: the value in force, and whether this tag is the reason for it. */
export type AppTagResolvedValue = {
    value: string;
    /** True when the tag states this key itself, false when it is reading the release value. */
    overridden: boolean;
};

export type AppTagIdentity = Record<AppTagOverrideKey, AppTagResolvedValue>;

/**
 * What a build under this tag is called, installed as, and versioned at.
 *
 * Both halves in one answer, because every surface that shows a value also has to say where it came
 * from: an inherited value and an overridden one are the same string, and a reader who cannot tell
 * them apart cannot tell whether restoring would change anything.
 */
export function resolveAppTagIdentity(tag: ProjectAppTag, base: AppTagBaseIdentity): AppTagIdentity {
    const resolved = {} as AppTagIdentity;
    for (const key of APP_TAG_OVERRIDE_KEYS) {
        const override = tag.overrides[key];
        resolved[key] = override === undefined
            ? { value: base[key], overridden: false }
            : { value: override, overridden: true };
    }
    return resolved;
}

/**
 * How many stored references point at each tag, across whatever documents the caller hands over.
 *
 * A structural sweep rather than a per-holder extractor, because the holders are spread across
 * documents that know nothing about each other and an extractor per holder would have to be revisited
 * by each of them. Only values naming a tag in `tagIds` are counted, so a field that happens to share
 * the name cannot inflate the number.
 */
export function countAppTagReferences(
    roots: readonly unknown[],
    tagIds: readonly string[],
): Record<string, number> {
    const known = new Set(tagIds);
    const counts: Record<string, number> = {};
    for (const id of tagIds) {
        counts[id] = 0;
    }
    const seen = new Set<object>();

    const walk = (value: unknown): void => {
        if (!value || typeof value !== "object") {
            return;
        }
        // Documents are trees, but an in-memory one can hold a shared sub-object; without this a
        // cycle would hang the surface rather than report a number.
        if (seen.has(value as object)) {
            return;
        }
        seen.add(value as object);

        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item);
            }
            return;
        }
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (typeof child === "string"
                && (APP_TAG_REFERENCE_FIELDS as readonly string[]).includes(key)
                && known.has(child)
            ) {
                counts[child] += 1;
                continue;
            }
            walk(child);
        }
    };

    for (const root of roots) {
        walk(root);
    }
    return counts;
}
