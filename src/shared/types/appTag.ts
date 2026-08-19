import type { GameBuildPlatform } from "./gameBuild";
import {
    isPlatformScopedBuildConfig,
    isVariantScopedBuildConfig,
    pluginBuildConfigStorageKey,
    type PluginBuildConfigField,
} from "./plugins";

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
 * A tag also carries a **plugin build config record** and a **scene declaration record**, both under
 * exactly the same rule: only what this variant says differently, absent means inherited, restore is
 * a delete. They are separate records rather than more keys in the first because their keys are not
 * known here - one set is declared by whatever plugins are installed, the other by whatever the
 * project holds that a build cannot read - while the identity keys are a closed list this module
 * owns.
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

/**
 * Persisted document version for `editor/app-tags.json`. Independent of every other document.
 *
 * Not bumped when plugin build config was added, nor when scene declarations were. The version
 * exists so a document this Studio cannot read is refused rather than half-understood, and a document
 * written before either simply has neither: the new keys are absent, which is exactly what "this
 * project configures no plugin" and "this project has declared nothing" mean. Nothing already on disk
 * is read differently, so there is nothing for a bump to protect - and bumping would make every older
 * Studio refuse the whole document, trading keys it would have ignored for a project it cannot open.
 */
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

/**
 * Values the installed plugins asked the author for, keyed by plugin id and then by the storage key
 * the field's scope produces (see {@link pluginBuildConfigStorageKey}).
 *
 * Two records of this shape exist: one at the document root, holding the project's own values, and
 * one per tag, holding only what that variant says differently. That is the same pair the identity
 * overrides form, and it is read the same way - absent key means inherited, clearing is a delete.
 *
 * Keyed by plugin id and not flattened into one namespace so an uninstalled plugin's values are
 * identifiable as a block: nothing here drops a key merely because no installed plugin claims it,
 * because "the plugin is not installed on this machine" and "the author cleared this" have to stay
 * different facts. A collaborator who opens the project without the plugin must not silently write
 * its values away.
 *
 * A `secret` field's value is a handle, not the secret. See `PluginBuildConfigFieldContribution`.
 */
export type AppTagPluginConfig = Record<string, Record<string, string>>;

/** One scene an author says a mechanism can start. Carries the story, because a jump never crosses one. */
export type AppTagDeclaredScene = {
    storyId: string;
    sceneId: string;
};

/**
 * What the author says each unreadable mechanism can start, keyed by {@link appTagMechanismKey}.
 *
 * Three things in a project can name a scene the build cannot read: a `Start Story` node whose
 * target is wired, a TypeScript blueprint, and a plugin that could reach the host API. Left alone
 * each of them means the build has to ship every story whole - it cannot prove any scene is
 * unreachable while something it cannot read might name it. This record is how an author answers
 * instead of being stopped, and it is the same root-plus-variant pair {@link AppTagPluginConfig}
 * uses: the root is the project's own answer, a tag states only what it says differently, absent is
 * inherited, and restoring is a delete.
 *
 * Per variant because that is the whole point of the feature: a demo's chapter select offers one
 * chapter where the main build offers ten, and the same node is the mechanism in both.
 *
 * **A declaration is a scene list and nothing else.** There is deliberately no "reaches any scene"
 * value - an author who could write one would write it once, and every later demo would ship the
 * whole book with nothing on screen to say so. A mechanism that genuinely starts nothing under this
 * variant is spelled as an empty list, which is a different fact from an absent key: absent means
 * undeclared and the build stops, empty means declared to start nothing and it does not.
 */
export type AppTagReachableScenes = Record<string, AppTagDeclaredScene[]>;

/**
 * Where this edition sits on each build-time asset axis: axis key to the value it takes.
 *
 * An asset set with a `build` axis resolves once, while the package is compiled, and the variants it
 * did not take **do not ship** - see `@shared/types/assetSet`, where that is stated as a safety
 * property and not a size one. This record is what makes the choice: an axis names a dimension the
 * project's art varies along (`rating`, `region`), and each edition states its position on it.
 *
 * On the variant rather than on the axis, because the axis is a fact about the art and the position
 * is a fact about the edition. An edition that says nothing inherits, which is what lets a project
 * add a third edition without touching the two that already build.
 */
export type AppTagAssetAxes = Record<string, string>;
/**
 * The page a build shows when its story falls off the end.
 *
 * A surface id, or the empty string for "show nothing" - which is what every build did before this
 * existed and what a project that never picks one keeps doing. Stored under the same rule the two
 * records above follow: absent on a variant means inherited, and restoring is a delete.
 *
 * Per variant because that is what a cut point creates. A demo ends where the author cut it, and the
 * page it lands on is a thank-you with a store link on it; the full game ends where the story ends,
 * and lands on credits or on nothing at all. The same story document produces both.
 *
 * **The empty string is a value on a variant and an absence on the project.** A variant that states
 * `""` says it shows nothing when its story ends, which is different from reading the project's
 * choice; on the project's own record there is nothing to inherit from, so blank and absent are one
 * fact and the blank one is not written.
 */
export type AppTagEndingSurfaceId = string;

export interface ProjectAppTag {
    /** Stable. What every stored reference holds, so renaming a tag never invalidates one. */
    id: string;
    /** Author-facing. Shown wherever a tag is named; the id is never displayed. */
    name: string;
    /** Only what this tag says differently. See {@link AppTagOverrides}. */
    overrides: AppTagOverrides;
    /**
     * Only the plugin values this variant states itself. Absent when it states none, so a tag that
     * configures nothing is byte-identical to one written before plugins could ask for anything.
     */
    pluginConfig?: AppTagPluginConfig;
    /** Only the axis positions this variant states itself. See {@link AppTagAssetAxes}. */
    assetAxes?: AppTagAssetAxes;
    /** Only the scene declarations this variant states itself. See {@link AppTagReachableScenes}. */
    reachableScenes?: AppTagReachableScenes;
    /**
     * Only the ending page this variant states itself. See {@link AppTagEndingSurfaceId}: absent is
     * the project's choice, and an empty string is this variant saying it shows nothing.
     */
    endingSurfaceId?: AppTagEndingSurfaceId;
    /** Set on the release tag. Derived from the id, never authored, never stored. */
    builtin?: true;
}

/** The three mechanisms a scene declaration can be about. */
export type AppTagMechanismRef =
    | { kind: "startStoryNode"; blueprintId: string; graphKind: string; graphId: string; nodeId: string }
    | { kind: "scriptBlueprint"; blueprintId: string }
    | { kind: "plugin"; pluginId: string };

/**
 * The stable key a declaration is filed under.
 *
 * Keyed by what the mechanism *is* rather than by where it sits on a canvas, so moving a node,
 * renaming a blueprint or reordering an event layer never orphans a declaration. The three kinds are
 * prefixed rather than sharing one namespace: a plugin id and a blueprint id are both opaque strings,
 * and a collision would silently hand one mechanism's scene list to another.
 */
export function appTagMechanismKey(ref: AppTagMechanismRef): string {
    switch (ref.kind) {
        case "startStoryNode":
            return `node:${ref.blueprintId}:${ref.graphKind}:${ref.graphId}:${ref.nodeId}`;
        case "scriptBlueprint":
            return `blueprint:${ref.blueprintId}`;
        case "plugin":
            return `plugin:${ref.pluginId}`;
    }
}

/**
 * The release tag.
 *
 * Synthesized on every read rather than seeded into the document, because it is what resolution
 * falls back to: a stored release tag could be deleted by a bad merge or a hand edit, and every
 * unresolvable reference in the project would then have nowhere to land. It carries no overrides -
 * it is the project's own values.
 *
 * Its name is fixed. `main` is the word for the trunk the project is built from, and it is
 * deliberately the same word in every language: nothing translates it, and no surface substitutes
 * anything for it. A story expression compares `AppTag` against a string, and that comparison is
 * performed by the shipped game, where no catalogue exists - so `AppTag == "main"` has to mean the
 * same thing in every author's Studio and in the build. A name that changed with the interface
 * language would read true in one author's Studio and fold to false in the package.
 */
export const RELEASE_APP_TAG: ProjectAppTag = Object.freeze({
    id: APP_TAG_ID_RELEASE,
    name: "main",
    overrides: Object.freeze({}) as AppTagOverrides,
    builtin: true as const,
}) as ProjectAppTag;

/** The persisted document. An array because author ordering is meaningful and a map loses it. */
export type ProjectAppTagDocument = {
    schemaVersion: AppTagSchemaVersion;
    /** Author-created tags only. The release tag is never stored; see {@link RELEASE_APP_TAG}. */
    tags: ProjectAppTag[];
    /**
     * The project's own plugin values - what every variant inherits, and what the release tag reads.
     *
     * At the document root rather than on a tag because the release tag is synthesized and stores
     * nothing: there is no record on it for a value to live in, and inventing one would be a second
     * answer to "what does an unstated key resolve to". Absent when the project configures nothing.
     */
    pluginConfig?: AppTagPluginConfig;
    /**
     * The project's own axis positions - what every variant inherits, and what the release tag reads.
     * At the root for the reason {@link pluginConfig} is.
     *
     * The release edition is where an axis's default position belongs: it is the full product, so
     * the value it takes is the one an author thinks of as "the art", and every narrower edition
     * states only where it differs.
     */
    assetAxes?: AppTagAssetAxes;
    /**
     * The project's own scene declarations - what every variant inherits, and what the release tag
     * reads. At the root for the reason {@link pluginConfig} is: the release tag is synthesized and
     * stores nothing, so there is no record on it for a value to live in.
     */
    reachableScenes?: AppTagReachableScenes;
    /**
     * The project's own ending page - what every variant inherits, and what the release tag reads.
     *
     * At the root for the reason `reachableScenes` is, and absent when blank: on the record every
     * other record is read against, "the project picks none" and "the key is not there" are one
     * fact.
     */
    endingSurfaceId?: AppTagEndingSurfaceId;
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
    const pluginConfig = normalizeAppTagPluginConfig(record.pluginConfig);
    const reachableScenes = normalizeAppTagReachableScenes(record.reachableScenes);
    const assetAxes = normalizeAppTagAssetAxes(record.assetAxes);

    return {
        id,
        name,
        overrides: normalizeAppTagOverrides(record.overrides),
        // Omitted when empty rather than written as `{}`, so adopting this feature does not rewrite
        // every tag in every project the author merely opened.
        ...(hasAppTagPluginConfig(pluginConfig) ? { pluginConfig } : {}),
        ...(hasAppTagReachableScenes(reachableScenes) ? { reachableScenes } : {}),
        ...(hasAppTagAssetAxes(assetAxes) ? { assetAxes } : {}),
        // Kept whenever the key is present, blank included, for the reason the list above is: on a
        // variant "" is the statement "this edition shows nothing when its story ends", and dropping
        // it would silently hand the variant the project's page instead.
        ...(record.endingSurfaceId === undefined
            ? {}
            : { endingSurfaceId: normalizeAppTagEndingSurfaceId(record.endingSurfaceId) }),
    };
}

/** A surface id as it is stored and compared: trimmed, or blank for anything that is not one. */
export function normalizeAppTagEndingSurfaceId(raw: unknown): AppTagEndingSurfaceId {
    return typeof raw === "string" ? raw.trim() : "";
}

/**
 * A plugin config record as the rest of Studio may assume it: plugin ids and storage keys non-blank,
 * values non-blank strings, empty plugin records dropped.
 *
 * Structural only - it judges the shape, never the meaning. It cannot ask whether a key is declared,
 * because the declarations come from the installed plugins and this module has none; and it must
 * not, because the plugin that owns a key may simply not be installed here and dropping the key
 * would delete a collaborator's work. Deciding a key belongs on the project rather than on a variant
 * needs the declaration, and that is {@link variantStorablePluginConfig}.
 */
export function normalizeAppTagPluginConfig(raw: unknown): AppTagPluginConfig {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const config: AppTagPluginConfig = {};
    for (const [rawPluginId, rawValues] of Object.entries(raw as Record<string, unknown>)) {
        const pluginId = rawPluginId.trim();
        if (!pluginId || !rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
            continue;
        }
        const values: Record<string, string> = {};
        for (const [rawKey, rawValue] of Object.entries(rawValues as Record<string, unknown>)) {
            const key = rawKey.trim();
            // Blank is not a value: it is a field the author has not filled in, and the only spelling
            // of that is the key being absent.
            if (!key || typeof rawValue !== "string" || !rawValue.trim()) {
                continue;
            }
            values[key] = rawValue.trim();
        }
        if (Object.keys(values).length > 0) {
            config[pluginId] = values;
        }
    }
    return config;
}

/** Whether a record says anything at all. `{}` and `{ "acme.plugin": {} }` both say nothing. */
export function hasAppTagPluginConfig(config: AppTagPluginConfig | undefined): boolean {
    return Boolean(config && Object.values(config).some(values => Object.keys(values).length > 0));
}

/**
 * A scene declaration record as the rest of Studio may assume it: mechanism keys non-blank, every
 * entry a `(storyId, sceneId)` pair of non-blank strings, duplicates within one list collapsed.
 *
 * Structural only, exactly like {@link normalizeAppTagPluginConfig}, and for the sharper version of
 * the same reason. It cannot ask whether a mechanism still exists - the blueprint document and the
 * installed plugin list are not here - and it must not, because "the plugin is not installed on this
 * machine" and "the author deleted this declaration" have to stay different facts. A declaration
 * naming a scene the project no longer has is a finding for the surfaces to report, not a key for
 * this function to quietly discard: discarding it would delete the author's answer and turn their
 * next build into a refusal they never asked for.
 *
 * A mechanism key mapped to an empty list survives, because that is how "this one starts nothing
 * under this variant" is written. Only a key that is not a list at all is dropped.
 */
/**
 * An axis record as the rest of Studio may assume it: axis keys and values trimmed and non-blank.
 *
 * A blank value is dropped rather than kept, because on this record "absent" already means "take the
 * inherited position" - a blank would be a second spelling of it that only some readers would honour.
 */
export function normalizeAppTagAssetAxes(raw: unknown): AppTagAssetAxes {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const axes: AppTagAssetAxes = {};
    for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
        const key = rawKey.trim();
        const value = typeof rawValue === "string" ? rawValue.trim() : "";
        if (key && value) {
            axes[key] = value;
        }
    }
    return axes;
}

export function hasAppTagAssetAxes(axes: AppTagAssetAxes | undefined): boolean {
    return Boolean(axes && Object.keys(axes).length > 0);
}

/**
 * Where this tag sits on every axis: the project's own positions, with the tag's replacing them key
 * by key.
 *
 * Merged rather than replaced, unlike `reachableScenes` - and the difference is in what the two
 * records mean. A scene list is one statement about the whole edition, so a narrower one has to win
 * outright; an axis record is several independent statements, and an edition that states only its
 * rating has said nothing at all about its region.
 */
export function resolveAppTagAssetAxes(
    tag: ProjectAppTag,
    base: AppTagAssetAxes | undefined,
): AppTagAssetAxes {
    return { ...(base ?? {}), ...(tag.assetAxes ?? {}) };
}

export function normalizeAppTagReachableScenes(raw: unknown): AppTagReachableScenes {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const declared: AppTagReachableScenes = {};
    for (const [rawKey, rawScenes] of Object.entries(raw as Record<string, unknown>)) {
        const key = rawKey.trim();
        if (!key || !Array.isArray(rawScenes)) {
            continue;
        }
        const scenes: AppTagDeclaredScene[] = [];
        const seen = new Set<string>();
        for (const entry of rawScenes) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                continue;
            }
            const record = entry as Record<string, unknown>;
            const storyId = typeof record.storyId === "string" ? record.storyId.trim() : "";
            const sceneId = typeof record.sceneId === "string" ? record.sceneId.trim() : "";
            const pair = `${storyId}:${sceneId}`;
            if (!storyId || !sceneId || seen.has(pair)) {
                continue;
            }
            seen.add(pair);
            scenes.push({ storyId, sceneId });
        }
        declared[key] = scenes;
    }
    return declared;
}

/** Whether a record declares anything. An empty record is a project that has answered nothing. */
export function hasAppTagReachableScenes(declared: AppTagReachableScenes | undefined): boolean {
    return Boolean(declared && Object.keys(declared).length > 0);
}

/**
 * What this tag says every mechanism can start: the project's own answers, with the tag's own
 * answers replacing them key by key.
 *
 * Replacing rather than merging the two lists, and that is the whole meaning of an override: a demo
 * whose chapter select offers one chapter is stating a smaller set, and a union would hand it the
 * nine chapters it exists to leave out.
 */
export function resolveAppTagReachableScenes(
    tag: ProjectAppTag,
    base: AppTagReachableScenes | undefined,
): AppTagReachableScenes {
    return { ...(base ?? {}), ...(tag.reachableScenes ?? {}) };
}

/**
 * `config` with the entries a declared field says belong on the project removed.
 *
 * A `global`- or `platform`-scoped field has one value for the whole project, so a variant record
 * holding one is not a smaller override - it is a second answer to a question that has one, and
 * every reader would have to decide which of the two wins. Dropping it here is what makes "this
 * field is the same for every variant" a fact about the storage rather than a convention the
 * surfaces agree to keep.
 *
 * Only entries whose field is present in `fields` are judged. A key no declared field claims is left
 * exactly where it is: its plugin may be uninstalled or disabled on this machine, and a variant that
 * loses its values because a collaborator opened the project without the plugin is the one failure
 * this whole record shape exists to avoid.
 */
export function variantStorablePluginConfig(
    config: AppTagPluginConfig,
    fields: readonly PluginBuildConfigField[],
): AppTagPluginConfig {
    const rooted = fields.filter(field => !isVariantScopedBuildConfig(field.scope));
    if (rooted.length === 0) {
        return config;
    }
    const result: AppTagPluginConfig = {};
    for (const [pluginId, values] of Object.entries(config)) {
        const kept: Record<string, string> = {};
        for (const [storageKey, value] of Object.entries(values)) {
            // Matched by prefix so a platform-scoped field's `key@windows` spellings are covered
            // without enumerating the platforms it happens to name.
            const misplaced = rooted.some(field => field.pluginId === pluginId
                && (storageKey === field.key || storageKey.startsWith(`${field.key}@`)));
            if (!misplaced) {
                kept[storageKey] = value;
            }
        }
        if (Object.keys(kept).length > 0) {
            result[pluginId] = kept;
        }
    }
    return result;
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
    const pluginConfig = normalizeAppTagPluginConfig(record.pluginConfig);
    const reachableScenes = normalizeAppTagReachableScenes(record.reachableScenes);
    const assetAxes = normalizeAppTagAssetAxes(record.assetAxes);
    const endingSurfaceId = normalizeAppTagEndingSurfaceId(record.endingSurfaceId);

    return {
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags: normalizeProjectAppTags(record.tags),
        ...(hasAppTagPluginConfig(pluginConfig) ? { pluginConfig } : {}),
        ...(hasAppTagReachableScenes(reachableScenes) ? { reachableScenes } : {}),
        ...(hasAppTagAssetAxes(assetAxes) ? { assetAxes } : {}),
        // Omitted when blank, unlike a variant's own key and for the same reason the list above is:
        // this is the record a variant that states nothing reads, so there is nothing for a blank to
        // mean that absence does not already say.
        ...(endingSurfaceId ? { endingSurfaceId } : {}),
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
 * from: the other tags, plus the release tag's own name, which no surface spells differently.
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
 * What one plugin field is set to for this tag, and whether the tag is the reason for it.
 *
 * The same `{ value, overridden }` answer {@link resolveAppTagIdentity} gives, for the same reason:
 * an inherited value and a stated one are the same string, and a surface that cannot tell them apart
 * cannot say whether restoring would change anything.
 *
 * `base` is the project's own record - the document root. A `global`- or `platform`-scoped field
 * reads it and nothing else, so `overridden` is false for those by construction: the variant has no
 * say, which is what those scopes mean.
 *
 * A blank answer means the field has never been filled in. For a `secret` field a non-blank answer
 * is a handle, and whether the secret behind it is on *this* machine is a separate question that
 * only the machine's vault can answer.
 */
export function resolveAppTagPluginConfigValue(
    tag: ProjectAppTag,
    base: AppTagPluginConfig,
    field: PluginBuildConfigField,
    platform?: GameBuildPlatform,
): AppTagResolvedValue {
    const storageKey = pluginBuildConfigStorageKey(
        field.key,
        isPlatformScopedBuildConfig(field.scope) ? platform : undefined,
    );
    const inherited = base[field.pluginId]?.[storageKey] ?? "";
    if (!isVariantScopedBuildConfig(field.scope)) {
        return { value: inherited, overridden: false };
    }
    const stated = tag.pluginConfig?.[field.pluginId]?.[storageKey];
    return stated === undefined
        ? { value: inherited, overridden: false }
        : { value: stated, overridden: true };
}

/** A resolved ending page, and whether the variant is the reason for it. */
export type AppTagResolvedEndingSurface = {
    /** The surface a build under this tag shows when its story ends. Blank shows nothing. */
    value: AppTagEndingSurfaceId;
    /** True when the tag states it itself, false when it is reading the project's choice. */
    overridden: boolean;
};

/**
 * Which page a build under this tag shows when its story falls off the end, and whether the tag is
 * the reason.
 *
 * The same `{ value, overridden }` answer every other resolved key gives, for the same reason: an
 * inherited id and a stated one are the same string, and a surface that cannot tell them apart
 * cannot say whether restoring would change anything.
 *
 * `base` is the project's own choice - the document root. The release tag stores nothing, so it
 * always reads that.
 */
export function resolveAppTagEndingSurface(
    tag: ProjectAppTag,
    base: string | undefined,
): AppTagResolvedEndingSurface {
    if (tag.endingSurfaceId === undefined) {
        return { value: normalizeAppTagEndingSurfaceId(base), overridden: false };
    }
    return { value: normalizeAppTagEndingSurfaceId(tag.endingSurfaceId), overridden: true };
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
