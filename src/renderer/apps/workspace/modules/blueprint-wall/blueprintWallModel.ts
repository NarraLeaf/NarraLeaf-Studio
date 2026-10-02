import { GLOBAL_MAIN_OWNER_KEY, decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { listBlueprintFunctionIds } from "@shared/blueprint/blueprintEventOrder";
import { listBlueprintLayers } from "@shared/blueprint/blueprintLayers";
import { DEFAULT_UI_ROOT_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { StoryDocument, StoryId, StorySceneId } from "@shared/types/story/document";
import { listSceneIdsInDocumentOrder } from "@shared/types/story/order";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { ownerLabelKey } from "@shared/types/ui-editor/ownerLabels";
import { getStageSlotLabel } from "@/lib/ui-editor/stageSlotLabel";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { getComponentEditorSurfaceId } from "../ui-editor/editors/componentEditorAdapter";

/**
 * What the Blueprint Overview draws: every blueprint in the project that holds something, grouped by
 * where it lives - the project's own logic, then each page, each Game UI, each component, each
 * story.
 *
 * Pure, so the grouping rules can be tested without a workspace. The tab feeds it the two documents
 * and the stories it has loaded, and re-runs it whenever any of them changes.
 */

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

export type BlueprintWallGroupKind = "project" | "page" | "gameUi" | "component" | "story";

export type BlueprintWallTile = {
    /** Stable across rebuilds: the owner slot, which is what the tile stands for. */
    key: string;
    blueprintId: string;
    ownerKind: BlueprintOwnerRef["kind"];
    /** What the blueprint is attached to: a control, a page, a scene. */
    title: string;
    /** What kind of logic it is, in the words the inspector uses. */
    kindLabel: string;
    nodeCount: number;
    /** Layers and functions together: every graph or script the editor lists for it. */
    graphCount: number;
    scriptCount: number;
    /** Where clicking the tile goes, addressed the way every other entry into the blueprint is. */
    target: BlueprintEditorOpenTarget;
};

export type BlueprintWallGroup = {
    key: string;
    kind: BlueprintWallGroupKind;
    title: string;
    /** What the group is: "Page", "Game UI · Dialog", "Component", "Story". */
    caption: string;
    tiles: BlueprintWallTile[];
};

export type BlueprintWallStory = {
    id: StoryId;
    name: string;
    /** Absent while the story is not in memory; its blueprints are then not listed. */
    document?: StoryDocument;
};

export type BlueprintWallInput = {
    blueprints: BlueprintDocument;
    ui: UIDocument | null;
    stories: readonly BlueprintWallStory[];
    t: Translate;
};

/** The names Studio gives a story blueprint it creates; anything else is a name the author chose. */
const DEFAULT_STORY_BLUEPRINT_NAMES = new Set(["Story Action", "Story Value", "Story Condition"]);

type BlueprintContent = { nodeCount: number; graphCount: number; scriptCount: number };

/** What a blueprint holds. A blueprint with none of it is a slot nothing has been written into. */
export function measureBlueprint(blueprint: Blueprint): BlueprintContent {
    let nodeCount = 0;
    let graphCount = 0;
    let scriptCount = 0;
    for (const { layer } of listBlueprintLayers(blueprint.graphs)) {
        graphCount += 1;
        if (layer.script) {
            scriptCount += 1;
        }
        nodeCount += Object.keys(layer.graph?.nodes ?? {}).length;
    }
    for (const functionId of listBlueprintFunctionIds(blueprint.graphs)) {
        const fn = blueprint.graphs.functions?.[functionId];
        if (!fn) {
            continue;
        }
        graphCount += 1;
        nodeCount += Object.keys(fn.graph?.nodes ?? {}).length;
    }
    return { nodeCount, graphCount, scriptCount };
}

function holdsSomething(content: BlueprintContent): boolean {
    return content.nodeCount > 0 || content.scriptCount > 0;
}

/** As the layer outline names a control, so the two read the same. */
function elementName(element: UIElement): string {
    return element.type === "nl.root" ? DEFAULT_UI_ROOT_NAME : element.name ?? element.type;
}

/** Depth-first from each root, so a group's tiles follow the layer outline from top to bottom. */
function treeOrder(roots: readonly string[], elements: Record<string, UIElement>): Map<string, number> {
    const order = new Map<string, number>();
    const stack = [...roots].reverse();
    while (stack.length > 0) {
        const id = stack.pop()!;
        const element = elements[id];
        if (!element || order.has(id)) {
            continue;
        }
        order.set(id, order.size);
        for (let index = element.childrenIds.length - 1; index >= 0; index -= 1) {
            stack.push(element.childrenIds[index]);
        }
    }
    return order;
}

function surfaceRoots(surface: UISurface): string[] {
    const roots = [surface.rootElementId];
    if (surface.kind === "stageSurface") {
        for (const slot of Object.values(surface.slots ?? {})) {
            if (slot.rootElementId) {
                roots.push(slot.rootElementId);
            }
        }
    }
    return roots;
}

/** Every blueprint each story names, mapped to the scene that names it first. */
function storyBlueprintScenes(stories: readonly BlueprintWallStory[]): Map<string, { story: BlueprintWallStory; sceneId: StorySceneId; sceneName: string; order: number }> {
    const found = new Map<string, { story: BlueprintWallStory; sceneId: StorySceneId; sceneName: string; order: number }>();
    let order = 0;
    for (const story of stories) {
        const document = story.document;
        if (!document) {
            continue;
        }
        for (const sceneId of listSceneIdsInDocumentOrder(document)) {
            const scene = document.scenes[sceneId];
            if (!scene) {
                continue;
            }
            // A row names a blueprint in four shapes (an action, an interpolation, a condition, an
            // expression call) and all four spell it `blueprintId`, so one walk finds them all.
            const visit = (value: unknown): void => {
                if (Array.isArray(value)) {
                    value.forEach(visit);
                    return;
                }
                if (!value || typeof value !== "object") {
                    return;
                }
                for (const [key, child] of Object.entries(value)) {
                    if (key === "blueprintId" && typeof child === "string") {
                        if (!found.has(child)) {
                            found.set(child, { story, sceneId, sceneName: scene.name, order: order++ });
                        }
                    } else {
                        visit(child);
                    }
                }
            };
            visit(scene);
        }
    }
    return found;
}

export function buildBlueprintWall({ blueprints, ui, stories, t }: BlueprintWallInput): BlueprintWallGroup[] {
    const surfaces = ui?.surfaces ?? [];
    const components = ui?.components ?? [];
    const elements = ui?.elements ?? {};

    const project: BlueprintWallGroup = {
        key: "project",
        kind: "project",
        title: t("blueprint.overview.group.project"),
        caption: t("uiEditor.panel.globalSubtitle"),
        tiles: [],
    };
    const surfaceGroups = new Map<string, { group: BlueprintWallGroup; order: Map<string, number> }>();
    for (const surface of surfaces) {
        const isPage = surface.kind === "appSurface";
        surfaceGroups.set(surface.id, {
            group: {
                key: `surface:${surface.id}`,
                kind: isPage ? "page" : "gameUi",
                title: surface.name,
                caption: isPage
                    ? t(surface.id === MAIN_APP_SURFACE_ID ? "uiEditor.surfaceKind.mainPage" : "uiEditor.surfaceKind.page")
                    : `${t("uiEditor.surfaceKind.gameUi")} · ${getStageSlotLabel(surface.mount.slotId, t)}`,
                tiles: [],
            },
            order: treeOrder(surfaceRoots(surface), elements),
        });
    }
    const componentGroups = new Map<string, { group: BlueprintWallGroup; order: Map<string, number> }>();
    for (const component of components) {
        componentGroups.set(component.id, {
            group: {
                key: `component:${component.id}`,
                kind: "component",
                title: component.name,
                caption: t("blueprint.overview.group.componentCaption"),
                tiles: [],
            },
            order: treeOrder([component.rootElementId], component.elements),
        });
    }
    const storyScenes = storyBlueprintScenes(stories);
    const storyGroups = new Map<StoryId, BlueprintWallGroup>();

    // Sort keys sit beside the tiles until the end: a tile's place depends on the outline, which the
    // owner records know nothing about.
    const rank = new Map<string, number>();

    for (const [ownerKey, record] of Object.entries(blueprints.ownerRecords)) {
        const blueprint = blueprints.blueprints[record.blueprintId];
        const owner = decodeBlueprintOwnerKey(ownerKey);
        if (!blueprint || !owner) {
            continue;
        }
        const content = measureBlueprint(blueprint);
        // App logic is always shown: it is the one slot every project has, and the place an author
        // looks first for logic that is not tied to a page.
        if (owner.kind !== "globalMain" && !holdsSomething(content)) {
            continue;
        }
        const kindLabel = t(ownerLabelKey(owner.kind));
        const base = { key: ownerKey, blueprintId: blueprint.id, ownerKind: owner.kind, kindLabel, ...content };

        switch (owner.kind) {
            case "globalMain": {
                project.tiles.push({
                    ...base,
                    title: kindLabel,
                    target: {
                        blueprintId: blueprint.id,
                        ownerKind: "globalMain",
                        surfaceId: GLOBAL_MAIN_OWNER_KEY,
                        title: kindLabel,
                    },
                });
                rank.set(ownerKey, 0);
                break;
            }
            case "surfaceMain": {
                const entry = surfaceGroups.get(owner.surfaceId);
                const surface = surfaces.find(candidate => candidate.id === owner.surfaceId);
                if (!entry || !surface) {
                    break;
                }
                const logic = surface.kind === "stageSurface"
                    ? t("properties.blueprintEntry.gameUiLogic")
                    : t("properties.blueprintEntry.pageLogic");
                entry.group.tiles.push({
                    ...base,
                    title: logic,
                    kindLabel: logic,
                    target: {
                        blueprintId: blueprint.id,
                        ownerKind: "surfaceMain",
                        surfaceId: surface.id,
                        title: t("properties.blueprintEntry.title", {
                            logic,
                            name: surface.name || t("properties.blueprintEntry.interfaceFallback"),
                        }),
                    },
                });
                rank.set(ownerKey, -1);
                break;
            }
            case "widgetMain":
            case "widgetValue": {
                const entry = surfaceGroups.get(owner.surfaceId);
                const element = elements[owner.elementId];
                // A control that is gone runs nothing, and there is nowhere to open its logic from.
                if (!entry || !element || !entry.order.has(element.id)) {
                    break;
                }
                const name = elementName(element);
                const isValue = owner.kind === "widgetValue";
                entry.group.tiles.push({
                    ...base,
                    title: name,
                    target: {
                        blueprintId: blueprint.id,
                        ownerKind: owner.kind,
                        surfaceId: owner.surfaceId,
                        elementId: element.id,
                        propPath: isValue ? owner.propPath : undefined,
                        focusEventId: isValue ? "init" : undefined,
                        title: `${kindLabel} - ${name}`,
                    },
                });
                // A control's value logic sits right after its own logic.
                rank.set(ownerKey, (entry.order.get(element.id) ?? 0) * 2 + (isValue ? 1 : 0));
                break;
            }
            case "componentWidgetMain": {
                const entry = componentGroups.get(owner.componentId);
                const component = components.find(candidate => candidate.id === owner.componentId);
                const element = component?.elements[owner.elementId];
                if (!entry || !element) {
                    break;
                }
                const name = elementName(element);
                entry.group.tiles.push({
                    ...base,
                    title: name,
                    target: {
                        blueprintId: blueprint.id,
                        ownerKind: "componentWidgetMain",
                        surfaceId: getComponentEditorSurfaceId(owner.componentId),
                        componentId: owner.componentId,
                        elementId: element.id,
                        title: `${kindLabel} - ${name}`,
                    },
                });
                rank.set(ownerKey, entry.order.get(element.id) ?? 0);
                break;
            }
            case "storyAction": {
                // Listed only when a row names it: a story blueprint whose row was deleted is still
                // stored, but nothing runs it and no row leads back to it.
                const place = storyScenes.get(blueprint.id);
                if (!place) {
                    break;
                }
                let group = storyGroups.get(place.story.id);
                if (!group) {
                    group = {
                        key: `story:${place.story.id}`,
                        kind: "story",
                        title: place.story.name,
                        caption: t("blueprint.overview.group.storyCaption"),
                        tiles: [],
                    };
                    storyGroups.set(place.story.id, group);
                }
                const named = blueprint.name && !DEFAULT_STORY_BLUEPRINT_NAMES.has(blueprint.name);
                const title = named ? blueprint.name : place.sceneName;
                group.tiles.push({
                    ...base,
                    title,
                    kindLabel: named ? `${kindLabel} · ${place.sceneName}` : kindLabel,
                    target: {
                        blueprintId: blueprint.id,
                        ownerKind: "storyAction",
                        title: `${kindLabel} - ${title}`,
                    },
                });
                rank.set(ownerKey, place.order);
                break;
            }
            default: {
                const unreachable: never = owner;
                return unreachable;
            }
        }
    }

    const sorted = (group: BlueprintWallGroup): BlueprintWallGroup => ({
        ...group,
        tiles: [...group.tiles].sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0)),
    });

    // Pages before Game UIs, each in the order the interface panel lists them. Components and
    // stories appear only when they hold logic: a page is where an author goes looking, so an empty
    // one is still worth seeing as empty, while a list of every component would mostly say "none".
    const pages = surfaces.filter(surface => surface.kind === "appSurface");
    const gameUis = surfaces.filter(surface => surface.kind === "stageSurface");
    const ordered = [
        project,
        ...[...pages, ...gameUis].map(surface => surfaceGroups.get(surface.id)!.group),
        ...components.map(component => componentGroups.get(component.id)!.group).filter(group => group.tiles.length > 0),
        ...stories.map(story => storyGroups.get(story.id)).filter((group): group is BlueprintWallGroup => Boolean(group)),
    ];
    return ordered.map(sorted);
}

/** How many tiles the wall holds, for the header. */
export function countBlueprintWallTiles(groups: readonly BlueprintWallGroup[]): number {
    return groups.reduce((sum, group) => sum + group.tiles.length, 0);
}

/**
 * The groups and tiles a search leaves, by the words the wall itself shows: page and component
 * names, control names, and the kind of logic. Node contents are the project search's job.
 *
 * Every word has to appear somewhere in a tile's own text or its group's, so "title start" finds the
 * Start control on the Title page. A group whose own name or caption matches keeps all of its tiles,
 * and keeps showing that it has none - searching a page's name is asking what that page holds.
 */
export function filterBlueprintWall(groups: readonly BlueprintWallGroup[], query: string): BlueprintWallGroup[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        return [...groups];
    }
    const matches = (text: string) => terms.every(term => text.includes(term));
    return groups.flatMap(group => {
        const groupText = `${group.title} ${group.caption}`.toLocaleLowerCase();
        if (matches(groupText)) {
            return [group];
        }
        const tiles = group.tiles.filter(tile =>
            matches(`${groupText} ${tile.title} ${tile.kindLabel}`.toLocaleLowerCase()));
        return tiles.length > 0 ? [{ ...group, tiles }] : [];
    });
}
