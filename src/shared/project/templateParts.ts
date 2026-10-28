import { normalizeLocalizedTextPack, resolveLocalizedText, type LocalizedTextPack } from "../types/localizedText";
import { hashSourceText } from "../utils/localizationText";
import { assetStorageIdFromContentPath } from "../utils/assetStorageId";

/**
 * The parts of a project template an author may leave out of the project it makes.
 *
 * A template is copied whole, and the skeleton's whole is a small working game: its screens, and a
 * sample story with its cast and its pictures and music. The screens are what most projects keep;
 * the sample is what a project that already has a story - a port of a finished game, above all -
 * spends its first steps deleting. So the template names its sample as parts, the project wizard
 * and `project_create` let the author untick them, and what is left out is taken back out of the
 * project right after the copy, before anything opens it.
 *
 * What each part means is Studio's, not the template's: the three kinds below are the three things
 * Studio knows how to take out of its own documents without leaving a reference behind. The
 * template only says which of them it has, what to call them, and what each one needs.
 *
 * Comments in English per project convention.
 */

export const PROJECT_TEMPLATE_PART_IDS = ["story", "characters", "files"] as const;

/**
 * - `story`: every scene but each story's entry scene, which stays under its id - the title's Start
 *   names it - emptied, renamed (`emptyScene`) and without a background of its own; with it, the
 *   variables nothing else reads.
 * - `characters`: every character.
 * - `files`: every asset nothing left in the project names - the interface, the palette, and
 *   whatever story and characters were kept.
 */
export type ProjectTemplatePartId = (typeof PROJECT_TEMPLATE_PART_IDS)[number];

export type ProjectTemplatePart = {
    id: ProjectTemplatePartId;
    name: string;
    description: string;
    locales: LocalizedTextPack;
    /**
     * The parts this one cannot be kept without. The sample story's lines name the sample cast and
     * show the sample pictures, so leaving either of those out leaves the story out with it.
     */
    requires: ProjectTemplatePartId[];
    /** `story` only: what the emptied entry scene is called, in each language the project has. */
    emptyScene?: { name: string; description: string; locales: LocalizedTextPack };
};

function isPartId(value: unknown): value is ProjectTemplatePartId {
    return typeof value === "string" && (PROJECT_TEMPLATE_PART_IDS as readonly string[]).includes(value);
}

function asText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/**
 * The manifest's `parts`, as far as Studio understands them.
 *
 * A part of a kind this build does not know is dropped rather than offered: an untick that removed
 * nothing would be a promise the wizard could not keep. So is a requirement on a part the template
 * does not have.
 */
export function parseProjectTemplateParts(value: unknown): ProjectTemplatePart[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const parts: ProjectTemplatePart[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const name = asText(record.name);
        if (!isPartId(record.id) || !name || parts.some(part => part.id === record.id)) {
            continue;
        }
        const emptyScene = record.emptyScene && typeof record.emptyScene === "object"
            ? record.emptyScene as Record<string, unknown>
            : null;
        parts.push({
            id: record.id,
            name,
            description: asText(record.description),
            locales: normalizeLocalizedTextPack(record.locales),
            requires: Array.isArray(record.requires) ? record.requires.filter(isPartId) : [],
            ...(emptyScene && asText(emptyScene.name)
                ? { emptyScene: { name: asText(emptyScene.name), description: "", locales: normalizeLocalizedTextPack(emptyScene.locales) } }
                : {}),
        });
    }
    const ids = new Set(parts.map(part => part.id));
    return parts.map(part => ({ ...part, requires: part.requires.filter(id => ids.has(id) && id !== part.id) }));
}

/**
 * Everything that has to go when `requested` goes: a part that requires a left-out part is left out
 * too, however long the chain. Only parts the template has; in the template's own order.
 */
export function resolveLeftOutParts(
    parts: readonly Pick<ProjectTemplatePart, "id" | "requires">[],
    requested: Iterable<string>,
): ProjectTemplatePartId[] {
    const out = new Set<string>([...requested].filter(id => parts.some(part => part.id === id)));
    let grew = true;
    while (grew) {
        grew = false;
        for (const part of parts) {
            if (!out.has(part.id) && part.requires.some(id => out.has(id))) {
                out.add(part.id);
                grew = true;
            }
        }
    }
    return parts.filter(part => out.has(part.id)).map(part => part.id);
}

/**
 * The parts that have to stay when `kept` stays: ticking a part back on ticks on what it requires.
 * The inverse of {@link resolveLeftOutParts}, for the wizard's checkboxes.
 */
export function partsKeptWith(
    parts: readonly Pick<ProjectTemplatePart, "id" | "requires">[],
    kept: ProjectTemplatePartId,
): ProjectTemplatePartId[] {
    const out = new Set<ProjectTemplatePartId>([kept]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const part of parts) {
            if (out.has(part.id)) {
                for (const id of part.requires) {
                    if (!out.has(id)) {
                        out.add(id);
                        grew = true;
                    }
                }
            }
        }
    }
    return [...out];
}

/** A project's files as the trim reads and writes them, by project-relative `/` path. */
export interface TemplatePartFiles {
    /** Every file in the project. */
    list(): Promise<string[]>;
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    remove(path: string): Promise<void>;
}

const STORY_INDEX = "editor/story/index.json";
const CHARACTERS = "editor/services/character.json";
const VARIABLES = "editor/variables.json";
/** Where baked dialog avatars live, one directory per character (`characterAvatarBakePath`). */
const AVATAR_DIR = "resources/characters/avatars/";
const LOCALIZATION_DIR = "editor/localization/";
const LOCALIZATION_KEYS = "editor/localization/keys.json";
const ASSET_METADATA = /^assets\/assets\.metadata\.[^./]+\.json$/;
const ASSET_ORDER = /^assets\/assets\.order\.[^./]+\.json$/;
const ASSET_GROUPS = /^assets\/assets\.groups\.[^./]+\.json$/;

type Json = Record<string, unknown>;

/** Written back in the layout it was read in, so a file the trim only filtered diffs as a filter. */
function formatLike(original: string, value: unknown): string {
    const indent = /^\{\r?\n( +|\t)/.exec(original)?.[1];
    const text = JSON.stringify(value, null, indent);
    return original.endsWith("\n") ? `${text}\n` : text;
}

/** Every `textId` in a story document: the ids its lines and choices are translated under. */
function collectTextIds(value: unknown, out: Set<string>): void {
    if (Array.isArray(value)) {
        value.forEach(item => collectTextIds(item, out));
    } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            if (key === "textId" && typeof item === "string") {
                out.add(item);
            } else {
                collectTextIds(item, out);
            }
        }
    }
}

/** The language a translation file is for, from its name (`zh-CN.json` → `zh-CN`). */
function fileLocale(path: string): string {
    return path.slice(LOCALIZATION_DIR.length, -".json".length);
}

/**
 * Take the left-out parts back out of a project a template has just been copied into.
 *
 * `leftOut` should already be closed over requirements ({@link resolveLeftOutParts}); a story kept
 * without its characters would be left naming people the project does not have. `sourceLocale` is
 * the language the project's content is written in - empty for the template's base tree, whose
 * language is the manifest's own - so the renamed entry scene's translations are stamped against
 * the name it actually has.
 *
 * Order matters: the story and the cast go first, because whether a variable or a file is still
 * needed is answered by reading what is left.
 */
export async function leaveOutTemplateParts(
    files: TemplatePartFiles,
    parts: readonly ProjectTemplatePart[],
    leftOut: readonly ProjectTemplatePartId[],
    sourceLocale: string,
): Promise<void> {
    const out = new Set(leftOut);
    if (out.size === 0) {
        return;
    }
    const paths = new Set(await files.list());
    const readJson = async (path: string): Promise<{ text: string; value: Json } | null> => {
        if (!paths.has(path)) {
            return null;
        }
        const text = await files.read(path);
        return { text, value: JSON.parse(text) as Json };
    };

    const removedTexts = new Set<string>();
    const removedScenes = new Set<string>();
    const emptiedScenes = new Set<string>();
    const removedCharacters = new Set<string>();

    if (out.has("story")) {
        const index = await readJson(STORY_INDEX);
        const stories = Array.isArray(index?.value.stories) ? index.value.stories as Json[] : [];
        const sceneName = parts.find(part => part.id === "story")?.emptyScene;
        for (const story of stories) {
            const documentPath = asText(story.documentPath);
            const document = documentPath ? await readJson(documentPath) : null;
            if (!document) {
                continue;
            }
            const doc = document.value;
            collectTextIds(doc.scenes, removedTexts);
            const scenes = (doc.scenes ?? {}) as Record<string, Json>;
            const entryId = asText(doc.entrySceneId);
            const entry = scenes[entryId];
            for (const id of Object.keys(scenes)) {
                if (id !== entryId) {
                    removedScenes.add(id);
                }
            }
            if (entry) {
                emptiedScenes.add(entryId);
                const { defaultBackgroundAssetId: _background, ...kept } = entry;
                doc.scenes = {
                    [entryId]: {
                        ...kept,
                        ...(sceneName ? { name: resolveLocalizedText(sceneName, sourceLocale).name } : {}),
                        rootBlockIds: [],
                        blocks: {},
                    },
                };
            } else {
                doc.scenes = {};
            }
            if (Array.isArray(doc.chapters)) {
                doc.chapters = (doc.chapters as Json[])
                    .filter(chapter => Array.isArray(chapter.sceneIds) && (chapter.sceneIds as string[]).includes(entryId))
                    .map(chapter => ({ ...chapter, sceneIds: [entryId] }));
            }
            await files.write(documentPath, formatLike(document.text, doc));
        }
    }

    if (out.has("characters")) {
        const cast = await readJson(CHARACTERS);
        if (cast && Array.isArray(cast.value.characters)) {
            for (const character of cast.value.characters as Json[]) {
                const id = asText((character.profile as Json | undefined)?.id);
                if (id) {
                    removedCharacters.add(id);
                }
            }
            await files.write(CHARACTERS, formatLike(cast.text, { ...cast.value, characters: [] }));
            // The avatars Studio baked from their sprites are files of their own, filed by character.
            for (const path of paths) {
                const owner = path.startsWith(AVATAR_DIR) ? path.slice(AVATAR_DIR.length).split("/")[0] : null;
                if (owner && removedCharacters.has(owner)) {
                    await files.remove(path);
                }
            }
        }
    }

    if (removedTexts.size > 0 || removedScenes.size > 0 || emptiedScenes.size > 0 || removedCharacters.size > 0) {
        const sceneName = parts.find(part => part.id === "story")?.emptyScene;
        for (const path of paths) {
            if (!path.startsWith(LOCALIZATION_DIR) || !path.endsWith(".json") || path === LOCALIZATION_KEYS || path.slice(LOCALIZATION_DIR.length).includes("/")) {
                continue;
            }
            const translation = await readJson(path);
            if (!translation || !translation.value.units || typeof translation.value.units !== "object") {
                continue;
            }
            const units: Record<string, unknown> = {};
            for (const [id, unit] of Object.entries(translation.value.units as Record<string, Json>)) {
                if (removedTexts.has(id)
                    || (id.startsWith("scene:") && removedScenes.has(id.slice("scene:".length)))
                    || (id.startsWith("char:") && removedCharacters.has(id.slice("char:".length)))) {
                    continue;
                }
                units[id] = id.startsWith("scene:") && emptiedScenes.has(id.slice("scene:".length)) && sceneName
                    ? {
                        ...unit,
                        sourceHash: hashSourceText(resolveLocalizedText(sceneName, sourceLocale).name),
                        target: resolveLocalizedText(sceneName, fileLocale(path)).name,
                    }
                    : unit;
            }
            await files.write(path, formatLike(translation.text, { ...translation.value, units }));
        }
    }

    // What is still named anywhere in the project's documents, once the story and the cast are gone.
    const editorText = async (except: string): Promise<string> => {
        const texts: string[] = [];
        for (const path of paths) {
            if (path.startsWith("editor/") && path.endsWith(".json") && path !== except && !path.startsWith(LOCALIZATION_DIR)) {
                texts.push(await files.read(path));
            }
        }
        return texts.join("\n");
    };

    if (out.has("story")) {
        const variables = await readJson(VARIABLES);
        if (variables && variables.value.entries && typeof variables.value.entries === "object") {
            const named = await editorText(VARIABLES);
            const entries = Object.fromEntries(
                Object.entries(variables.value.entries as Record<string, unknown>).filter(([id]) => named.includes(id)),
            );
            await files.write(VARIABLES, formatLike(variables.text, { ...variables.value, entries }));
        }
    }

    if (out.has("files")) {
        const named = await editorText("");
        const keptAssets = new Set<string>();
        const groupsBefore = new Set<string>();
        const groupsAfter = new Set<string>();
        for (const path of [...paths].filter(path => ASSET_METADATA.test(path))) {
            const metadata = await readJson(path);
            if (!metadata) {
                continue;
            }
            const records = Object.entries(metadata.value as Record<string, Json>);
            const kept = records.filter(([id]) => named.includes(id));
            for (const [id, record] of records) {
                const groupId = asText(record.groupId);
                if (groupId) {
                    groupsBefore.add(groupId);
                }
                if (kept.some(([keptId]) => keptId === id)) {
                    keptAssets.add(id);
                    if (groupId) {
                        groupsAfter.add(groupId);
                    }
                }
            }
            if (kept.length !== records.length) {
                await files.write(path, formatLike(metadata.text, Object.fromEntries(kept)));
            }
        }
        // A group the trim emptied goes with its members; one the template shipped empty stays.
        const keepGroup = (id: string) => !groupsBefore.has(id) || groupsAfter.has(id);
        for (const path of paths) {
            if (ASSET_ORDER.test(path)) {
                const order = await readJson(path);
                if (order) {
                    await files.write(path, formatLike(order.text, {
                        ...order.value,
                        ...(Array.isArray(order.value.assetIds) ? { assetIds: (order.value.assetIds as string[]).filter(id => keptAssets.has(id)) } : {}),
                        ...(Array.isArray(order.value.groupIds) ? { groupIds: (order.value.groupIds as string[]).filter(keepGroup) } : {}),
                    }));
                }
            } else if (ASSET_GROUPS.test(path)) {
                const groups = await readJson(path);
                if (groups) {
                    await files.write(path, formatLike(
                        groups.text,
                        Object.fromEntries(Object.entries(groups.value).filter(([id]) => keepGroup(id))),
                    ));
                }
            } else if (path.startsWith("assets/content/")) {
                const id = assetStorageIdFromContentPath(path);
                if (id && !keptAssets.has(id)) {
                    await files.remove(path);
                }
            }
        }
    }
}

