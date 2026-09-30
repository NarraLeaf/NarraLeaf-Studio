import {
    scanProjectStoryEntryPoints,
    startStoryNodeKey,
    type StartStoryTargetReading,
    type StoryEntryPointScan,
} from "@shared/story/storyReachability";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import type { PluginStoreReading } from "@shared/utils/pluginStorage";
import { getUIComponentLink, getUIComponentParams, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { listBuiltInPluginBlueprintNodes } from "@/lib/blueprint-cli/builtinPluginNodes";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { resolveEffectiveBlueprintCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/effectivePins";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { createAssetNameDescriber, type BlueprintNodeCatalogLike } from "./assetNameCatalog";
import {
    extractStoryVariableWrites,
    traceWrittenValues,
    type AssetNameNodeDescriber,
    type AssetNameNodeSite,
    type AssetNameOrigin,
    type ValuePinRef,
    type WrittenValueSource,
} from "./assetNameGaps";

/**
 * Which scenes a `Start Game` can begin at when its picker does not say - read from where the project
 * writes the value down.
 *
 * A recollection screen is the shape this exists for. Its `Start Game` takes the story and scene from
 * the row the player clicked, and the rows come from the Gallery's catalogue: so the node can begin at
 * exactly the scenes that catalogue lists, and nowhere else. Without this, every check that needs to
 * know where play begins - `story/unreachable-scene`, `reachable-endings`, `route-coverage` - had to
 * decline outright on every project made from the starter template, which has such a screen.
 *
 * **The rule is the asset rule's, asked for a different value.** A package carries every asset whose
 * name the project writes down, and refuses only a name put together while the game runs. Here: a
 * `Start Game` can begin at every scene whose id is written down where its value comes from, and a
 * scene id put together while the game runs cannot be read at all. The value is followed by the same
 * walk (`traceWrittenValues` in `assetNameGaps`), through the same carriers - variables, list rows,
 * function parameters, page props - so a path one question can follow the other can too.
 *
 * **Where a value was written down, it is read the way the build reads plugin data**: every id that
 * occurs in it, not a field anybody named. A catalogue's shape is its plugin's business, and the
 * scene ids it holds are exactly the ones that pair with a story's scenes. What that reading cannot
 * reach - a node whose data lives somewhere this does not look, the rows a Game UI list is handed by
 * the engine - is reported as unreadable, the same as a value put together: a claim about where play
 * begins that silently left an entry out is worse than no claim.
 */

/** Everything the reading follows a value through. */
export interface StartStoryTargetProject {
    stories: readonly { id: string; name: string; document: StoryDocument }[];
    blueprintDocument: BlueprintDocument | null | undefined;
    uiDocument: UIDocument | null | undefined;
    variableRegistry: readonly VariableRegistryEntry[];
    /**
     * Every store any plugin keeps in the project, or null when they were not read.
     *
     * Null and empty are different answers: a project whose Gallery has never been opened has no
     * catalogue, so its recollection screen can begin nowhere - while one whose stores nobody read
     * could begin anywhere the catalogue says.
     */
    pluginStores: readonly PluginStoreReading[] | null;
}

/** Why a `Start Game`'s target cannot be read, as the author can go and find it. */
export type StartStoryTargetGap =
    /** The value is put together while the game runs - the same answer the asset rule gives. */
    | { kind: "assembled"; origin: AssetNameOrigin }
    /** A node hands on data written somewhere this reading does not follow. */
    | { kind: "unreadNode"; site: AssetNameNodeSite }
    /** A plugin's stores in the project, which would not read. */
    | { kind: "unreadPluginData"; site: AssetNameNodeSite; pluginId: string }
    /** A Game UI list, whose rows the engine hands it. */
    | { kind: "engineRows"; elementId: string; elementName: string }
    /** A variable nothing in the project declares, so its starting value is unknown. */
    | { kind: "undeclaredVariable"; variableId: string }
    /** The node's own graph is not one the walk can see - a blueprint no owner resolves. */
    | { kind: "unindexed" }
    /**
     * The interface document was not read, and with it every list's rows and every component
     * placement - the two places a wired target most often comes from.
     */
    | { kind: "interfaceUnread" };

export type StartStoryTargetAnswer =
    | ({ kind: "read" } & StartStoryTargetReading)
    | { kind: "unreadable"; pin: StartStoryTargetPin; gap: StartStoryTargetGap };

/** The two pins that decide where a `Start Game` begins. */
export type StartStoryTargetPin = "storyId" | "sceneId";

const TARGET_PINS: readonly StartStoryTargetPin[] = ["storyId", "sceneId"];

/**
 * Nodes whose written value is what is stored on them. Every string among their params is a value
 * they can hand out; nothing else is.
 */
const STORED_VALUE_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
]);

/** Host node types all live under this prefix; anything else is a plugin's, named under its id. */
const HOST_NODE_TYPE_PREFIX = "blueprint.";

/**
 * What every `Start Game` in the project whose picker does not settle it can begin at, by node.
 *
 * Only nodes with a blank picker or a wired target are answered: the scan reads a picked target for
 * itself. A pin nothing is wired into is read from its picker even here, and a wired pin that
 * delivers an empty value falls back to it at run time (`resolveStartStoryTarget`), so the picked
 * value is always among the answers.
 */
export function readStartStoryTargets(
    project: StartStoryTargetProject,
    describer: AssetNameNodeDescriber = createStartStoryTargetDescriber(),
): Map<string, StartStoryTargetAnswer> {
    const nodes = listStartStoryNodes(project.blueprintDocument);
    const pins: ValuePinRef[] = nodes.flatMap(node => TARGET_PINS.map(pinId => ({ ...node.ref, pinId })));
    const traces = traceWrittenValues({
        blueprintDocument: project.blueprintDocument,
        uiDocument: project.uiDocument,
        storyWrites: project.stories.flatMap(story => extractStoryVariableWrites(story.document, story.name)),
    }, describer, pins);

    // Every string where a value was written down is a candidate, and a catalogue holds hundreds of
    // them - names, asset ids, its own entry ids. Only the ones that are a story or a scene can be a
    // target, so the answer keeps those alone, and the scan pairs a handful rather than a square of
    // everything a catalogue says.
    const storyIds = new Set(project.stories.map(story => story.id));
    const sceneIds = new Set(project.stories.flatMap(story => Object.keys(story.document.scenes ?? {})));
    const known: Record<StartStoryTargetPin, ReadonlySet<string>> = { storyId: storyIds, sceneId: sceneIds };

    const answers = new Map<string, StartStoryTargetAnswer>();
    nodes.forEach((node, index) => {
        const read: Record<StartStoryTargetPin, string[]> = { storyId: [], sceneId: [] };
        for (const [offset, pin] of TARGET_PINS.entries()) {
            const picked = typeof node.params[pin] === "string" ? (node.params[pin] as string).trim() : "";
            if (picked) {
                read[pin].push(picked);
            }
            if (!node.wired.has(pin)) {
                continue;
            }
            if (!project.uiDocument) {
                // The walk reads a project with no interface as one with no lists, and a list with no
                // rows hands on nothing - which here would be the claim that the node starts nothing.
                answers.set(node.key, { kind: "unreadable", pin, gap: { kind: "interfaceUnread" } });
                return;
            }
            const trace = traces[index * TARGET_PINS.length + offset];
            if (!trace) {
                answers.set(node.key, { kind: "unreadable", pin, gap: { kind: "unindexed" } });
                return;
            }
            if (trace.origin) {
                answers.set(node.key, { kind: "unreadable", pin, gap: { kind: "assembled", origin: trace.origin } });
                return;
            }
            for (const source of trace.written) {
                const values = readWrittenSource(source, project);
                if ("gap" in values) {
                    answers.set(node.key, { kind: "unreadable", pin, gap: values.gap });
                    return;
                }
                read[pin].push(...values.strings.filter(value => known[pin].has(value)));
            }
        }
        answers.set(node.key, { kind: "read", storyIds: [...new Set(read.storyId)], sceneIds: [...new Set(read.sceneId)] });
    });
    return answers;
}

/**
 * The project's entry points, with every `Start Game` the picker does not settle read from the
 * project, and why each one that still cannot be read cannot be.
 *
 * What the project check and the two integrity tests ask, so that the three of them agree about where
 * play begins. The build does not: see `scanStoryEntryPoints`.
 */
export function scanProjectEntryPoints(
    project: StartStoryTargetProject,
    describer?: AssetNameNodeDescriber,
): { scan: StoryEntryPointScan; gaps: Map<string, { pin: StartStoryTargetPin; gap: StartStoryTargetGap }> } {
    const answers = readStartStoryTargets(project, describer);
    const gaps = new Map<string, { pin: StartStoryTargetPin; gap: StartStoryTargetGap }>();
    const scan = scanProjectStoryEntryPoints(project.stories, project.blueprintDocument, node => {
        const key = startStoryNodeKey(node);
        const answer = answers.get(key);
        if (!answer) {
            gaps.set(key, { pin: "sceneId", gap: { kind: "unindexed" } });
            return null;
        }
        if (answer.kind === "unreadable") {
            gaps.set(key, { pin: answer.pin, gap: answer.gap });
            return null;
        }
        return answer;
    });
    return { scan, gaps };
}

/**
 * The node catalogue the reading describes nodes with: the one this Studio has loaded, and the
 * definitions of the plugins bundled with Studio for any it has not.
 *
 * The question is about the shipped game, which carries every plugin the project depends on whether
 * or not this Studio session has it switched on - and a session that runs a check from the command
 * line loads no plugins at all. The bundled plugins' definitions ship inside Studio, so what their
 * nodes hand out is known either way; a node from any other plugin that is not loaded stays unknown,
 * and unknown reads as put together.
 *
 * `live` is the catalogue a running Studio has, and a parameter only so a test can hand it one that
 * has not loaded a plugin.
 */
export function createStartStoryTargetDescriber(live?: BlueprintNodeCatalogLike): AssetNameNodeDescriber {
    registerCoreBlueprintNodes();
    return createAssetNameDescriber(withBundledPluginNodes(live ?? blueprintNodeRegistry));
}

let bundledPluginNodes: Map<string, BlueprintNodeDef> | null = null;

function withBundledPluginNodes(live: BlueprintNodeCatalogLike): BlueprintNodeCatalogLike {
    bundledPluginNodes ??= new Map(listBuiltInPluginBlueprintNodes().flatMap(({ defs }) => defs.map(def => [def.type, def] as const)));
    const bundled = bundledPluginNodes;
    const fallback = (type: string): BlueprintNodeDef | undefined => (live.get(type) ? undefined : bundled.get(type));
    return {
        get: type => live.get(type) ?? bundled.get(type),
        resolveCatalogEntry: type => {
            const def = fallback(type);
            return def ? resolveEffectiveBlueprintCatalogEntry(def) : live.resolveCatalogEntry(type);
        },
        resolveCatalogEntryForNode: (type, params) => {
            const def = fallback(type);
            return def ? resolveEffectiveBlueprintCatalogEntry(def, params) : live.resolveCatalogEntryForNode(type, params);
        },
    };
}

// ---------------------------------------------------------------------------
// The nodes
// ---------------------------------------------------------------------------

interface StartStoryNode {
    key: string;
    ref: Omit<ValuePinRef, "pinId">;
    params: Record<string, unknown>;
    wired: ReadonlySet<StartStoryTargetPin>;
}

/**
 * Every `Start Game` the scan would ask about: one whose picker leaves a target blank, or whose
 * target pin is wired.
 */
function listStartStoryNodes(document: BlueprintDocument | null | undefined): StartStoryNode[] {
    const found: StartStoryNode[] = [];
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        if (!blueprint) {
            continue;
        }
        const slots = [
            ...Object.entries(blueprint.graphs.events ?? {}).map(([graphId, slot]) => ({ graphKind: "event" as const, graphId, slot })),
            ...Object.entries(blueprint.graphs.functions ?? {}).map(([graphId, slot]) => ({ graphKind: "function" as const, graphId, slot })),
            ...Object.entries(blueprint.graphs.macros ?? {}).map(([graphId, slot]) => ({ graphKind: "macro" as const, graphId, slot })),
        ];
        for (const { graphKind, graphId, slot } of slots) {
            const graph = slot?.graph;
            for (const node of Object.values(graph?.nodes ?? {})) {
                if (!node || node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY) {
                    continue;
                }
                const wired = new Set(TARGET_PINS.filter(pin =>
                    (graph?.edges ?? []).some(edge => edge.to.nodeId === node.id && edge.to.port === pin)));
                const ref = { blueprintId: blueprint.id, graphKind, graphId, nodeId: node.id };
                found.push({ key: startStoryNodeKey(ref), ref, params: node.params ?? {}, wired });
            }
        }
    }
    return found;
}

// ---------------------------------------------------------------------------
// Reading where a value was written down
// ---------------------------------------------------------------------------

type SourceReading = { strings: string[] } | { gap: StartStoryTargetGap };

function readWrittenSource(source: WrittenValueSource, project: StartStoryTargetProject): SourceReading {
    switch (source.kind) {
        case "value":
            return { strings: collectStrings(source.value) };
        case "variableDefault": {
            const entry = project.variableRegistry.find(candidate =>
                candidate.scope === source.scope && (candidate.id === source.variableId || candidate.storageKey === source.variableId));
            // A story's scene variables, and anything declared only on a story row, are not in the
            // registry: their starting value is not something this reads.
            return entry ? { strings: collectStrings(entry.defaultValue) } : { gap: { kind: "undeclaredVariable", variableId: source.variableId } };
        }
        case "engineRows":
            return { gap: { kind: "engineRows", elementId: source.elementId, elementName: source.elementName } };
        case "node":
            return readWrittenNode(source, project);
    }
}

/** What a node that declares it hands out written data can hand out. */
function readWrittenNode(source: Extract<WrittenValueSource, { kind: "node" }>, project: StartStoryTargetProject): SourceReading {
    const type = source.site.nodeType;
    if (STORED_VALUE_NODE_TYPES.has(type)) {
        return { strings: collectStrings(storedParams(source.params)) };
    }
    if (type === BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM) {
        const componentId = source.owner.kind === "componentWidgetMain" ? source.owner.componentId : null;
        const paramId = typeof source.params.paramId === "string" ? source.params.paramId : "";
        return componentId ? { strings: componentParamValues(project.uiDocument, componentId, paramId) } : { gap: { kind: "unreadNode", site: source.site } };
    }
    if (!type.startsWith(HOST_NODE_TYPE_PREFIX)) {
        return readPluginData(source.site, project);
    }
    // A host node whose written data lives somewhere of its own - the localization table, the
    // ending rows, the character sheet. None of them is followed here, so none is guessed at.
    return { gap: { kind: "unreadNode", site: source.site } };
}

/**
 * A plugin node's written data: whatever that plugin keeps in the project.
 *
 * A plugin's runtime can read only what it publishes (`contributes.runtimeData`), which is a subset
 * of its stores on disk - so every store it has is a bound on what its nodes hand out, and one that
 * does not depend on whether this Studio has the plugin switched on. A plugin id is a prefix of each
 * node type it registers, which the host enforces when the plugin loads.
 */
function readPluginData(site: AssetNameNodeSite, project: StartStoryTargetProject): SourceReading {
    const stores = project.pluginStores;
    const owned = stores?.filter(store => site.nodeType.startsWith(`${store.pluginId}.`));
    if (!stores || owned?.some(store => "unreadable" in store)) {
        const pluginId = owned?.[0]?.pluginId ?? site.nodeType.slice(0, Math.max(0, site.nodeType.lastIndexOf(".")));
        return { gap: { kind: "unreadPluginData", site, pluginId } };
    }
    return { strings: (owned ?? []).flatMap(store => ("data" in store ? collectStrings(store.data) : [])) };
}

/**
 * Every value a component param can hold: the definition's default, and each placement's own.
 *
 * Placements anywhere - on a page, or inside another component's elements. The default counts even
 * when every placement overrides it, which costs a scene at most and never loses one.
 */
function componentParamValues(ui: UIDocument | null | undefined, componentId: string, paramId: string): string[] {
    const component = ui?.components?.find(candidate => candidate.id === componentId);
    const values: string[] = [];
    const declared = getUIComponentParams(component).find(param => param.id === paramId);
    if (declared?.defaultValue) {
        values.push(declared.defaultValue.trim());
    }
    const pools: Record<string, UIElement>[] = [ui?.elements ?? {}, ...(ui?.components ?? []).map(entry => entry.elements ?? {})];
    for (const pool of pools) {
        for (const element of Object.values(pool)) {
            const link = getUIComponentLink(element);
            const supplied = link?.componentId === componentId ? link.params?.[paramId] : undefined;
            if (supplied?.trim()) {
                values.push(supplied.trim());
            }
        }
    }
    return values;
}

/** A node's stored values: its params, without the editor's own bookkeeping (`__`-prefixed). */
function storedParams(params: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith("__")));
}

/** Every string in a value, however deep - the same reading the build takes of plugin data. */
function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
    if (depth > 64) {
        return out;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
            out.push(trimmed);
        }
    } else if (Array.isArray(value)) {
        for (const item of value) {
            collectStrings(item, out, depth + 1);
        }
    } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
            collectStrings(item, out, depth + 1);
        }
    }
    return out;
}
