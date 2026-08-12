/**
 * Stacking a page over whatever is already on screen: show, hide, wait, close, ask.
 *
 * The vocabulary an author sees never mentions z order or layer names, and that is a constraint
 * rather than a shorthand. Stacking order is mount order; the only thing that names a layer is the
 * handle `Show Layer` hands back, and that handle is meaningless to anyone who was not given it. A
 * screen therefore cannot be built to depend on a particular depth, which is what stops the first
 * project that wants "just one more layer above the pause menu" from turning the composite into a
 * numbering scheme nobody can change afterwards.
 *
 * These live in the App category beside `Go Page` / `Go back`, because from where an author stands
 * they are the same subject - what is on screen - split by whether the page replaces or covers.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_LAYER_HIDE,
    BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_LAYER_WAIT,
} from "@shared/types/blueprint/graph";
import {
    BlueprintGraphExecutionError,
    isBlueprintGraphExecutionCancelledError,
} from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { readDynamicInputPinIds } from "../effectivePins";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/** The handle input every node but `Show Layer` takes. */
const layerHandleIn: BlueprintNodePinDef = {
    id: "layer",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Layer",
};

function readPin(ctx: Parameters<BlueprintNodeDef["execute"]>[0], pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
        valueExecution: ctx.valueExecution,
    });
}

function readHandle(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): string {
    return String(readPin(ctx, "layer") ?? "").trim();
}

/** Where `Show Confirm` keeps the ordered list of pin ids its Add Button produced. */
const CONFIRM_BUTTON_PINS_KEY = "__confirmButtonPins";
const CONFIRM_BUTTON_LABEL_SUFFIX = "_label";
const CONFIRM_BUTTON_PRESSED_SUFFIX = "_pressed";
/** The group a confirm claims, so a second question queues behind the first instead of over it. */
const CONFIRM_GROUP = "confirm";

type ConfirmButtonPin = { labelPinId: string; pressedPinId: string };

/**
 * The buttons an author added, in the order they will be shown, each with the exec output it leads
 * to.
 *
 * Read once and used for both the labels handed to the page and the ports the answer routes to,
 * which is the whole reason it returns pairs rather than two lists. Pairing is by id - one add
 * writes `button_3_label` and `button_3_pressed` together - so deleting a button from the middle
 * renumbers nothing and misroutes nothing; the surviving pairs keep pointing at their own outputs.
 * Deriving the ports by position in a separate list is what would eventually route the second
 * button to the third branch.
 */
function readConfirmButtonPins(params: Record<string, unknown> | undefined): ConfirmButtonPin[] {
    const ids = readDynamicInputPinIds(params, CONFIRM_BUTTON_PINS_KEY);
    const present = new Set(ids);
    const out: ConfirmButtonPin[] = [];
    for (const id of ids) {
        if (!id.endsWith(CONFIRM_BUTTON_LABEL_SUFFIX)) {
            continue;
        }
        const pressedPinId = `${id.slice(0, -CONFIRM_BUTTON_LABEL_SUFFIX.length)}${CONFIRM_BUTTON_PRESSED_SUFFIX}`;
        if (!present.has(pressedPinId)) {
            continue;
        }
        out.push({ labelPinId: id, pressedPinId });
    }
    return out;
}

/**
 * The button index a closing confirm reported, or -1 for anything that is not one.
 *
 * The page inside a confirm closes itself with `Close This Layer`, so what comes back is whatever
 * an author wired into it. A row click carries the index straight through; an object with an
 * `index` field is what a page that closes with more than the answer would send. Everything else -
 * a dismissal, which settles as `null`, a page that closes with nothing, a page closing with a
 * value of its own - is not an answer to this question and leaves through `Dismissed`.
 */
function readConfirmIndex(result: unknown): number {
    const raw =
        result !== null && typeof result === "object" && !Array.isArray(result)
            ? (result as Record<string, unknown>).index
            : result;
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return -1;
    }
    return value;
}

export const layerBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_SHOW,
        displayName: "Show Layer",
        category: "App",
        keywords: ["layer", "show", "page", "over", "overlay", "modal", "dialog", "popup", "stack"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "props",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Page props",
                optional: true,
            },
            {
                id: "modal",
                kind: "input",
                semantic: "data",
                valueType: "boolean",
                label: "Modal",
                allowInlineLiteral: true,
            },
            {
                id: "dismissible",
                kind: "input",
                semantic: "data",
                valueType: "boolean",
                label: "Dismissible",
                allowInlineLiteral: true,
            },
            {
                id: "group",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Group",
                optional: true,
                allowInlineLiteral: true,
            },
            { id: "layer", kind: "output", semantic: "data", valueType: "string", label: "Layer" },
        ],
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Page",
                kind: "select",
                // The same source `Go Page` picks from, deliberately: a layer IS a page, and offering
                // an author two different lists of pages would suggest otherwise.
                dynamicOptionsSource: "surfaces",
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            const group = String(readPin(ctx, "group") ?? "").trim();
            let layer: string;
            try {
                layer = await api.layers.show(surfaceId, readPin(ctx, "props"), {
                    modal: readPin(ctx, "modal") === true,
                    // Unwired reads as dismissible: a layer the player cannot get out of is a
                    // decision, and a decision is not what an untouched pin should mean.
                    dismissible: readPin(ctx, "dismissible") !== false,
                    group: group || null,
                });
            } catch (error) {
                if (isBlueprintGraphExecutionCancelledError(error) || error instanceof BlueprintGraphExecutionError) {
                    throw error;
                }
                // The host names the page it could not find; carrying that sentence onto this node is
                // what puts the failure on the row an author can fix.
                throw new BlueprintGraphExecutionError(
                    error instanceof Error ? error.message : String(error),
                    ctx.node.id,
                );
            }
            return { nextPort: "next", outputValues: { layer } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_HIDE,
        displayName: "Hide Layer",
        category: "App",
        keywords: ["layer", "hide", "close", "dismiss", "remove", "overlay", "modal"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, layerHandleIn],
        async execute(ctx) {
            // A handle naming nothing is a no-op rather than an error, the same bargain `Go back`
            // makes at the bottom of the page stack: the layer being gone already is the outcome
            // this node was asked for.
            await requireHostApi(ctx).layers.hide(readHandle(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_WAIT,
        displayName: "Wait For Layer",
        category: "App",
        keywords: ["layer", "wait", "await", "result", "answer", "confirm", "modal", "close"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            layerHandleIn,
            { id: "result", kind: "output", semantic: "data", valueType: "json", label: "Result" },
        ],
        async execute(ctx) {
            const result = await requireHostApi(ctx).layers.wait(readHandle(ctx));
            return { nextPort: "next", outputValues: { result: result ?? null } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
        displayName: "Close This Layer",
        category: "App",
        keywords: ["layer", "close", "self", "dismiss", "return", "result", "answer", "confirm"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "result",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Result",
                optional: true,
            },
        ],
        async execute(ctx) {
            await requireHostApi(ctx).layers.closeSelf(readPin(ctx, "result") ?? null);
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED,
        displayName: "Is Layer Mounted",
        category: "App",
        keywords: ["layer", "mounted", "open", "shown", "visible", "present", "is"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            layerHandleIn,
            { id: "mounted", kind: "output", semantic: "data", valueType: "boolean", label: "Is Mounted" },
        ],
        // Pure, so the executor never runs this: the value comes from `resolveSelfOutput` in
        // graphParamResolvers.ts. This body is what a macro expansion and the sweep-test read.
        execute(ctx) {
            const handle = readHandle(ctx);
            return {
                outputValues: {
                    mounted: handle ? requireHostApi(ctx).layers.isMounted(handle) : false,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
        displayName: "Show Confirm",
        category: "App",
        keywords: ["confirm", "ask", "question", "prompt", "dialog", "choice", "yes", "no", "modal", "layer"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            {
                id: "message",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Message",
                allowInlineLiteral: true,
            },
            {
                id: "tag",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Tag",
                optional: true,
                allowInlineLiteral: true,
            },
            {
                id: "data",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Data",
                optional: true,
            },
            // Outputs, in card order. The buttons land above `Dismissed` (see
            // `outputInsertBeforePinId`), so the answers read top to bottom in the order the player
            // sees them and the way out of the question sits under all of them.
            { id: "dismissed", kind: "output", semantic: "exec", label: "Dismissed" },
            { id: "index", kind: "output", semantic: "data", valueType: "integer", label: "Index" },
            { id: "label", kind: "output", semantic: "data", valueType: "string", label: "Label" },
        ],
        dynamicInputPins: {
            storageKey: CONFIRM_BUTTON_PINS_KEY,
            fixedDataInputIds: ["message", "tag", "data"],
            generatedIdPrefix: "button",
            valueType: "string",
            allowInlineLiteral: true,
            labelPrefix: "Button",
            addButtonLabel: "Add Button",
            // Numbered, unlike every other grouped-pin node: these pins carry no value that tells
            // them apart on the card, and which branch is which is exactly what an author is here
            // to decide.
            numberGeneratedPinLabels: true,
            outputInsertBeforePinId: "dismissed",
            generatedPinTemplates: [
                {
                    idSuffix: "label",
                    label: "Button",
                    kind: "input",
                    semantic: "data",
                    valueType: "string",
                    allowInlineLiteral: true,
                },
                {
                    idSuffix: "pressed",
                    label: "Pressed",
                    kind: "output",
                    semantic: "exec",
                },
            ],
        },
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
            },
        ],
        /**
         * Put the page up modally, wait for it to close, and leave through the button that closed it.
         *
         * The page is an ordinary page and learns the question the ordinary way, through the props
         * a layer is shown with: `message`, and `buttons` as `{ id, text, index, disabled }` for a
         * list to bind to. Nothing here is confirm-specific machinery - a page built by hand out of
         * `Show Layer` reads exactly the same props.
         */
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            const pins = readConfirmButtonPins(ctx.params);
            const labels = pins.map(pin => String(readPin(ctx, pin.labelPinId) ?? ""));
            const ports = pins.map(pin => pin.pressedPinId);
            const tag = String(readPin(ctx, "tag") ?? "").trim();
            let handle: string;
            try {
                handle = await api.layers.show(
                    surfaceId,
                    {
                        message: String(readPin(ctx, "message") ?? ""),
                        buttons: labels.map((text, index) => ({
                            id: `button-${index}`,
                            text,
                            index,
                            disabled: false,
                        })),
                        tag: tag || null,
                        data: readPin(ctx, "data") ?? null,
                    },
                    { modal: true, dismissible: true, group: CONFIRM_GROUP },
                );
            } catch (error) {
                if (isBlueprintGraphExecutionCancelledError(error) || error instanceof BlueprintGraphExecutionError) {
                    throw error;
                }
                throw new BlueprintGraphExecutionError(
                    error instanceof Error ? error.message : String(error),
                    ctx.node.id,
                );
            }
            const index = readConfirmIndex(await api.layers.wait(handle));
            if (index >= ports.length) {
                // A page reporting a button this node does not have is not a branch anybody drew,
                // and guessing one would send the story somewhere on the strength of a number.
                return { nextPort: "dismissed", outputValues: { index: -1, label: "" } };
            }
            return index < 0
                ? { nextPort: "dismissed", outputValues: { index: -1, label: "" } }
                : { nextPort: ports[index], outputValues: { index, label: labels[index] } };
        },
    },
];
