import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphEdge,
    BlueprintGraphIr,
    BlueprintGraphNode,
    BlueprintOwnerRef,
} from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_LAYER_WAIT,
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
    BLUEPRINT_NODE_TYPE_SCENE_GET,
    BLUEPRINT_NODE_TYPE_SCENE_SET,
} from "@shared/types/blueprint/graph";
import type { BlueprintAssetPinKind, BlueprintAssetPinRef } from "@shared/types/blueprint/valueTypes";
import { hasScriptLayer } from "@shared/blueprint/blueprintLayers";
import { anchorElementId, anchorSurfaceId } from "@shared/blueprint/ownerShape";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import { findOwningListItemTemplate } from "@shared/types/ui-editor/listItemContext";
import type { StoryDocument, StoryExpr, StoryVariableRef } from "@shared/types/story";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "@shared/types/story";
import type { BlueprintAssetNameFlow } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    getEffectiveBlueprintVariableRecord,
    parseBlueprintVariableRef,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { collectExecReachableNodeIds, findBlueprintFnByRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { mergeBlueprintAssetPins, type BlueprintAssetPin, type BlueprintAssetPinResolver } from "./assetNameCatalog";

/**
 * Where an asset is picked by a name the project does not write down - the one construct the
 * package's asset sweep cannot see.
 *
 * **The rule.** A game package carries every library asset whose name is written down somewhere in
 * the project: the build sweeps the bytes it ships - the story, the graphs, the interface, the data
 * plugins publish - for asset ids, and carries each one it finds (`collectReferencedAssetIds`). The
 * only names it cannot carry are the ones assembled while the game runs - a Concat, a Format, what
 * the player typed, what a server sent. A picture, a clip or a typeface picked by such a name is
 * missing from the package, and what should show it shows nothing.
 *
 * This module is the single judgement of which uses are that shape. The reference index, the graph
 * validator (and with it the canvas and `blueprint check`), the project check, the build and the
 * delete guard all read its answer and none decide it for themselves: a use the canvas passed and
 * the build refused is how an author learns the rule after five steps of the build wizard.
 *
 * ## How a value is followed
 *
 * Every value is a **slot**: a node's output, the value arriving at a node's input, or a *carrier* a
 * value is kept in between runs - a variable, a list's rows, a function's parameter, a page's
 * props. A slot is fed by other slots, by values written in the project (clean), or by a node that
 * assembles a string (an origin). A slot is assembled when any origin can reach it; that is a small
 * fixed point over the whole project, because carriers are written in one graph and read in another
 * and a story row can write a variable a graph reads.
 *
 * Nodes say for themselves what their outputs are (`BlueprintNodeDeclaration.assetNames`): they
 * forward their inputs, hand out something written in the project, or assemble. The carriers are
 * this file's to know, node by node, because a node's declaration cannot say which list or which
 * variable it reads.
 *
 * **The bar only moves the safe way.** A node that declares nothing assembles. A carrier this walk
 * cannot identify - a variable named by a wired value, a list reached through something other than
 * an element reference, rows kept in page state a script writes - counts as assembled too. What is
 * given up is precision rather than safety: a list's rows are one value, so a row whose label was
 * put together taints the picture beside it.
 *
 * The sinks are every input pin a node declares as carrying an asset (`assetRef`), Play Sound's
 * wired clip included, and every value binding on a widget property that draws an asset.
 *
 * ## The same walk, asked for values
 *
 * Every path that ends at no origin ends somewhere a value was written down, and the walk records
 * where ({@link WrittenValueSource}). The asset judgement ignores those ends; {@link traceWrittenValues}
 * collects them, for a question that needs the value itself - which scenes a `Start Game` fed from a
 * list row can begin at.
 */

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** A node, named the way its canvas names it. */
export interface AssetNameNodeSite {
    blueprintId: string;
    blueprintName: string;
    /** Stable owner key, as `ownerRecords` spells it - what the editor navigates by. */
    ownerKey: string;
    graphKind: "event" | "function" | "macro";
    graphId: string;
    nodeId: string;
    nodeType: string;
    /**
     * The catalogue's English title for the node. Localized where it is shown, by the same map the
     * canvas draws the card with, so the sentence and the card name the node the same way.
     */
    nodeTitle: string;
}

/** Where an asset name is used. */
export type AssetNameSink =
    /** An input pin that declares it carries an asset. */
    | (AssetNameNodeSite & {
        kind: "pin";
        pinId: string;
        /** The catalogue's English label for the pin, localized where it is shown. */
        pinLabel: string;
    })
    /** A widget property that draws an asset, bound to a value rather than picked. */
    | {
        kind: "binding";
        elementId: string;
        /** The widget's own name, or its type when it has none. */
        elementName: string;
        propPath: string;
        /** The page the widget is on; null inside a component definition. */
        surfaceId: string | null;
        surfaceName: string | null;
        /** The component definition the widget is in; null on a page. */
        componentName: string | null;
        /** The value blueprint the binding reads, when it reads one rather than a row field. */
        blueprintId: string | null;
        ownerKey: string | null;
    };

/** Where the name that reaches a sink is put together. */
export type AssetNameOrigin =
    /** A node that assembles a string, or one whose value this walk cannot follow. */
    | (AssetNameNodeSite & { kind: "node" })
    /** A story row whose `/set` computes the value it writes. */
    | {
        kind: "storyRow";
        storyId: string;
        storyName: string;
        sceneId: string;
        sceneName: string;
        blockId: string;
    }
    /** A list whose rows come from page or project state, which only a script writes. */
    | { kind: "listSource"; elementId: string; elementName: string }
    /** A blueprint's script layer, which may write any variable its blueprint can reach. */
    | { kind: "script"; blueprintId: string; blueprintName: string };

export interface AssetNameGap {
    /** What the sink draws or plays, which decides which part of the library the gap casts doubt on. */
    assetKind: BlueprintAssetPinKind;
    sink: AssetNameSink;
    origin: AssetNameOrigin;
}

/**
 * Where a value that is not put together was written down: the other end of every path the walk
 * follows that does not end at an origin.
 *
 * The asset judgement needs only to know such a place exists - the package carries whatever it
 * names - so it reads none of these. A caller that needs the value itself (which scene a `Start
 * Game` fed from a list row can begin at) reads each one; see {@link traceWrittenValues}.
 */
export type WrittenValueSource =
    /**
     * A value the walk already holds: typed on a node's unwired input, a local variable's declared
     * default, the rows an author wrote on a list, a literal a story row writes.
     */
    | { kind: "value"; value: unknown }
    /**
     * A node that declares it hands out data written in the project (`assetNames: "written"`)
     * without saying where: its own stored value for a literal, a component instance's param, what
     * a plugin publishes into the game.
     */
    | {
        kind: "node";
        site: AssetNameNodeSite;
        owner: BlueprintOwnerRef;
        params: Record<string, unknown>;
    }
    /** A project variable's declared default, which lives in the variable registry. */
    | { kind: "variableDefault"; scope: StoryVariableRef["scope"]; variableId: string }
    /** The rows a Game UI list is handed by the engine - choice options, notifications, lines. */
    | { kind: "engineRows"; elementId: string; elementName: string };

// ---------------------------------------------------------------------------
// What the judgement reads
// ---------------------------------------------------------------------------

/** A node instance's pins, as far as following a value needs them. */
export interface AssetNameNodeInfo {
    /** The node's declaration; absent reads as `"assembled"`. */
    flow?: BlueprintAssetNameFlow;
    /** Every pin this instance has, dynamic pins included. */
    pins: ReadonlyArray<{
        id: string;
        kind: "input" | "output";
        semantic: string;
        valueType?: string;
        assetRef?: BlueprintAssetPinRef;
        assetName?: BlueprintAssetNameFlow;
    }>;
}

/** What the judgement needs to know about a node type, read off the node catalogue. */
export interface AssetNameNodeDescriber {
    assetPins: BlueprintAssetPinResolver;
    /** English title, as the catalogue declares it; the type itself when the catalogue has none. */
    title(nodeType: string): string;
    /** English label of one pin, as the catalogue declares it; the pin id when it has none. */
    pinLabel(nodeType: string, pinId: string): string;
    /** The node as this instance has it, or null when the catalogue has never heard of the type. */
    node(nodeType: string, params?: Record<string, unknown>): AssetNameNodeInfo | null;
}

/** What one story row writes into a variable, reduced to where the value comes from. */
export interface StoryVariableWrite {
    target: StoryVariableRef;
    /** The variables the value is read from; empty when it is written in the row. */
    reads: readonly StoryVariableRef[];
    /**
     * The literals the row writes, or can pass on: the whole value of `/set x 5`, both arms of a
     * `? :`. Absent reads as none.
     */
    values?: readonly unknown[];
    /** Set when the row computes the value, which makes the row itself the origin. */
    computed?: Extract<AssetNameOrigin, { kind: "storyRow" }>;
}

/** Everything in the project the judgement follows a value through. */
export interface AssetNameProject {
    blueprintDocument: BlueprintDocument | null | undefined;
    /** Absent reads as a project with no interface: no lists, no bindings. */
    uiDocument?: UIDocument | null;
    /** Every `/set` in every story; see {@link extractStoryVariableWrites}. */
    storyWrites?: readonly StoryVariableWrite[];
}

// ---------------------------------------------------------------------------
// Pin-level helpers shared with the reference walk
// ---------------------------------------------------------------------------

/**
 * Literal nodes whose stored value is the asset, and which say nothing about that in their type.
 *
 * These are the legacy shape: before an asset pin could be picked on the node itself, an author
 * wired a JSON or String literal into it. The value is read only when the edge lands on a pin that
 * *declares* it carries an asset — never by scanning literals for id-shaped strings.
 */
export const GENERIC_LITERAL_NODE_TYPES: ReadonlySet<string> = new Set<string>([
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LITERAL,
]);

/**
 * How the value on one edge into an asset pin is read by the reference walk.
 *
 * - `declared`: the source pin says what it carries - either the asset it stores, which its own node
 *   already names, or one the host resolves at run time that cannot be a library asset.
 * - `literal`: a literal node, whose stored value is the asset.
 * - `computed`: anything else - not a reference the walk can read. Whether it is a gap is
 *   {@link findAssetNameGaps}'s answer, not this one's.
 */
export type AssetPinSourceJudgement =
    | { kind: "declared" }
    | { kind: "literal"; value: unknown }
    | { kind: "computed" };

export function judgeAssetPinSource(
    source: Pick<BlueprintGraphNode, "type" | "params">,
    sourcePort: string,
    assetPinsFor: (nodeType: string) => readonly BlueprintAssetPin[],
): AssetPinSourceJudgement {
    if (assetPinsFor(source.type).some(pin => pin.pinId === sourcePort)) {
        return { kind: "declared" };
    }
    if (GENERIC_LITERAL_NODE_TYPES.has(source.type)) {
        return { kind: "literal", value: source.params?.value };
    }
    return { kind: "computed" };
}

/**
 * Separator inside every key this module builds. It is a character no id can contain, so two
 * different tuples cannot collide into one key.
 */
const KEY_SEPARATOR = "\u0000";

/**
 * Key for "which edges land on this pin".
 *
 * The separator is a character no id can contain, so two different (node, pin) pairs cannot collide
 * into one bucket and hand a node an edge that belongs to its neighbour.
 */
export function incomingEdgeKey(nodeId: string, pinId: string): string {
    return `${nodeId}${KEY_SEPARATOR}${pinId}`;
}

/** Edges grouped by the pin they land on. */
export function groupIncomingEdges(ir: BlueprintGraphIr | undefined): Map<string, BlueprintGraphEdge[]> {
    const incoming = new Map<string, BlueprintGraphEdge[]>();
    for (const edge of ir?.edges ?? []) {
        const key = incomingEdgeKey(edge.to.nodeId, edge.to.port);
        const bucket = incoming.get(key);
        if (bucket) {
            bucket.push(edge);
        } else {
            incoming.set(key, [edge]);
        }
    }
    return incoming;
}

/** A memoized asset-pin lookup, merged onto the catalogue-free floor. */
export function createAssetPinLookup(resolve: BlueprintAssetPinResolver | undefined): (nodeType: string) => readonly BlueprintAssetPin[] {
    const cache = new Map<string, readonly BlueprintAssetPin[]>();
    return nodeType => {
        const cached = cache.get(nodeType);
        if (cached) {
            return cached;
        }
        const merged = mergeBlueprintAssetPins(nodeType, resolve?.(nodeType) ?? null);
        cache.set(nodeType, merged);
        return merged;
    };
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/**
 * Where the value a story expression produces comes from.
 *
 * A literal is written in the row, and a variable is followed to whatever writes it. A choice
 * between the two (`a ? b : c`) and an item of a list literal pass their parts on, and so does an
 * index into a collection. Everything else - arithmetic, string building, a call, a blueprint's
 * value - puts something new together, and a name out of it is assembled.
 */
function readStoryExpression(expr: StoryExpr, reads: StoryVariableRef[], values: unknown[]): boolean {
    switch (expr.kind) {
        case "literal":
            values.push(expr.value);
            return true;
        case "var":
            reads.push(expr.target);
            return true;
        case "ternary":
            return readStoryExpression(expr.consequent, reads, values) && readStoryExpression(expr.alternate, reads, values);
        case "array":
            return expr.items.every(item => readStoryExpression(item, reads, values));
        case "index":
            return readStoryExpression(expr.target, reads, values);
        default:
            return false;
    }
}

/**
 * Every variable write one story makes, reduced to where the written value comes from.
 *
 * Only rows can write: a declaration's default is written in the project and so contributes nothing
 * a variable could be tainted by. Stories never put a variable into an asset slot themselves, so
 * this is the whole of what they add to the judgement. The literals a row writes ride along for
 * {@link traceWrittenValues}, which needs the value and not only whether it was put together.
 */
export function extractStoryVariableWrites(document: StoryDocument, storyName: string): StoryVariableWrite[] {
    const writes: StoryVariableWrite[] = [];
    for (const scene of listScenesInDocumentOrder(document)) {
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
            if (block.kind !== "action" || block.payload.action !== "setVariable") {
                continue;
            }
            const payload = block.payload;
            const reads: StoryVariableRef[] = [];
            const values: unknown[] = [];
            let passesOn = true;
            if (payload.expression) {
                passesOn = readStoryExpression(payload.expression.ast, reads, values);
            } else {
                // With no expression the row writes its literal, which is `value`; with one, `value`
                // is only the last literal the row held and never reaches the game.
                values.push(payload.value);
            }
            writes.push({
                target: payload.target,
                reads,
                ...(values.length > 0 ? { values } : {}),
                ...(passesOn
                    ? {}
                    : {
                        computed: {
                            kind: "storyRow" as const,
                            storyId: document.id,
                            storyName,
                            sceneId: scene.id,
                            sceneName: scene.name,
                            blockId: block.id,
                        },
                    }),
            });
        }
    }
    return writes;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * Pin types that cannot hold a string, so nothing that reaches an asset pin through them is a name.
 * Handles are opaque tokens the host issues; an element pin carries an element reference.
 */
const INERT_VALUE_TYPES: ReadonlySet<string> = new Set([
    "boolean", "integer", "float", "number", "Vector2D", "Rect", "RGBAColor", "Timer", "AnimationToken",
    "SoundHandle",
]);

function isInertValueType(valueType: string | undefined): boolean {
    return valueType !== undefined
        && (INERT_VALUE_TYPES.has(valueType) || valueType === "element" || valueType.startsWith("element:"));
}

/**
 * Nodes that read a carrier, and so are followed by this walk rather than by their declaration.
 *
 * A declaration can say "my outputs are my inputs"; it cannot say which variable or which list's rows
 * the node reads. Exported so the catalogue test can count these as classified.
 */
export const ASSET_NAME_CARRIER_READER_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SCENE_GET,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    "blueprint.frameWidget.getParams",
    "blueprint.element.frame.getParams",
    BLUEPRINT_NODE_TYPE_LAYER_WAIT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
]);

/** List readers that read the row a list is drawing. */
const ROW_SCOPE_READERS: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
]);

/** List readers that read the list whose own graph they are in. */
const SELF_LIST_READERS: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
]);

/** List readers that read the list wired into their `list` pin. */
const ELEMENT_LIST_READERS: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
]);

/** Heads that hand the graph one row of the list whose graph it is. */
const ROW_EVENT_HEADS: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
]);

/** List writers that write the list whose own graph they are in, from every data input. */
const SELF_LIST_WRITERS: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
]);

/** List writers that write the list wired into their `list` pin, from every data input. */
const ELEMENT_LIST_WRITERS: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM,
]);

/**
 * Writers of the carriers that have one reader and many writers, keyed by the carrier. Every data
 * input the writer has goes into it - over-reach on purpose: a Save Game's slot name is not its
 * metadata, but telling them apart is precision this does not need.
 */
const CARRIER_WRITERS: ReadonlyMap<string, string> = new Map([
    [BLUEPRINT_NODE_TYPE_BROADCAST_SEND, "broadcast"],
    [BLUEPRINT_NODE_TYPE_FRAME_EMIT, "frameEvent"],
    [BLUEPRINT_NODE_TYPE_PAGE_GO, "pageProps"],
    [BLUEPRINT_NODE_TYPE_LAYER_SHOW, "pageProps"],
    [BLUEPRINT_NODE_TYPE_LAYER_CONFIRM, "pageProps"],
    [BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE, "pageProps"],
    [BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE, "pageProps"],
    ["blueprint.frameWidget.setParams", "frameParams"],
    ["blueprint.element.frame.setParams", "frameParams"],
    [BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF, "layerResult"],
    [BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE, "saveMetadata"],
]);

/** The carrier each single-carrier reader reads. */
const CARRIER_READS: ReadonlyMap<string, string> = new Map([
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, "broadcast"],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST, "broadcast"],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT, "frameEvent"],
    [BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS, "pageProps"],
    [BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM, "frameParams"],
    ["blueprint.frameWidget.getParams", "frameParams"],
    ["blueprint.element.frame.getParams", "frameParams"],
    [BLUEPRINT_NODE_TYPE_LAYER_WAIT, "layerResult"],
    [BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA, "saveMetadata"],
]);

/**
 * Widget properties that draw an asset and can be bound to a value, with what they draw.
 *
 * The bindable-value table (`BlueprintValueRuntimeStore`) has one: the picture of an image. A
 * property added there that draws an asset has to be added here, or a binding on it goes unchecked.
 */
export const ASSET_BINDING_PROPS: Readonly<Record<string, BlueprintAssetPinKind>> = {
    "imageFill.assetId": "image",
};

/**
 * The one list whose rows only the project writes. Every other list-like widget extends it for a
 * Game UI slot - choices, notifications, lines - and is handed rows by the engine as well.
 */
const LIST_WIDGET_TYPE = "nl.list";

type GraphKind = AssetNameNodeSite["graphKind"];

/** One graph of one blueprint, and what the walk needs to know about where it sits. */
interface GraphSite {
    blueprint: Blueprint;
    ownerKey: string;
    graphKind: GraphKind;
    graphId: string;
    ir: BlueprintGraphIr;
    nodes: Record<string, BlueprintGraphNode>;
    incoming: Map<string, BlueprintGraphEdge[]>;
    /**
     * A graph that declares a function may run any of its nodes for a caller elsewhere, with the
     * caller's list row in scope - so a row it reads is not necessarily the row of the list it sits
     * on.
     */
    declaresFunction: boolean;
}

/**
 * What feeds a slot: another slot, a place a value is put together, or a place one is written down.
 * The asset judgement treats the third as clean; {@link traceWrittenValues} collects it.
 */
type Contribution =
    | { kind: "slot"; key: string }
    | { kind: "origin"; origin: AssetNameOrigin }
    | { kind: "written"; source: WrittenValueSource };

/** Where a list is, as far as naming it goes. */
interface ElementPlace {
    element: UIElement;
    /** The pool it is in: the page elements, or one component definition's. */
    pool: Pick<UIDocument, "elements">;
    surfaceId: string | null;
    surfaceName: string | null;
    componentName: string | null;
}

class AssetNameWalk {
    private readonly graphs: GraphSite[] = [];
    private readonly graphByKey = new Map<string, GraphSite>();
    /** Writers of each carrier, by carrier key. */
    private readonly writers = new Map<string, Contribution[]>();
    private readonly places = new Map<string, ElementPlace>();
    private readonly listIds: string[] = [];
    private readonly infoCache = new Map<string, AssetNameNodeInfo | null>();
    private readonly reachCache = new Map<string, ReadonlySet<string>>();
    /** What reaches each blueprint's Return Value nodes - a value binding's result, by blueprint. */
    private readonly returnValueSlots = new Map<string, Contribution[]>();
    private readonly assetPinsFor: (nodeType: string) => readonly BlueprintAssetPin[];

    constructor(private readonly project: AssetNameProject, private readonly describer: AssetNameNodeDescriber) {
        this.assetPinsFor = createAssetPinLookup(describer.assetPins);
        this.indexInterface();
        this.indexGraphs();
        this.indexStories();
    }

    // -- indexing ------------------------------------------------------------------------------

    private indexInterface(): void {
        const ui = this.project.uiDocument;
        if (!ui) {
            return;
        }
        const surfaceByRoot = new Map((ui.surfaces ?? []).map(surface => [surface.rootElementId, surface]));
        const surfaceOf = (element: UIElement): { id: string; name: string } | null => {
            let current: UIElement | undefined = element;
            const seen = new Set<string>();
            while (current?.parentId && !seen.has(current.id)) {
                seen.add(current.id);
                current = ui.elements[current.parentId];
            }
            const surface = current ? surfaceByRoot.get(current.id) : undefined;
            return surface ? { id: surface.id, name: surface.name } : null;
        };
        for (const element of Object.values(ui.elements ?? {})) {
            const surface = surfaceOf(element);
            this.places.set(element.id, {
                element,
                pool: ui,
                surfaceId: surface?.id ?? null,
                surfaceName: surface?.name ?? null,
                componentName: null,
            });
        }
        for (const component of ui.components ?? []) {
            for (const element of Object.values(component.elements ?? {})) {
                this.places.set(element.id, {
                    element,
                    pool: component,
                    surfaceId: null,
                    surfaceName: null,
                    componentName: component.name,
                });
            }
        }
        for (const place of this.places.values()) {
            const element = place.element;
            if (!isListLikeWidgetType(element.type)) {
                continue;
            }
            this.listIds.push(element.id);
            // Rows the author wrote on the list are written in the project, and so add nothing to the
            // asset judgement - but they are values a row reader can hand on. A Game UI list is also
            // handed rows by the engine while the story plays, which nothing in the project states.
            const authored = (element.props as { items?: unknown } | undefined)?.items;
            if (Array.isArray(authored) && authored.length > 0) {
                this.addWriter(listKey(element.id), { kind: "written", source: { kind: "value", value: authored } });
            }
            if (element.type !== LIST_WIDGET_TYPE) {
                this.addWriter(listKey(element.id), {
                    kind: "written",
                    source: { kind: "engineRows", elementId: element.id, elementName: elementLabel(element) },
                });
            }
            // Rows bound to page props come from whatever opened the page; rows bound to page or
            // project state come from a script, which this walk cannot read.
            const binding = (element.props as { itemsBinding?: { kind?: unknown } | null } | undefined)?.itemsBinding;
            if (binding && typeof binding === "object") {
                if (binding.kind === "pageProp") {
                    this.addWriter(listKey(element.id), { kind: "slot", key: "pageProps" });
                } else if (binding.kind === "surfaceState" || binding.kind === "globalState") {
                    this.addWriter(listKey(element.id), {
                        kind: "origin",
                        origin: { kind: "listSource", elementId: element.id, elementName: elementLabel(element) },
                    });
                }
            }
        }
    }

    private indexGraphs(): void {
        const document = this.project.blueprintDocument;
        if (!document) {
            return;
        }
        const ownerKeyByBlueprintId = new Map<string, string>();
        for (const [ownerKey, record] of Object.entries(document.ownerRecords ?? {})) {
            if (record.blueprintId) {
                ownerKeyByBlueprintId.set(record.blueprintId, ownerKey);
            }
        }
        for (const blueprint of Object.values(document.blueprints ?? {})) {
            const ownerKey = ownerKeyByBlueprintId.get(blueprint.id);
            if (!ownerKey) {
                // Never runs: no owner resolves it.
                continue;
            }
            if (hasScriptLayer(blueprint)) {
                this.indexScriptLayer(blueprint, document);
            }
            const graphs = blueprint.graphs;
            const slots: Array<{ graphKind: GraphKind; graphId: string; ir: BlueprintGraphIr | undefined }> = [
                ...Object.entries(graphs.events ?? {}).map(([graphId, slot]) => ({ graphKind: "event" as const, graphId, ir: slot.graph })),
                ...Object.entries(graphs.functions ?? {}).map(([graphId, slot]) => ({ graphKind: "function" as const, graphId, ir: slot.graph })),
                ...Object.entries(graphs.macros ?? {}).map(([graphId, slot]) => ({ graphKind: "macro" as const, graphId, ir: slot.graph })),
            ];
            for (const { graphKind, graphId, ir } of slots) {
                if (!ir) {
                    continue;
                }
                const nodes = ir.nodes ?? {};
                const site: GraphSite = {
                    blueprint,
                    ownerKey,
                    graphKind,
                    graphId,
                    ir,
                    nodes,
                    incoming: groupIncomingEdges(ir),
                    declaresFunction: Object.values(nodes).some(node => node.type === BLUEPRINT_NODE_TYPE_FN_HEAD),
                };
                this.graphs.push(site);
                this.graphByKey.set(graphKey(blueprint.id, graphKind, graphId), site);
            }
        }
        for (const site of this.graphs) {
            for (const node of Object.values(site.nodes)) {
                this.indexWriter(site, node);
                if (node.type === BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE) {
                    const bucket = this.returnValueSlots.get(site.blueprint.id) ?? [];
                    bucket.push({ kind: "slot", key: inputKey(site, node.id, "value") });
                    this.returnValueSlots.set(site.blueprint.id, bucket);
                }
            }
        }
    }

    /**
     * A script layer writes whatever it likes into the variables its blueprint can reach, so each of
     * those counts as written by something this walk cannot read: its own, its page's, the project's,
     * and - for a story's blueprint - the story's variables.
     */
    private indexScriptLayer(blueprint: Blueprint, document: BlueprintDocument): void {
        const origin: AssetNameOrigin = { kind: "script", blueprintId: blueprint.id, blueprintName: blueprint.name };
        const write = (key: string) => this.addWriter(key, { kind: "origin", origin });
        write(localWildcardKey(blueprint.id));
        const surfaceId = anchorSurfaceId(blueprint.owner);
        for (const other of Object.values(document.blueprints ?? {})) {
            const owner = other.owner;
            if (owner.kind === "globalMain" || (surfaceId && owner.kind === "surfaceMain" && owner.surfaceId === surfaceId)) {
                write(localWildcardKey(other.id));
            }
        }
        if (blueprint.owner.kind === "storyAction") {
            write(varWildcardKey("saved"));
            write(varWildcardKey("persistent"));
            write(varWildcardKey("scene"));
        } else {
            // A UI script can send a broadcast of its own.
            write("broadcast");
        }
    }

    private indexWriter(site: GraphSite, node: BlueprintGraphNode): void {
        const inputs = () => this.dataInputSlots(site, node);
        switch (node.type) {
            case BLUEPRINT_NODE_TYPE_LOCAL_SET: {
                const ref = parseBlueprintVariableRef(node.params?.variableId, site.blueprint.id);
                if (ref) {
                    this.addWriters(localKey(ref.blueprintId, ref.variableId), inputs());
                }
                return;
            }
            case BLUEPRINT_NODE_TYPE_PERSISTENT_SET:
                this.addWriters(varKey("persistent", node.params?.persistentVariableId), inputs());
                return;
            case BLUEPRINT_NODE_TYPE_SAVED_SET:
                this.addWriters(varKey("saved", node.params?.savedVariableId), inputs());
                return;
            case BLUEPRINT_NODE_TYPE_SCENE_SET:
                this.addWriters(varKey("scene", node.params?.sceneVariableId), inputs());
                return;
            case BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS: {
                // Overwrites the project-level variables from a document another edition wrote.
                const origin = this.nodeOrigin(site, node);
                this.addWriter(varWildcardKey("saved"), { kind: "origin", origin });
                this.addWriter(varWildcardKey("persistent"), { kind: "origin", origin });
                return;
            }
            case BLUEPRINT_NODE_TYPE_FN_CALL: {
                const target = this.fnTarget(node);
                if (!target) {
                    return;
                }
                for (const [pinId, contributions] of this.dataInputSlotsByPin(site, node)) {
                    this.addWriters(fnParamKey(target.blueprintId, target.headNodeId, pinId), contributions);
                }
                return;
            }
            case BLUEPRINT_NODE_TYPE_FN_RETURN: {
                // Whichever function in this graph can reach this return by its flow.
                for (const head of Object.values(site.nodes)) {
                    if (head.type !== BLUEPRINT_NODE_TYPE_FN_HEAD || !this.reachableFrom(site, head.id).has(node.id)) {
                        continue;
                    }
                    for (const [pinId, contributions] of this.dataInputSlotsByPin(site, node)) {
                        this.addWriters(fnReturnKey(site.blueprint.id, head.id, pinId), contributions);
                    }
                }
                return;
            }
            default:
                break;
        }
        if (SELF_LIST_WRITERS.has(node.type)) {
            this.addWriters(this.selfListKey(site), inputs());
            return;
        }
        if (ELEMENT_LIST_WRITERS.has(node.type)) {
            this.addWriters(this.wiredListKey(site, node), inputs());
            return;
        }
        const carrier = CARRIER_WRITERS.get(node.type);
        if (carrier) {
            this.addWriters(carrier, inputs());
        }
    }

    private indexStories(): void {
        for (const write of this.project.storyWrites ?? []) {
            const key = varKey(write.target.scope, write.target.variableId);
            if (write.computed) {
                this.addWriter(key, { kind: "origin", origin: write.computed });
            }
            for (const read of write.reads) {
                this.addWriter(key, { kind: "slot", key: varKey(read.scope, read.variableId) });
            }
            for (const value of write.values ?? []) {
                this.addWriter(key, { kind: "written", source: { kind: "value", value } });
            }
        }
    }

    private addWriter(key: string, contribution: Contribution): void {
        const bucket = this.writers.get(key);
        if (bucket) {
            bucket.push(contribution);
        } else {
            this.writers.set(key, [contribution]);
        }
    }

    private addWriters(key: string, contributions: readonly Contribution[]): void {
        for (const contribution of contributions) {
            this.addWriter(key, contribution);
        }
    }

    // -- resolving what a node and a site are -----------------------------------------------

    private reachableFrom(site: GraphSite, headNodeId: string): ReadonlySet<string> {
        const key = joinKey(graphKey(site.blueprint.id, site.graphKind, site.graphId), headNodeId);
        let reach = this.reachCache.get(key);
        if (!reach) {
            reach = collectExecReachableNodeIds(site.ir, headNodeId);
            this.reachCache.set(key, reach);
        }
        return reach;
    }

    private info(node: BlueprintGraphNode): AssetNameNodeInfo | null {
        const dynamic = Object.keys(node.params ?? {}).some(key => key.startsWith("__"));
        const cacheKey = dynamic ? null : node.type;
        if (cacheKey !== null && this.infoCache.has(cacheKey)) {
            return this.infoCache.get(cacheKey)!;
        }
        const info = this.describer.node(node.type, node.params);
        if (cacheKey !== null) {
            this.infoCache.set(cacheKey, info);
        }
        return info;
    }

    private nodeOrigin(site: GraphSite, node: BlueprintGraphNode): AssetNameOrigin {
        return { kind: "node", ...this.nodeSite(site, node) };
    }

    private nodeSite(site: GraphSite, node: BlueprintGraphNode): AssetNameNodeSite {
        return {
            blueprintId: site.blueprint.id,
            blueprintName: site.blueprint.name,
            ownerKey: site.ownerKey,
            graphKind: site.graphKind,
            graphId: site.graphId,
            nodeId: node.id,
            nodeType: node.type,
            nodeTitle: this.describer.title(node.type),
        };
    }

    /** What arrives at each data input of a node: its edges, or nothing but what is written on it. */
    private dataInputSlotsByPin(site: GraphSite, node: BlueprintGraphNode): Map<string, Contribution[]> {
        const byPin = new Map<string, Contribution[]>();
        const info = this.info(node);
        const dataInputs = info
            ? info.pins.filter(pin => pin.kind === "input" && pin.semantic === "data").map(pin => pin.id)
            // A node nobody can describe: every edge into it might be data.
            : [...new Set((site.ir.edges ?? []).filter(edge => edge.to.nodeId === node.id).map(edge => edge.to.port))];
        for (const pinId of dataInputs) {
            byPin.set(pinId, [{ kind: "slot", key: inputKey(site, node.id, pinId) }]);
        }
        return byPin;
    }

    private dataInputSlots(site: GraphSite, node: BlueprintGraphNode): Contribution[] {
        return [...this.dataInputSlotsByPin(site, node).values()].flat();
    }

    private fnTarget(node: BlueprintGraphNode): { blueprintId: string; headNodeId: string } | null {
        const document = this.project.blueprintDocument;
        if (!document) {
            return null;
        }
        const declaration = findBlueprintFnByRef(document, node.params?.fnRef);
        return declaration ? { blueprintId: declaration.blueprintId, headNodeId: declaration.headNodeId } : null;
    }

    /** The list whose own graph this is, when the graph belongs to one. */
    private ownList(site: GraphSite): string | null {
        const elementId = anchorElementId(site.blueprint.owner);
        const place = elementId ? this.places.get(elementId) : undefined;
        return place && isListLikeWidgetType(place.element.type) ? place.element.id : null;
    }

    private selfListKey(site: GraphSite): string {
        const own = this.ownList(site);
        return own ? listKey(own) : LIST_UNKNOWN_TARGET;
    }

    /** The list a node's `list` pin is wired to, when it is wired to an element reference. */
    private wiredListKey(site: GraphSite, node: BlueprintGraphNode): string {
        const edge = site.incoming.get(incomingEdgeKey(node.id, "list"))?.[0];
        const source = edge ? site.nodes[edge.from.nodeId] : undefined;
        const elementId = source?.type === BLUEPRINT_NODE_TYPE_ELEMENT_REF ? source.params?.elementId : undefined;
        return typeof elementId === "string" && elementId ? listKey(elementId) : LIST_UNKNOWN_TARGET;
    }

    /**
     * The list whose row is in scope while this graph runs.
     *
     * The list itself for its own item heads; the list drawing the element otherwise. Anything this
     * cannot pin down - a component, which any list may draw, or a graph declaring a function, which
     * runs for a caller's row - reads every list.
     */
    private rowListKey(site: GraphSite): string {
        if (site.declaresFunction) {
            return LIST_ANY;
        }
        const own = this.ownList(site);
        if (own) {
            return listKey(own);
        }
        const elementId = anchorElementId(site.blueprint.owner);
        return elementId ? this.owningListKey(elementId) : LIST_ANY;
    }

    private owningListKey(elementId: string): string {
        const place = this.places.get(elementId);
        if (!place) {
            return LIST_ANY;
        }
        const owning = findOwningListItemTemplate(place.pool, place.element);
        return owning ? listKey(owning.listElementId) : LIST_ANY;
    }

    // -- the slots ---------------------------------------------------------------------------

    /** The slot one node input is, or null when the walk does not index that node's graph. */
    inputSlotKey(pin: { blueprintId: string; graphKind: GraphKind; graphId: string; nodeId: string; pinId: string }): string | null {
        const site = this.graphByKey.get(graphKey(pin.blueprintId, pin.graphKind, pin.graphId));
        return site?.nodes[pin.nodeId] ? inputKey(site, pin.nodeId, pin.pinId) : null;
    }

    /** What feeds one slot. */
    contributions(key: string): Contribution[] {
        const parts = key.split(KEY_SEPARATOR);
        const [carrier] = parts;
        if (carrier === "in" || carrier === "out") {
            const [, blueprintId, graphKind, graphId, nodeId, pinId] = parts;
            const site = this.graphByKey.get(graphKey(blueprintId, graphKind as GraphKind, graphId));
            const node = site?.nodes[nodeId];
            if (!site || !node) {
                return [];
            }
            return carrier === "in" ? this.inputContributions(site, node, pinId) : this.outputContributions(site, node, pinId);
        }
        if (key === LIST_ANY) {
            return [...this.listIds.map(id => ({ kind: "slot" as const, key: listKey(id) })), { kind: "slot", key: LIST_UNKNOWN_TARGET }];
        }
        const wildcard = parts[parts.length - 1] === "*";
        if (carrier === "list" && key !== LIST_UNKNOWN_TARGET) {
            return [...(this.writers.get(key) ?? []), { kind: "slot", key: LIST_UNKNOWN_TARGET }];
        }
        // A variable holds its declared default until something writes it, so the default is one of
        // the values it can hand on. Written in the project either way, which is all the asset
        // judgement needs to know.
        if (carrier === "local" && !wildcard) {
            return [
                ...(this.writers.get(key) ?? []),
                { kind: "slot", key: localWildcardKey(parts[1]) },
                { kind: "written", source: { kind: "value", value: this.localDefault(parts[1], parts[2]) } },
            ];
        }
        if (carrier === "var" && !wildcard) {
            const scope = parts[1] as StoryVariableRef["scope"];
            return [
                ...(this.writers.get(key) ?? []),
                { kind: "slot", key: varWildcardKey(scope) },
                { kind: "written", source: { kind: "variableDefault", scope, variableId: parts[2] } },
            ];
        }
        if (carrier === "binding") {
            return this.valueBindingContributions(parts[1]);
        }
        return this.writers.get(key) ?? [];
    }

    private inputContributions(site: GraphSite, node: BlueprintGraphNode, pinId: string): Contribution[] {
        const edges = (site.incoming.get(incomingEdgeKey(node.id, pinId)) ?? []).filter(edge => site.nodes[edge.from.nodeId]);
        if (edges.length === 0) {
            // An input with no edge holds what is written on the node, which is written in the project.
            return [{ kind: "written", source: { kind: "value", value: node.params?.[pinId] } }];
        }
        return edges.map(edge => ({ kind: "slot" as const, key: outputKey(site, edge.from.nodeId, edge.from.port) }));
    }

    private outputContributions(site: GraphSite, node: BlueprintGraphNode, pinId: string): Contribution[] {
        const info = this.info(node);
        if (!info) {
            // A node nobody can describe could put anything together.
            return [{ kind: "origin", origin: this.nodeOrigin(site, node) }];
        }
        const pin = info.pins.find(candidate => candidate.id === pinId && candidate.kind === "output");
        if (pin && (pin.semantic !== "data" || isInertValueType(pin.valueType))) {
            return [];
        }
        // A pin that says what it carries: the asset its own node stores, or one the host makes that
        // cannot be a library asset. Either way, written or no name at all.
        if (pin?.assetRef || this.assetPinsFor(node.type).some(assetPin => assetPin.pinId === pinId && !assetPin.input)) {
            return [];
        }
        const carried = this.carrierRead(site, node, pinId);
        if (carried) {
            return carried;
        }
        switch (pin?.assetName ?? info.flow) {
            case "written":
                return [{
                    kind: "written",
                    source: {
                        kind: "node",
                        site: this.nodeSite(site, node),
                        owner: site.blueprint.owner,
                        params: node.params ?? {},
                    },
                }];
            case "forward":
                return this.dataInputSlots(site, node);
            default:
                return [{ kind: "origin", origin: this.nodeOrigin(site, node) }];
        }
    }

    /** For a node that reads a carrier, the carrier; null for every other node. */
    private carrierRead(site: GraphSite, node: BlueprintGraphNode, pinId: string): Contribution[] | null {
        const unknown = (): Contribution[] => [{ kind: "origin", origin: this.nodeOrigin(site, node) }];
        switch (node.type) {
            case BLUEPRINT_NODE_TYPE_LOCAL_GET: {
                const ref = parseBlueprintVariableRef(node.params?.variableId, site.blueprint.id);
                return ref ? [{ kind: "slot", key: localKey(ref.blueprintId, ref.variableId) }] : unknown();
            }
            case BLUEPRINT_NODE_TYPE_PERSISTENT_GET:
                return this.varRead("persistent", node.params?.persistentVariableId) ?? unknown();
            case BLUEPRINT_NODE_TYPE_SAVED_GET:
                return this.varRead("saved", node.params?.savedVariableId) ?? unknown();
            case BLUEPRINT_NODE_TYPE_SCENE_GET:
                return this.varRead("scene", node.params?.sceneVariableId) ?? unknown();
            case BLUEPRINT_NODE_TYPE_FN_HEAD:
                return [{ kind: "slot", key: fnParamKey(site.blueprint.id, node.id, pinId) }];
            case BLUEPRINT_NODE_TYPE_FN_CALL: {
                const target = this.fnTarget(node);
                return target ? [{ kind: "slot", key: fnReturnKey(target.blueprintId, target.headNodeId, pinId) }] : unknown();
            }
            default:
                break;
        }
        if (ROW_SCOPE_READERS.has(node.type)) {
            return [{ kind: "slot", key: this.rowListKey(site) }];
        }
        if (SELF_LIST_READERS.has(node.type)) {
            const own = this.ownList(site);
            return [{ kind: "slot", key: own ? listKey(own) : LIST_ANY }];
        }
        if (ELEMENT_LIST_READERS.has(node.type)) {
            const key = this.wiredListKey(site, node);
            return [{ kind: "slot", key: key === LIST_UNKNOWN_TARGET ? LIST_ANY : key }];
        }
        if (ROW_EVENT_HEADS.has(node.type)) {
            const own = this.ownList(site);
            return [{ kind: "slot", key: own ? listKey(own) : LIST_ANY }];
        }
        const carrier = CARRIER_READS.get(node.type);
        return carrier ? [{ kind: "slot", key: carrier }] : null;
    }

    /** The default a blueprint declares for one of its variables, or undefined when it declares none. */
    private localDefault(blueprintId: string, variableId: string): unknown {
        const blueprint = this.project.blueprintDocument?.blueprints?.[blueprintId];
        return blueprint ? getEffectiveBlueprintVariableRecord(blueprint)[variableId]?.defaultValue : undefined;
    }

    private varRead(scope: StoryVariableRef["scope"], variableId: unknown): Contribution[] | null {
        return typeof variableId === "string" && variableId.trim()
            ? [{ kind: "slot", key: varKey(scope, variableId) }]
            : null;
    }

    /** A value blueprint's result: whatever reaches any of its Return Value nodes. */
    private valueBindingContributions(blueprintId: string): Contribution[] {
        return this.returnValueSlots.get(blueprintId) ?? [];
    }

    // -- the sinks ---------------------------------------------------------------------------

    /** Every place an asset is named by a value, with the slot that value arrives in. */
    sinks(): Array<{ sink: AssetNameSink; assetKind: BlueprintAssetPinKind; key: string }> {
        const out: Array<{ sink: AssetNameSink; assetKind: BlueprintAssetPinKind; key: string }> = [];
        for (const site of this.graphs) {
            for (const node of Object.values(site.nodes)) {
                for (const pin of this.assetPinsFor(node.type)) {
                    if (!pin.input || !site.incoming.has(incomingEdgeKey(node.id, pin.pinId))) {
                        continue;
                    }
                    out.push({
                        assetKind: pin.kind,
                        key: inputKey(site, node.id, pin.pinId),
                        sink: {
                            kind: "pin",
                            blueprintId: site.blueprint.id,
                            blueprintName: site.blueprint.name,
                            ownerKey: site.ownerKey,
                            graphKind: site.graphKind,
                            graphId: site.graphId,
                            nodeId: node.id,
                            nodeType: node.type,
                            nodeTitle: this.describer.title(node.type),
                            pinId: pin.pinId,
                            pinLabel: this.describer.pinLabel(node.type, pin.pinId),
                        },
                    });
                }
            }
        }
        const ownerKeyByBlueprintId = new Map<string, string>();
        for (const [ownerKey, record] of Object.entries(this.project.blueprintDocument?.ownerRecords ?? {})) {
            if (record.blueprintId) {
                ownerKeyByBlueprintId.set(record.blueprintId, ownerKey);
            }
        }
        for (const place of this.places.values()) {
            for (const [propPath, binding] of Object.entries(place.element.valueBindings ?? {})) {
                const assetKind = ASSET_BINDING_PROPS[propPath];
                if (!assetKind || !binding) {
                    continue;
                }
                const reads = binding.kind === "blueprintValue";
                out.push({
                    assetKind,
                    key: reads ? joinKey("binding", binding.blueprintId) : this.owningListKey(place.element.id),
                    sink: {
                        kind: "binding",
                        elementId: place.element.id,
                        elementName: elementLabel(place.element),
                        propPath,
                        surfaceId: place.surfaceId,
                        surfaceName: place.surfaceName,
                        componentName: place.componentName,
                        blueprintId: reads ? binding.blueprintId : null,
                        ownerKey: reads ? ownerKeyByBlueprintId.get(binding.blueprintId) ?? null : null,
                    },
                });
            }
        }
        return out;
    }
}

function joinKey(...parts: string[]): string {
    return parts.join(KEY_SEPARATOR);
}

const LIST_ANY = joinKey("list", "*any");
/** Rows written by a node whose list this walk cannot name: they may be any list's. */
const LIST_UNKNOWN_TARGET = joinKey("list", "*unknown");

function graphKey(blueprintId: string, graphKind: GraphKind, graphId: string): string {
    return joinKey(blueprintId, graphKind, graphId);
}

function inputKey(site: GraphSite, nodeId: string, pinId: string): string {
    return joinKey("in", site.blueprint.id, site.graphKind, site.graphId, nodeId, pinId);
}

function outputKey(site: GraphSite, nodeId: string, pinId: string): string {
    return joinKey("out", site.blueprint.id, site.graphKind, site.graphId, nodeId, pinId);
}

function listKey(elementId: string): string {
    return joinKey("list", elementId);
}

function localKey(blueprintId: string, variableId: string): string {
    return joinKey("local", blueprintId, variableId);
}

function localWildcardKey(blueprintId: string): string {
    return joinKey("local", blueprintId, "*");
}

function varKey(scope: StoryVariableRef["scope"], variableId: unknown): string {
    return joinKey("var", scope, String(variableId ?? "").trim());
}

function varWildcardKey(scope: StoryVariableRef["scope"]): string {
    return joinKey("var", scope, "*");
}

function fnParamKey(blueprintId: string, headNodeId: string, pinId: string): string {
    return joinKey("fnParam", blueprintId, headNodeId, pinId);
}

function fnReturnKey(blueprintId: string, headNodeId: string, pinId: string): string {
    return joinKey("fnReturn", blueprintId, headNodeId, pinId);
}

function elementLabel(element: UIElement): string {
    return element.name?.trim() || element.type;
}

/**
 * Every place in the project an asset is picked by a name assembled while the game runs.
 *
 * One gap per sink, naming the first origin that reaches it. The fixed point: discover every slot a
 * sink depends on, then spread each origin forward to everything that depends on it. Monotone - a
 * slot only ever goes from clean to assembled - so it ends, and cycles through a variable that is
 * written from itself cost nothing.
 */
export function findAssetNameGaps(project: AssetNameProject, describer: AssetNameNodeDescriber): AssetNameGap[] {
    const walk = new AssetNameWalk(project, describer);
    const sinks = walk.sinks();

    // Discover.
    const dependencies = new Map<string, string[]>();
    const seeds: Array<{ key: string; origin: AssetNameOrigin }> = [];
    const stack = sinks.map(sink => sink.key).reverse();
    while (stack.length > 0) {
        const key = stack.pop()!;
        if (dependencies.has(key)) {
            continue;
        }
        const slots: string[] = [];
        for (const contribution of walk.contributions(key)) {
            if (contribution.kind === "origin") {
                seeds.push({ key, origin: contribution.origin });
            } else if (contribution.kind === "slot") {
                slots.push(contribution.key);
            }
            // A value written down in the project is one the package carries: nothing to report.
        }
        dependencies.set(key, slots);
        for (let index = slots.length - 1; index >= 0; index -= 1) {
            if (!dependencies.has(slots[index])) {
                stack.push(slots[index]);
            }
        }
    }

    // Spread.
    const dependents = new Map<string, string[]>();
    for (const [key, slots] of dependencies) {
        for (const slot of slots) {
            const bucket = dependents.get(slot);
            if (bucket) {
                bucket.push(key);
            } else {
                dependents.set(slot, [key]);
            }
        }
    }
    const originOf = new Map<string, AssetNameOrigin>();
    const queue: string[] = [];
    for (const seed of seeds) {
        if (!originOf.has(seed.key)) {
            originOf.set(seed.key, seed.origin);
            queue.push(seed.key);
        }
    }
    for (let head = 0; head < queue.length; head += 1) {
        const key = queue[head];
        for (const dependent of dependents.get(key) ?? []) {
            if (!originOf.has(dependent)) {
                originOf.set(dependent, originOf.get(key)!);
                queue.push(dependent);
            }
        }
    }

    const gaps: AssetNameGap[] = [];
    for (const { sink, assetKind, key } of sinks) {
        const origin = originOf.get(key);
        if (origin) {
            gaps.push({ assetKind, sink, origin });
        }
    }
    return gaps;
}

/** One input pin of one node, by where it sits. */
export interface ValuePinRef {
    blueprintId: string;
    graphKind: GraphKind;
    graphId: string;
    nodeId: string;
    pinId: string;
}

/**
 * Where the value arriving at one input pin comes from.
 *
 * `origin` is the first place it is put together, when there is one - the same answer the asset
 * judgement gives a sink. `written` is every place it is written down, followed through the same
 * carriers: variables, list rows, function parameters, page props. When `origin` is absent,
 * `written` is the whole of what the pin can receive.
 */
export interface ValueTrace {
    origin?: AssetNameOrigin;
    written: WrittenValueSource[];
}

/**
 * Follow the values arriving at some input pins back to where they are put together or written down.
 *
 * The walk the asset judgement runs, asked about pins that do not carry assets: a `Start Game`'s
 * scene, fed from the row a recollection list was clicked on, is written in the Gallery's catalogue
 * exactly as a picture taken from the same row is. Asking the one walk means a carrier it learns to
 * follow is followed for both questions, and neither can grow a reading of a list row the other
 * does not share.
 *
 * Null for a pin the walk does not index - a blueprint no owner resolves never runs, and so has no
 * graph here - which a caller reads as "cannot say", never as "receives nothing".
 */
export function traceWrittenValues(
    project: AssetNameProject,
    describer: AssetNameNodeDescriber,
    pins: readonly ValuePinRef[],
): Array<ValueTrace | null> {
    const walk = new AssetNameWalk(project, describer);
    const cache = new Map<string, Contribution[]>();
    const contributionsOf = (key: string): Contribution[] => {
        let found = cache.get(key);
        if (!found) {
            found = walk.contributions(key);
            cache.set(key, found);
        }
        return found;
    };
    return pins.map(pin => {
        const start = walk.inputSlotKey(pin);
        if (!start) {
            return null;
        }
        const trace: ValueTrace = { written: [] };
        const seen = new Set<string>([start]);
        const queue = [start];
        // Breadth-first, so the origin named is the nearest one - the node an author is most likely
        // to recognise as the one that assembles the value.
        for (let head = 0; head < queue.length; head += 1) {
            for (const contribution of contributionsOf(queue[head])) {
                if (contribution.kind === "origin") {
                    trace.origin ??= contribution.origin;
                } else if (contribution.kind === "written") {
                    trace.written.push(contribution.source);
                } else if (!seen.has(contribution.key)) {
                    seen.add(contribution.key);
                    queue.push(contribution.key);
                }
            }
        }
        return trace;
    });
}

/**
 * Every place the judgement looked at, gap or not.
 *
 * For the tests that have to tell "checked and clean" from "never looked at": a project with no gaps
 * because nothing was followed would read exactly like a clean one.
 */
export function listAssetNameSinks(
    project: AssetNameProject,
    describer: AssetNameNodeDescriber,
): Array<{ sink: AssetNameSink; assetKind: BlueprintAssetPinKind }> {
    return new AssetNameWalk(project, describer).sinks().map(({ sink, assetKind }) => ({ sink, assetKind }));
}
