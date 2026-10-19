/**
 * Finding what an agent names: a story, a scene, a page, a component, an asset.
 *
 * Agents name things the way the author does - by name - and the tools accept an id as well, since
 * every answer hands ids back. A name two things share is refused as ambiguous rather than resolved
 * to the first, because acting on the wrong scene is worse than asking again.
 *
 * Comments in English per project convention.
 */

import type { StoryDocument, StoryLibraryEntry, StoryScene } from "@shared/types/story";
import type { UIComponentDefinition, UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { TranslationKey } from "@shared/i18n";
import { Services, type WorkspaceContext } from "../services";
import type { StoryService } from "../story/StoryService";
import type { AssetsService } from "../core/AssetsService";
import type { HistoryLabel } from "../history/historyModel";
import { AssetType } from "../assets/assetTypes";
import type { Asset, AssetSource } from "../assets/types";
import { refuse } from "./agentCall";

/** What every agent write is called in the Edit menu, so the author can tell it from their own. */
export const AGENT_HISTORY_LABEL: HistoryLabel = { key: "workspace.history.entry.agentEdit" as TranslationKey };

export function storyService(ctx: WorkspaceContext): StoryService {
    return ctx.services.get<StoryService>(Services.Story);
}

/** The story `ref` names (name or id), or the project's default story when `ref` is absent. */
export async function resolveStory(ctx: WorkspaceContext, ref: string | undefined): Promise<{ entry: StoryLibraryEntry; document: StoryDocument }> {
    const story = storyService(ctx);
    const stories = story.listStories();
    let entry: StoryLibraryEntry | undefined;
    if (ref) {
        entry = stories.find(item => item.id === ref);
        if (!entry) {
            const named = stories.filter(item => item.name === ref);
            if (named.length > 1) {
                throw refuse("invalid_args", `${named.length} stories are called "${ref}".`, "Name the story by id (story_list).");
            }
            entry = named[0];
        }
        if (!entry) {
            throw refuse("not_found", `No story "${ref}".`, "Call story_list for the stories in this project.");
        }
    } else {
        const defaultId = story.getDefaultStoryId();
        entry = (defaultId ? stories.find(item => item.id === defaultId) : undefined) ?? stories[0];
        if (!entry) {
            throw refuse("not_found", "This project has no story yet.", "Create one with scene_create, which makes the story too.");
        }
    }
    return { entry, document: await story.loadStory(entry.id) };
}

/** The scene `ref` names in `document`, by id or by name. */
export function resolveScene(document: StoryDocument, ref: string): StoryScene {
    const byId = document.scenes[ref];
    if (byId) {
        return byId;
    }
    const named = Object.values(document.scenes).filter(scene => scene.name === ref);
    if (named.length > 1) {
        throw refuse("invalid_args", `${named.length} scenes are called "${ref}" in story "${document.name}".`, "Name the scene by id (story_list).");
    }
    if (named.length === 0) {
        throw refuse("not_found", `No scene "${ref}" in story "${document.name}".`, "Call story_list for the scenes and their ids.");
    }
    return named[0];
}

/** The scenes of a document in the order the outline shows them: chapter by chapter, then the unfiled ones. */
export function scenesInOrder(document: StoryDocument): StoryScene[] {
    const ids = [...document.chapters.flatMap(chapter => chapter.sceneIds), ...(document.unassignedSceneIds ?? [])];
    const seen = new Set<string>();
    const out: StoryScene[] = [];
    for (const id of ids) {
        const scene = document.scenes[id];
        if (scene && !seen.has(id)) {
            seen.add(id);
            out.push(scene);
        }
    }
    for (const scene of Object.values(document.scenes)) {
        if (!seen.has(scene.id)) {
            out.push(scene);
        }
    }
    return out;
}

export function resolveSurface(document: UIDocument, ref: string): UISurface | undefined {
    const byId = document.surfaces.find(surface => surface.id === ref);
    if (byId) {
        return byId;
    }
    const named = document.surfaces.filter(surface => surface.name === ref);
    if (named.length > 1) {
        throw refuse("invalid_args", `${named.length} pages are called "${ref}".`, "Name the page by id (ui_surfaces).");
    }
    return named[0];
}

export function resolveComponent(document: UIDocument, ref: string): UIComponentDefinition | undefined {
    const components = document.components ?? [];
    const byId = components.find(component => component.id === ref);
    if (byId) {
        return byId;
    }
    const named = components.filter(component => component.name === ref);
    if (named.length > 1) {
        throw refuse("invalid_args", `${named.length} components are called "${ref}".`, "Name the component by id (ui_surfaces).");
    }
    return named[0];
}

/**
 * A page or a component, from a ref that may name either - `ui_patch` takes one argument for both.
 * Pages win a name both share, since a page is what an agent edits far more often.
 */
export function resolveSurfaceOrComponent(
    document: UIDocument,
    ref: string,
): { kind: "surface"; surface: UISurface } | { kind: "component"; component: UIComponentDefinition } {
    const surface = resolveSurface(document, ref);
    if (surface) {
        return { kind: "surface", surface };
    }
    const component = resolveComponent(document, ref);
    if (component) {
        return { kind: "component", component };
    }
    throw refuse("not_found", `No page or component "${ref}".`, "Call ui_surfaces for the pages and components in this project.");
}

export function assetsService(ctx: WorkspaceContext): AssetsService {
    return ctx.services.get<AssetsService>(Services.Assets);
}

export const AGENT_ASSET_TYPES: readonly AssetType[] = [
    AssetType.Image,
    AssetType.Audio,
    AssetType.Video,
    AssetType.Font,
    AssetType.JSON,
    AssetType.Other,
    AssetType.Model,
];

/** Every asset of `types` (all of them by default), in no particular order. */
export function listAssets(ctx: WorkspaceContext, types: readonly AssetType[] = AGENT_ASSET_TYPES): Asset<AssetType, AssetSource>[] {
    const map = assetsService(ctx).getAssets();
    const out: Asset<AssetType, AssetSource>[] = [];
    for (const type of types) {
        out.push(...Object.values(map[type] ?? {}) as Asset<AssetType, AssetSource>[]);
    }
    return out;
}

/** The asset of `type` that `ref` names, by id or by name (with or without its extension). */
export function resolveAsset(ctx: WorkspaceContext, ref: string, type: AssetType): Asset<AssetType, AssetSource> {
    const pool = listAssets(ctx, [type]);
    const byId = pool.find(asset => asset.id === ref);
    if (byId) {
        return byId;
    }
    const named = assetsNamed(pool, ref);
    if (named.length > 1) {
        throw refuse("invalid_args", `${named.length} ${type} assets are called "${ref}".`, "Name the asset by id (assets_list).");
    }
    if (named.length === 0) {
        throw refuse("not_found", `No ${type} asset "${ref}".`, "Call assets_list, or import the file with assets_import first.");
    }
    return named[0];
}

export function stripExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * What follows a name's last dot when it is a file extension, else undefined.
 *
 * Only letters and digits, at most five, and at least one letter: `mp3`, `m4a`, `ogg`. A recording
 * named `316.5` or `316.5-2` (Ren'Py numbers takes that way) has a dot that is part of the name, and
 * cutting at it would make `voice_316.5-2` a `voice_316` with the extension `5-2`.
 */
export function fileExtensionOf(name: string): string | undefined {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) {
        return undefined;
    }
    const ext = name.slice(dot + 1);
    return /^(?=.*[a-z])[a-z0-9]{1,5}$/i.test(ext) ? ext : undefined;
}

/** `name` without its file extension (see {@link fileExtensionOf}); unchanged when it has none. */
export function withoutFileExtension(name: string): string {
    const ext = fileExtensionOf(name);
    return ext === undefined ? name : name.slice(0, name.length - ext.length - 1);
}

/**
 * The assets an agent's `ref` names by name, most literal reading first: the library names equal to
 * `ref` as written, dots and all; failing that, the names that are `ref` plus a file extension
 * (`bgm.ogg` for `bgm`); failing that, the names `ref` is with its extension dropped (`bgm` for
 * `bgm.ogg`). A later reading never joins an earlier one, so `voice_316.5` cannot be made ambiguous
 * by a `voice_316.5.ogg` beside it, nor `voice_316.5-2` lost by being read as `voice_316` + `.5-2`.
 */
export function assetsNamed<A extends { name: string }>(pool: readonly A[], ref: string): A[] {
    const exact = pool.filter(asset => asset.name === ref);
    if (exact.length > 0) {
        return exact;
    }
    const extended = pool.filter(asset => fileExtensionOf(asset.name) !== undefined && withoutFileExtension(asset.name) === ref);
    if (extended.length > 0) {
        return extended;
    }
    const bare = withoutFileExtension(ref);
    return bare === ref ? [] : pool.filter(asset => asset.name === bare);
}
