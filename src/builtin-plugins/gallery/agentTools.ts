/**
 * The Gallery's tools for AI agents connected to Studio: what an agent making a game needs to fill
 * the EXTRA page - CG artworks and their variants, recollections, music, voice lines, groups and the
 * locked look - without the author opening the Gallery editor.
 *
 * Six tools, batch-shaped, so a whole column lands in one call:
 *
 *   list            the catalog, with every id an edit needs (read)
 *   add_entries     new entries of any kind, with their variants (write)
 *   update_entries  rename, regroup, hide, re-cover, add/remove/repoint variants, move (write)
 *   remove_entries  (write)
 *   set_groups      the ordered group list, whole (write)
 *   set_settings    the locked placeholder image and name mask (write)
 *
 * Every write tool reads the catalog, builds the next one and commits it once - one storage write -
 * so the host's capture makes each call exactly one undo step, and the editor tab and panel redraw
 * from the store's own notify, as they do for the author's edits. Names are resolved here, not
 * guessed: an asset by id or exact name, a voice line by unit id, a scene by id or name. Anything
 * that does not resolve refuses the whole call and writes nothing.
 *
 * How entries get unlocked in the game is in `agent/guide.md` (served as
 * `agent_guide {chapter:"plugin:narraleaf.gallery"}`), and the list tool repeats the one-line version.
 *
 * Comments in English per project convention.
 */

import type {
    Asset,
    AssetType,
    PluginAgentJsonSchema,
    PluginAgentToolDef,
    PluginAgentToolResult,
    PluginApp,
    PluginSceneEntry,
    PluginVoiceUnitEntry,
} from "narraleaf-studio/plugin";
import {
    GALLERY_ENTRY_KINDS,
    PLUGIN_ID,
    createArtworkId,
    createGroupId,
    createVariantId,
    type GalleryArtwork,
    type GalleryEntryKind,
    type GalleryGroup,
    type GalleryScenePayload,
    type GalleryStoreData,
    type GalleryVariant,
} from "./catalog";
import { createGalleryTranslator, type GalleryMessageKey } from "./messages";
import type { GalleryStore } from "./store";

/** Every tool's name; the manifest's `contributes.agentTools` lists the same six (a test holds them together). */
export const GALLERY_AGENT_TOOLS = {
    list: `${PLUGIN_ID}.list`,
    addEntries: `${PLUGIN_ID}.add_entries`,
    updateEntries: `${PLUGIN_ID}.update_entries`,
    removeEntries: `${PLUGIN_ID}.remove_entries`,
    setGroups: `${PLUGIN_ID}.set_groups`,
    setSettings: `${PLUGIN_ID}.set_settings`,
} as const;

const UNLOCK_SUMMARY =
    "Unlocking in the game: a scene entry unlocks when the player reaches its scene, a music track when it plays (/bgm or /sound), "
    + "a voice line when it is spoken; a cg entry only through the Unlock Gallery blueprint node (narraleaf.gallery.add). "
    + "Read agent_guide {chapter:\"plugin:narraleaf.gallery\"} for the recipe.";

const DEFAULT_ENTRY_NAME: Record<GalleryEntryKind, GalleryMessageKey> = {
    cg: "defaultCg",
    scene: "defaultScene",
    music: "defaultMusic",
    voice: "defaultVoice",
};

/**
 * The two asset types the gallery points at, spelt as the host's enum values. Written out rather
 * than read off `AssetType` so this module has no value import from the plugin API, which keeps it
 * loadable by a unit test as well as by the plugin bundle.
 */
const IMAGE = "image" as AssetType;
const AUDIO = "audio" as AssetType;

/** A call the agent can correct; turned into a refusal by {@link handled}. */
class GalleryToolError extends Error {
    constructor(public readonly code: "invalid_args" | "not_found" | "unavailable", message: string, public readonly hint?: string) {
        super(message);
    }
}

// ── Schemas ──────────────────────────────────────────────────────────────────────────────────────

const ASSET_REF = "An asset id, or the asset's exact name as assets_list shows it.";

const VARIANT_SCHEMA: PluginAgentJsonSchema = {
    type: "object",
    description: "One member of an entry: a CG differential, an album track, a voice line.",
    properties: {
        name: { type: "string", description: "Shown in the viewer. Defaults to the file name (cg, music) or the line (voice)." },
        image: { type: "string", description: `cg and scene: the picture. ${ASSET_REF}` },
        thumbnail: { type: "string", description: `Optional smaller picture for grid cells. ${ASSET_REF}` },
        audio: { type: "string", description: `music: the track (required). voice: a loose clip instead of a voice unit. ${ASSET_REF}` },
        voiceUnit: { type: "string", description: "voice: the voice unit id - the line's text id. list {voiceUnits:true} shows them." },
    },
    additionalProperties: false,
};

const SCENE_SCHEMA: PluginAgentJsonSchema = {
    type: "object",
    description: "scene entries: where the recollection replays from.",
    properties: {
        scene: { type: "string", description: "Scene id or name (story_list)." },
        story: { type: "string", description: "Story id or name; needed only when two stories have a scene of that name." },
        startBlockId: { type: "string", description: "Optional row id to replay from instead of the scene start." },
    },
    required: ["scene"],
    additionalProperties: false,
};

const GROUP_REF: PluginAgentJsonSchema = {
    type: "string",
    description: "Group id or name. A name no group has creates the group. \"\" leaves the entry ungrouped.",
};

const ENTRY_SCHEMA: PluginAgentJsonSchema = {
    type: "object",
    properties: {
        kind: { type: "string", enum: [...GALLERY_ENTRY_KINDS], description: "cg (artwork with differentials), scene (recollection), music (album or single track), voice (set of lines)." },
        name: { type: "string", description: "Defaults to the first file's name, or a numbered default." },
        description: { type: "string", description: "Shown in the viewer once unlocked." },
        group: GROUP_REF,
        hidden: { type: "boolean", description: "Secret: left out of the list and the counts until unlocked. Default false." },
        variants: { type: "array", items: VARIANT_SCHEMA },
        cover: { type: "integer", minimum: 1, description: "1-based variant shown as the entry's cover. Default: the first." },
        scene: SCENE_SCHEMA,
        lockedImage: { type: "string", description: `Silhouette shown while locked, instead of the catalog-wide one. ${ASSET_REF}` },
    },
    required: ["kind"],
    additionalProperties: false,
};

// ── Resolution ───────────────────────────────────────────────────────────────────────────────────

function stripExtension(name: string): string {
    const trimmed = name.trim();
    const dot = trimmed.lastIndexOf(".");
    return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}

/** An asset of `type` by id, exact name, or name without its extension (case-insensitive last). */
export function resolveGalleryAsset(assets: readonly Asset[], type: AssetType, ref: string, what: string): Asset {
    const wanted = ref.trim();
    const byId = assets.find(asset => asset.id === wanted);
    if (byId) {
        return byId;
    }
    let matches = assets.filter(asset => asset.name === wanted);
    if (matches.length === 0) {
        const lower = wanted.toLowerCase();
        matches = assets.filter(asset => asset.name.toLowerCase() === lower || stripExtension(asset.name).toLowerCase() === lower);
    }
    if (matches.length === 1) {
        return matches[0]!;
    }
    if (matches.length > 1) {
        throw new GalleryToolError(
            "invalid_args",
            `${what} "${wanted}" names ${matches.length} ${type} assets (${matches.slice(0, 5).map(asset => asset.id).join(", ")}).`,
            "Pass the asset id instead.",
        );
    }
    throw new GalleryToolError("not_found", `${what}: no ${type} asset has the id or name "${wanted}".`, `Call assets_list {type:"${type}"} for the names, or import it first.`);
}

type Resolver = {
    image(ref: string, what: string): Asset;
    audio(ref: string, what: string): Asset;
    voiceUnit(unitId: string, what: string): Promise<PluginVoiceUnitEntry>;
    scene(ref: { scene: string; story?: string; startBlockId?: string }, what: string): Promise<GalleryScenePayload>;
    measure(asset: Asset): Promise<number | null>;
};

function createResolver(app: PluginApp, store: GalleryStore): Resolver {
    let units: Promise<PluginVoiceUnitEntry[]> | null = null;
    const sceneLists = new Map<string, Promise<PluginSceneEntry[]>>();
    const scenesOf = (storyId: string) => {
        let list = sceneLists.get(storyId);
        if (!list) {
            list = app.services.story.listScenes(storyId);
            sceneLists.set(storyId, list);
        }
        return list;
    };
    return {
        image: (ref, what) => resolveGalleryAsset(app.services.assets.list(IMAGE), IMAGE, ref, what),
        audio: (ref, what) => resolveGalleryAsset(app.services.assets.list(AUDIO), AUDIO, ref, what),
        async voiceUnit(unitId, what) {
            units ??= app.services.voice.listUnits();
            const unit = (await units).find(entry => entry.unitId === unitId.trim());
            if (!unit) {
                throw new GalleryToolError("not_found", `${what}: no recorded voice unit has the id "${unitId}".`, "Call list {voiceUnits:true} for the recorded lines, or use `audio` with a loose clip.");
            }
            return unit;
        },
        async scene(ref, what) {
            const stories = app.services.story.listStories();
            const pick = (value: string) => value.trim().toLowerCase();
            const candidates = ref.story
                ? stories.filter(story => story.id === ref.story || pick(story.name) === pick(ref.story!))
                : stories;
            if (ref.story && candidates.length === 0) {
                throw new GalleryToolError("not_found", `${what}: no story has the id or name "${ref.story}".`, "Call story_list for the stories and their scenes.");
            }
            const found: PluginSceneEntry[] = [];
            for (const story of candidates) {
                for (const scene of await scenesOf(story.id)) {
                    if (scene.id === ref.scene || pick(scene.name) === pick(ref.scene)) {
                        found.push(scene);
                    }
                }
            }
            if (found.length === 0) {
                throw new GalleryToolError("not_found", `${what}: no scene has the id or name "${ref.scene}".`, "Call story_list for the scene names and ids.");
            }
            if (found.length > 1 && !found.every(scene => scene.id === found[0]!.id)) {
                throw new GalleryToolError("invalid_args", `${what}: "${ref.scene}" names ${found.length} scenes.`, "Pass the scene id, or `story` as well.");
            }
            const scene = found[0]!;
            return { storyId: scene.storyId, sceneId: scene.id, ...(ref.startBlockId?.trim() ? { startBlockId: ref.startBlockId.trim() } : {}) };
        },
        measure: asset => store.measureAudio(asset),
    };
}

type VariantInput = { name?: string; image?: string; thumbnail?: string; audio?: string; voiceUnit?: string };

/** Build one variant for an entry of `kind`, refusing one that lacks what the kind is made of. */
async function buildVariant(
    resolve: Resolver,
    artworkId: string,
    kind: GalleryEntryKind,
    input: VariantInput,
    what: string,
): Promise<GalleryVariant> {
    const image = input.image?.trim() ? resolve.image(input.image, `${what}.image`) : null;
    const thumbnail = input.thumbnail?.trim() ? resolve.image(input.thumbnail, `${what}.thumbnail`) : null;
    const audio = input.audio?.trim() ? resolve.audio(input.audio, `${what}.audio`) : null;
    const unit = input.voiceUnit?.trim() ? await resolve.voiceUnit(input.voiceUnit, `${what}.voiceUnit`) : null;
    if (kind === "cg" && !image) {
        throw new GalleryToolError("invalid_args", `${what}: a cg variant needs \`image\`.`);
    }
    if (kind === "music" && !audio) {
        throw new GalleryToolError("invalid_args", `${what}: a music variant needs \`audio\`.`);
    }
    if (kind === "voice" && !unit && !audio) {
        throw new GalleryToolError("invalid_args", `${what}: a voice variant needs \`voiceUnit\` (or \`audio\` for a loose clip).`);
    }
    const durationSec = unit?.durationSec ?? (audio ? await resolve.measure(audio) : null);
    const fallbackName = unit?.text ? unit.text.slice(0, 60) : stripExtension((image ?? audio)?.name ?? "") || unit?.unitId || "";
    return {
        id: createVariantId(artworkId),
        name: input.name?.trim() || fallbackName,
        imageAssetId: image?.id ?? null,
        imageAssetName: image?.name ?? null,
        ...(thumbnail ? { thumbnailAssetId: thumbnail.id, thumbnailAssetName: thumbnail.name } : {}),
        ...(audio ? { audioAssetId: audio.id, audioAssetName: audio.name } : {}),
        ...(durationSec ? { durationSec } : {}),
        ...(unit ? { voiceUnitId: unit.unitId, lineText: unit.text } : {}),
    };
}

/** A group by id or name; a name nobody has is created, once, in `groups` (mutated). */
function resolveGroup(groups: GalleryGroup[], ref: string | undefined, created: GalleryGroup[]): string | null | undefined {
    if (ref === undefined) {
        return undefined;
    }
    const wanted = ref.trim();
    if (!wanted) {
        return null;
    }
    const existing = groups.find(group => group.id === wanted) ?? groups.find(group => group.name.toLowerCase() === wanted.toLowerCase());
    if (existing) {
        return existing.id;
    }
    const group = { id: createGroupId(), name: wanted };
    groups.push(group);
    created.push(group);
    return group.id;
}

// ── Projection for the list tool ─────────────────────────────────────────────────────────────────

function describeVariant(variant: GalleryVariant): Record<string, unknown> {
    return {
        id: variant.id,
        name: variant.name,
        ...(variant.imageAssetId ? { image: variant.imageAssetId, imageName: variant.imageAssetName ?? null } : {}),
        ...(variant.thumbnailAssetId ? { thumbnail: variant.thumbnailAssetId } : {}),
        ...(variant.audioAssetId ? { audio: variant.audioAssetId, audioName: variant.audioAssetName ?? null } : {}),
        ...(variant.durationSec ? { durationSec: Math.round(variant.durationSec * 10) / 10 } : {}),
        ...(variant.voiceUnitId ? { voiceUnit: variant.voiceUnitId } : {}),
        ...(variant.lineText ? { line: variant.lineText.slice(0, 80) } : {}),
    };
}

function describeEntry(artwork: GalleryArtwork, groups: readonly GalleryGroup[]): Record<string, unknown> {
    return {
        id: artwork.id,
        kind: artwork.kind,
        name: artwork.name,
        ...(artwork.description ? { description: artwork.description } : {}),
        group: artwork.groupId ? groups.find(group => group.id === artwork.groupId)?.name ?? null : null,
        ...(artwork.hidden ? { hidden: true } : {}),
        ...(artwork.coverVariantId ? { cover: artwork.coverVariantId } : {}),
        ...(artwork.lockedImageAssetId ? { lockedImage: artwork.lockedImageAssetId } : {}),
        ...(artwork.kind === "scene" ? { scene: artwork.scene ?? null } : {}),
        variants: artwork.variants.map(describeVariant),
    };
}

// ── Tools ────────────────────────────────────────────────────────────────────────────────────────

/** Run a handler, turning a {@link GalleryToolError} into a refusal the agent reads. */
async function handled(run: () => Promise<PluginAgentToolResult>): Promise<PluginAgentToolResult> {
    try {
        return await run();
    } catch (error) {
        if (error instanceof GalleryToolError) {
            return { error: { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}) } };
        }
        throw error;
    }
}

function requireWritable(app: PluginApp): void {
    if (app.services.workspace.frozen) {
        throw new GalleryToolError("unavailable", "The project is not accepting changes right now.", "Wait until the author's operation finishes, then try again.");
    }
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function createGalleryAgentTools(app: PluginApp, store: GalleryStore): PluginAgentToolDef[] {
    const tr = createGalleryTranslator(app);

    const commit = async (next: GalleryStoreData) => {
        requireWritable(app);
        await store.replaceData(next);
    };

    const entryById = (data: GalleryStoreData, id: string, what: string): GalleryArtwork => {
        const entry = data.items.find(item => item.id === id.trim());
        if (!entry) {
            throw new GalleryToolError("not_found", `${what}: no gallery entry has the id "${id}".`, "Call narraleaf_gallery__list for the entry ids.");
        }
        return entry;
    };

    const list: PluginAgentToolDef = {
        name: GALLERY_AGENT_TOOLS.list,
        title: "Read the gallery",
        description:
            "The EXTRA page's catalog: groups, entries of every kind (cg, scene, music, voice) with their ids and variants, and the locked look. "
            + "Call it before editing the gallery, for the ids the other gallery tools take. `voiceUnits: true` also lists the recorded voice lines a voice entry can use.",
        inputSchema: {
            type: "object",
            properties: {
                kind: { type: "string", enum: [...GALLERY_ENTRY_KINDS], description: "Only entries of this kind." },
                query: { type: "string", description: "Only entries whose name contains this." },
                voiceUnits: { type: "boolean", description: "Also list recorded voice units (id, line, speaker), up to 300." },
            },
            additionalProperties: false,
        },
        write: false,
        handler: args => handled(async () => {
            const data = store.getData();
            const kind = readString(args.kind) as GalleryEntryKind | undefined;
            const query = readString(args.query)?.trim().toLowerCase();
            const entries = data.items
                .filter(item => !kind || item.kind === kind)
                .filter(item => !query || item.name.toLowerCase().includes(query))
                .map(item => describeEntry(item, data.groups));
            const counts = Object.fromEntries(GALLERY_ENTRY_KINDS.map(entryKind => [entryKind, data.items.filter(item => item.kind === entryKind).length]));
            const result: Record<string, unknown> = {
                counts,
                groups: data.groups.map(group => ({ id: group.id, name: group.name, entries: data.items.filter(item => item.groupId === group.id).length })),
                settings: {
                    lockedImage: data.settings.lockedImageAssetId,
                    lockedImageName: data.settings.lockedImageAssetName ?? null,
                    lockedNameMask: data.settings.lockedNameMask,
                },
                entries,
            };
            if (args.voiceUnits === true) {
                const seen = new Set<string>();
                result.voiceUnits = (await app.services.voice.listUnits())
                    .filter(unit => !seen.has(unit.unitId) && seen.add(unit.unitId))
                    .slice(0, 300)
                    .map(unit => ({ id: unit.unitId, line: unit.text.slice(0, 80), speaker: unit.character }));
            }
            let json = JSON.stringify(result);
            if (json.length > 55_000) {
                result.entries = entries.slice(0, Math.max(1, Math.floor(entries.length * 55_000 / json.length)));
                result.truncated = `Showing ${(result.entries as unknown[]).length} of ${entries.length} entries; pass \`kind\` or \`query\` for the rest.`;
                json = JSON.stringify(result);
            }
            const lead = `Gallery: ${GALLERY_ENTRY_KINDS.map(entryKind => `${counts[entryKind]} ${entryKind}`).join(", ")}; ${data.groups.length} groups.`;
            return { text: `${lead}\n${UNLOCK_SUMMARY}\n${json}`, data: result };
        }),
    };

    const addEntries: PluginAgentToolDef = {
        name: GALLERY_AGENT_TOOLS.addEntries,
        title: "Add gallery entries",
        description:
            "Adds entries to the EXTRA page in one undo step: cg artworks (each variant an image - differentials of one CG go in one entry), "
            + "scene recollections (`scene` names the scene to replay; an image is its thumbnail), music (each variant a track: an album is one entry, a single track one entry with one variant), "
            + "voice sets (each variant a recorded line by `voiceUnit`). Assets by id or exact name; import them first. Answers the new ids.",
        inputSchema: {
            type: "object",
            properties: {
                entries: { type: "array", items: ENTRY_SCHEMA, description: "The entries, in the order they appear." },
                before: { type: "string", description: "Insert before this entry id. Default: at the end." },
            },
            required: ["entries"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            requireWritable(app);
            const inputs = Array.isArray(args.entries) ? args.entries as Record<string, unknown>[] : [];
            if (inputs.length === 0) {
                throw new GalleryToolError("invalid_args", "`entries` is empty.");
            }
            const data = store.getData();
            const resolve = createResolver(app, store);
            const groups = data.groups.map(group => ({ ...group }));
            const createdGroups: GalleryGroup[] = [];
            const counts = new Map<GalleryEntryKind, number>();
            const added: GalleryArtwork[] = [];
            for (const [index, input] of inputs.entries()) {
                const what = `entries[${index}]`;
                const kind = input.kind as GalleryEntryKind;
                const id = createArtworkId();
                const variantInputs = Array.isArray(input.variants) ? input.variants as VariantInput[] : [];
                const variants: GalleryVariant[] = [];
                for (const [variantIndex, variant] of variantInputs.entries()) {
                    variants.push(await buildVariant(resolve, id, kind, variant, `${what}.variants[${variantIndex}]`));
                }
                const cover = typeof input.cover === "number" ? variants[input.cover - 1] : undefined;
                if (typeof input.cover === "number" && !cover) {
                    throw new GalleryToolError("invalid_args", `${what}.cover: there is no variant ${input.cover}.`);
                }
                const scene = isRecord(input.scene)
                    ? await resolve.scene(input.scene as { scene: string; story?: string; startBlockId?: string }, `${what}.scene`)
                    : null;
                if (kind === "scene" && !scene) {
                    throw new GalleryToolError("invalid_args", `${what}: a scene entry needs \`scene\` - the scene it replays.`);
                }
                const lockedImage = readString(input.lockedImage)?.trim() ? resolve.image(readString(input.lockedImage)!, `${what}.lockedImage`) : null;
                const ordinal = data.items.filter(item => item.kind === kind).length + (counts.get(kind) ?? 0) + 1;
                counts.set(kind, (counts.get(kind) ?? 0) + 1);
                const name = readString(input.name)?.trim()
                    || (kind === "voice" ? "" : variants[0]?.name)
                    || tr.t(DEFAULT_ENTRY_NAME[kind], { n: ordinal });
                const now = Date.now();
                added.push({
                    id,
                    name,
                    kind,
                    description: readString(input.description) ?? "",
                    groupId: resolveGroup(groups, readString(input.group), createdGroups) ?? null,
                    variants,
                    coverVariantId: cover?.id ?? null,
                    lockedImageAssetId: lockedImage?.id ?? null,
                    lockedImageAssetName: lockedImage?.name ?? null,
                    hidden: input.hidden === true,
                    ...(scene ? { scene } : {}),
                    createdAt: now,
                    updatedAt: now,
                });
            }
            const before = readString(args.before)?.trim();
            const items = [...data.items];
            const at = before ? items.findIndex(item => item.id === before) : -1;
            if (before && at < 0) {
                throw new GalleryToolError("not_found", `before: no gallery entry has the id "${before}".`);
            }
            items.splice(at < 0 ? items.length : at, 0, ...added);
            await commit({ ...data, groups, items });
            const lines = added.map(entry => `- ${entry.kind} "${entry.name}" ${entry.id} (${entry.variants.length} variant${entry.variants.length === 1 ? "" : "s"})`);
            if (createdGroups.length > 0) {
                lines.push(`Created groups: ${createdGroups.map(group => `"${group.name}" ${group.id}`).join(", ")}.`);
            }
            return {
                text: `Added ${added.length} gallery entr${added.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`,
                data: {
                    entries: added.map(entry => ({ id: entry.id, kind: entry.kind, name: entry.name, variants: entry.variants.map(variant => variant.id) })),
                    createdGroups,
                },
            };
        }),
    };

    const updateEntries: PluginAgentToolDef = {
        name: GALLERY_AGENT_TOOLS.updateEntries,
        title: "Edit gallery entries",
        description:
            "Edits existing entries in one undo step. Per entry (by `id` from narraleaf_gallery__list): any of name, description, group, hidden, scene, lockedImage (\"\" clears), "
            + "cover (variant id; \"\" = the first), addVariants, removeVariants (variant ids), variants (edit by id: name, image, thumbnail, audio, voiceUnit), "
            + "moveBefore (entry id; \"\" = to the end). Fields left out stay as they are. The kind cannot change: remove and add instead.",
        inputSchema: {
            type: "object",
            properties: {
                entries: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            description: { type: "string" },
                            group: GROUP_REF,
                            hidden: { type: "boolean" },
                            scene: SCENE_SCHEMA,
                            lockedImage: { type: "string", description: `${ASSET_REF} "" clears it.` },
                            cover: { type: "string", description: "Variant id shown as the cover; \"\" falls back to the first variant." },
                            addVariants: { type: "array", items: VARIANT_SCHEMA },
                            removeVariants: { type: "array", items: { type: "string" } },
                            variants: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: { ...VARIANT_SCHEMA.properties, id: { type: "string" } },
                                    required: ["id"],
                                    additionalProperties: false,
                                },
                            },
                            moveBefore: { type: "string", description: "Entry id to move in front of; \"\" moves it to the end." },
                        },
                        required: ["id"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["entries"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            requireWritable(app);
            const inputs = Array.isArray(args.entries) ? args.entries as Record<string, unknown>[] : [];
            const data = store.getData();
            const resolve = createResolver(app, store);
            const groups = data.groups.map(group => ({ ...group }));
            const createdGroups: GalleryGroup[] = [];
            let items = data.items.map(item => ({ ...item, variants: item.variants.map(variant => ({ ...variant })) }));
            const moves: { id: string; before: string }[] = [];
            const changed: string[] = [];
            for (const [index, input] of inputs.entries()) {
                const what = `entries[${index}]`;
                const current = entryById({ ...data, items }, String(input.id), what);
                const entry = items.find(item => item.id === current.id)!;
                if (typeof input.name === "string" && input.name.trim()) {
                    entry.name = input.name.trim();
                }
                if (typeof input.description === "string") {
                    entry.description = input.description;
                }
                const group = resolveGroup(groups, readString(input.group), createdGroups);
                if (group !== undefined) {
                    entry.groupId = group;
                }
                if (typeof input.hidden === "boolean") {
                    entry.hidden = input.hidden;
                }
                if (isRecord(input.scene)) {
                    if (entry.kind !== "scene") {
                        throw new GalleryToolError("invalid_args", `${what}.scene: only a scene entry replays a scene; this one is ${entry.kind}.`);
                    }
                    entry.scene = await resolve.scene(input.scene as { scene: string; story?: string; startBlockId?: string }, `${what}.scene`);
                }
                if (typeof input.lockedImage === "string") {
                    const locked = input.lockedImage.trim() ? resolve.image(input.lockedImage, `${what}.lockedImage`) : null;
                    entry.lockedImageAssetId = locked?.id ?? null;
                    entry.lockedImageAssetName = locked?.name ?? null;
                }
                for (const variantId of Array.isArray(input.removeVariants) ? input.removeVariants as string[] : []) {
                    if (!entry.variants.some(variant => variant.id === variantId)) {
                        throw new GalleryToolError("not_found", `${what}.removeVariants: "${entry.name}" has no variant "${variantId}".`);
                    }
                    entry.variants = entry.variants.filter(variant => variant.id !== variantId);
                    if (entry.coverVariantId === variantId) {
                        entry.coverVariantId = null;
                    }
                }
                for (const [variantIndex, patch] of (Array.isArray(input.variants) ? input.variants as (VariantInput & { id: string })[] : []).entries()) {
                    const where = `${what}.variants[${variantIndex}]`;
                    const position = entry.variants.findIndex(variant => variant.id === patch.id);
                    if (position < 0) {
                        throw new GalleryToolError("not_found", `${where}: "${entry.name}" has no variant "${patch.id}".`);
                    }
                    const variant = entry.variants[position]!;
                    if (patch.name?.trim()) {
                        variant.name = patch.name.trim();
                    }
                    if (patch.image !== undefined) {
                        const image = patch.image.trim() ? resolve.image(patch.image, `${where}.image`) : null;
                        variant.imageAssetId = image?.id ?? null;
                        variant.imageAssetName = image?.name ?? null;
                    }
                    if (patch.thumbnail !== undefined) {
                        const thumbnail = patch.thumbnail.trim() ? resolve.image(patch.thumbnail, `${where}.thumbnail`) : null;
                        variant.thumbnailAssetId = thumbnail?.id ?? null;
                        variant.thumbnailAssetName = thumbnail?.name ?? null;
                    }
                    if (patch.audio !== undefined) {
                        const audio = patch.audio.trim() ? resolve.audio(patch.audio, `${where}.audio`) : null;
                        variant.audioAssetId = audio?.id ?? null;
                        variant.audioAssetName = audio?.name ?? null;
                        variant.durationSec = audio ? await resolve.measure(audio) : null;
                    }
                    if (patch.voiceUnit !== undefined) {
                        const unit = patch.voiceUnit.trim() ? await resolve.voiceUnit(patch.voiceUnit, `${where}.voiceUnit`) : null;
                        variant.voiceUnitId = unit?.unitId ?? null;
                        variant.lineText = unit?.text ?? null;
                        if (unit?.durationSec) {
                            variant.durationSec = unit.durationSec;
                        }
                    }
                }
                const additions = Array.isArray(input.addVariants) ? input.addVariants as VariantInput[] : [];
                for (const [variantIndex, variant] of additions.entries()) {
                    entry.variants.push(await buildVariant(resolve, entry.id, entry.kind, variant, `${what}.addVariants[${variantIndex}]`));
                }
                if (typeof input.cover === "string") {
                    const cover = input.cover.trim();
                    if (cover && !entry.variants.some(variant => variant.id === cover)) {
                        throw new GalleryToolError("not_found", `${what}.cover: "${entry.name}" has no variant "${cover}".`);
                    }
                    entry.coverVariantId = cover || null;
                }
                if (typeof input.moveBefore === "string") {
                    moves.push({ id: entry.id, before: input.moveBefore.trim() });
                }
                entry.updatedAt = Date.now();
                changed.push(`"${entry.name}" ${entry.id}`);
            }
            for (const move of moves) {
                const from = items.findIndex(item => item.id === move.id);
                const [moved] = items.splice(from, 1);
                const to = move.before ? items.findIndex(item => item.id === move.before) : items.length;
                if (move.before && to < 0) {
                    throw new GalleryToolError("not_found", `moveBefore: no gallery entry has the id "${move.before}".`);
                }
                items = [...items.slice(0, to), moved!, ...items.slice(to)];
            }
            await commit({ ...data, groups, items });
            return {
                text: `Updated ${changed.length} gallery entr${changed.length === 1 ? "y" : "ies"}: ${changed.join(", ")}.`
                    + (createdGroups.length > 0 ? ` Created groups: ${createdGroups.map(group => `"${group.name}" ${group.id}`).join(", ")}.` : ""),
                data: { updated: inputs.map(input => String(input.id)), createdGroups },
            };
        }),
    };

    const removeEntries: PluginAgentToolDef = {
        name: GALLERY_AGENT_TOOLS.removeEntries,
        title: "Remove gallery entries",
        description: "Removes entries (by id) from the gallery in one undo step. Their files stay in the project; Unlock Gallery nodes that named them stop finding them.",
        inputSchema: {
            type: "object",
            properties: { ids: { type: "array", items: { type: "string" } } },
            required: ["ids"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            requireWritable(app);
            const data = store.getData();
            const ids = (Array.isArray(args.ids) ? args.ids as string[] : []).map(id => entryById(data, id, "ids").id);
            const doomed = new Set(ids);
            await commit({ ...data, items: data.items.filter(item => !doomed.has(item.id)) });
            return { text: `Removed ${doomed.size} gallery entr${doomed.size === 1 ? "y" : "ies"}.`, data: { removed: [...doomed] } };
        }),
    };

    const setGroups: PluginAgentToolDef = {
        name: GALLERY_AGENT_TOOLS.setGroups,
        title: "Set gallery groups",
        description:
            "Replaces the gallery's group list, in order, in one undo step. Keep a group by passing its `id` (rename it with `name`); "
            + "a group without `id` is created; a group left out is deleted and its entries become ungrouped. Groups are the chips players filter by (chapters, routes, characters).",
        inputSchema: {
            type: "object",
            properties: {
                groups: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: { id: { type: "string" }, name: { type: "string" } },
                        required: ["name"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["groups"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            requireWritable(app);
            const data = store.getData();
            const inputs = Array.isArray(args.groups) ? args.groups as { id?: string; name: string }[] : [];
            const groups: GalleryGroup[] = inputs.map((input, index) => {
                const name = input.name.trim();
                if (!name) {
                    throw new GalleryToolError("invalid_args", `groups[${index}]: a group needs a name.`);
                }
                if (input.id?.trim()) {
                    if (!data.groups.some(group => group.id === input.id!.trim())) {
                        throw new GalleryToolError("not_found", `groups[${index}]: no group has the id "${input.id}".`, "Leave `id` out to create a group.");
                    }
                    return { id: input.id.trim(), name };
                }
                return { id: createGroupId(), name };
            });
            if (new Set(groups.map(group => group.id)).size !== groups.length) {
                throw new GalleryToolError("invalid_args", "The same group id is listed twice.");
            }
            await commit({ ...data, groups });
            const removed = data.groups.filter(group => !groups.some(kept => kept.id === group.id));
            return {
                text: `The gallery has ${groups.length} group${groups.length === 1 ? "" : "s"}: ${groups.map(group => `"${group.name}" ${group.id}`).join(", ") || "none"}.`
                    + (removed.length > 0 ? ` Deleted: ${removed.map(group => `"${group.name}"`).join(", ")} (their entries are ungrouped).` : ""),
                data: { groups, removed: removed.map(group => group.id) },
            };
        }),
    };

    const setSettings: PluginAgentToolDef = {
        name: GALLERY_AGENT_TOOLS.setSettings,
        title: "Set the gallery's locked look",
        description:
            "Sets what a locked entry looks like on the EXTRA page, in one undo step: `lockedImage` (the placeholder picture for every locked entry without its own; \"\" clears) "
            + "and `lockedNameMask` (the title shown instead of a locked entry's name, default ???; \"\" shows real names).",
        inputSchema: {
            type: "object",
            properties: {
                lockedImage: { type: "string", description: `${ASSET_REF} "" clears it.` },
                lockedNameMask: { type: "string" },
            },
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            requireWritable(app);
            const data = store.getData();
            const settings = { ...data.settings };
            if (typeof args.lockedImage === "string") {
                const image = args.lockedImage.trim() ? createResolver(app, store).image(args.lockedImage, "lockedImage") : null;
                settings.lockedImageAssetId = image?.id ?? null;
                settings.lockedImageAssetName = image?.name ?? null;
            }
            if (typeof args.lockedNameMask === "string") {
                settings.lockedNameMask = args.lockedNameMask;
            }
            await commit({ ...data, settings });
            return {
                text: `Locked look: placeholder ${settings.lockedImageAssetName ?? settings.lockedImageAssetId ?? "none"}, name shown as ${settings.lockedNameMask ? JSON.stringify(settings.lockedNameMask) : "the real name"}.`,
                data: { settings },
            };
        }),
    };

    return [list, addEntries, updateEntries, removeEntries, setGroups, setSettings];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
