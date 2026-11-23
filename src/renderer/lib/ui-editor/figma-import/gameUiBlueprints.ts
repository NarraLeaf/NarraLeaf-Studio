/**
 * The blueprints a Game UI made from a design needs to do its job.
 *
 * A dialogue box drawn in Figma is only a picture of one until its parts are wired: the name follows
 * the speaker, the avatar shows the speaker's face, the box answers Advance, the choice list chooses,
 * the quick menu's buttons turn Auto on and open the Log. Each graph here is the one the starter
 * project's own Game UI carries for that job, so an imported box behaves as the shipped one does and
 * an author who opens the blueprint finds what the documentation describes.
 *
 * Owners and element references use the converter's element and surface ids; the import re-ids them
 * together with the document. A page a button opens is named by the project's own id, which the
 * import leaves as it is.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { Blueprint, BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
    BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIPPING,
    BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR,
    BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_IS_DIALOG_SHOWN,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIPPING,
    BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_STRING_IS_BLANK,
} from "@shared/types/blueprint/graph";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";

/** One node: id, type, params, and where it sits in the editor. */
type NodeSpec = [id: string, type: string, x: number, y: number, params?: Record<string, unknown>];
/** One wire: `node.port` to `node.port`. */
type EdgeSpec = [from: string, to: string];

function graph(nodes: readonly NodeSpec[], edges: readonly EdgeSpec[]): BlueprintGraphIr {
    return {
        nodes: Object.fromEntries(nodes.map(([id, type, x, y, params]) => [
            id,
            { id, type, params: params ?? {}, meta: { editorLayout: { x, y } } },
        ])),
        edges: edges.map(([from, to]) => {
            const [fromNode, fromPort] = from.split(".");
            const [toNode, toPort] = to.split(".");
            return { from: { nodeId: fromNode, port: fromPort }, to: { nodeId: toNode, port: toPort } };
        }),
        meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
    } as BlueprintGraphIr;
}

/** The events of one blueprint, in order: a name and a graph each. */
type EventSpec = { id: string; name: string; graph: BlueprintGraphIr };

function blueprint(id: string, name: string, owner: BlueprintOwnerRef, events: readonly EventSpec[]): Blueprint {
    return {
        id,
        name,
        owner,
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
        graphs: {
            eventIds: events.map(event => event.id),
            events: Object.fromEntries(events.map(event => [event.id, { id: event.id, name: event.name, graph: event.graph }])),
            functionIds: [],
            functions: {},
        },
    } as Blueprint;
}

/** Runs a graph's tail once on Init and again on every Flush, as the dialogue box's parts all do. */
function onEveryLine(tail: (prefix: string, y: number) => { nodes: NodeSpec[]; edges: EdgeSpec[]; entry: string }): BlueprintGraphIr {
    const appear = tail("appear", 0);
    const line = tail("line", 220);
    return graph(
        [["appearHead", BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, 0, 0], ...appear.nodes, ["lineHead", BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, 0, 220], ...line.nodes],
        [[`appearHead.then`, appear.entry], ...appear.edges, [`lineHead.then`, line.entry], ...line.edges],
    );
}

const elementRef = (id: string, surfaceId: string, elementId: string, elementType: string, x: number, y: number): NodeSpec =>
    [id, BLUEPRINT_NODE_TYPE_ELEMENT_REF, x, y, { surfaceId, elementId, elementType }];

/** Collects the blueprints of one import and files them as a blueprint document. */
export class GameUiBlueprints {
    private readonly blueprints: Blueprint[] = [];
    private counter = 0;

    private nextId(): string {
        this.counter += 1;
        return `figma-bp-${this.counter}`;
    }

    get count(): number {
        return this.blueprints.length;
    }

    /** The nametag's words: whatever the line's speaker is called, read again on every line. */
    nametagValue(surfaceId: string, elementId: string, propPath: string): string {
        const id = this.nextId();
        this.blueprints.push(blueprint(id, "Nametag", { kind: "widgetValue", surfaceId, elementId, propPath }, [{
            id: "nametag",
            name: "Show the speaker's name",
            graph: onEveryLine((p, y) => ({
                nodes: [[`${p}Name`, BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG, 260, y + 90], [`${p}Return`, BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, 520, y]],
                edges: [[`${p}Name.nametag`, `${p}Return.value`]],
                entry: `${p}Return.in`,
            })),
        }]));
        return id;
    }

    /**
     * Shows the plate behind the name only while someone speaks. The graph lives on `ownerId`, an
     * element that stays on screen, because an element a blueprint hides stops hearing Flush.
     */
    hideWithoutSpeaker(surfaceId: string, ownerId: string, plateId: string, plateType: string): void {
        this.blueprints.push(blueprint(this.nextId(), "Name plate", { kind: "widgetMain", surfaceId, elementId: ownerId }, [{
            id: "namePlate",
            name: "Show the name plate only for a speaker",
            graph: onEveryLine((p, y) => ({
                nodes: [
                    [`${p}Name`, BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG, 260, y + 90],
                    [`${p}Blank`, BLUEPRINT_NODE_TYPE_STRING_IS_BLANK, 480, y + 90],
                    [`${p}Has`, BLUEPRINT_NODE_TYPE_BOOLEAN_NOT, 680, y + 90],
                    elementRef(`${p}Plate`, surfaceId, plateId, plateType, 680, y + 160),
                    [`${p}Show`, BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY, 900, y, { property: "visible" }],
                ],
                edges: [
                    [`${p}Name.nametag`, `${p}Blank.value`],
                    [`${p}Blank.result`, `${p}Has.a`],
                    [`${p}Has.result`, `${p}Show.value`],
                    [`${p}Plate.element`, `${p}Show.element`],
                ],
                entry: `${p}Show.in`,
            })),
        }]));
    }

    /** The image shows the speaker's avatar, and nothing on a line without one. */
    speakerAvatar(surfaceId: string, elementId: string): void {
        this.blueprints.push(blueprint(this.nextId(), "Avatar", { kind: "widgetMain", surfaceId, elementId }, [{
            id: "avatar",
            name: "Show the speaker's avatar",
            graph: onEveryLine((p, y) => ({
                nodes: [[`${p}Avatar`, BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR, 260, y + 90], [`${p}Set`, BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET, 520, y]],
                edges: [[`${p}Avatar.avatar`, `${p}Set.asset`]],
                entry: `${p}Set.in`,
            })),
        }]));
    }

    /**
     * The dialogue box's own replies: Advance reads on (or brings a hidden box back), Hide hides it,
     * and Backlog opens the Log when the project has one.
     */
    dialogSurface(surfaceId: string, logPageId: string | null): void {
        const events: EventSpec[] = [
            {
                id: "advance",
                name: "Advance or restore the dialogue",
                graph: graph(
                    [
                        ["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, 0, 0, { actionId: "advance" }],
                        ["shown", BLUEPRINT_NODE_TYPE_GAME_IS_DIALOG_SHOWN, 0, 120],
                        ["branch", BLUEPRINT_NODE_TYPE_FLOW_IF, 260, 0],
                        ["next", BLUEPRINT_NODE_TYPE_GAME_NEXT, 500, -60],
                        ["show", BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG, 500, 80],
                    ],
                    [["pressed.then", "branch.in"], ["shown.isShown", "branch.condition"], ["branch.true", "next.in"], ["branch.false", "show.in"]],
                ),
            },
            {
                id: "hide",
                name: "Hide the dialogue",
                graph: graph(
                    [["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, 0, 0, { actionId: "hide" }], ["hide", BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG, 260, 0]],
                    [["pressed.then", "hide.in"]],
                ),
            },
        ];
        if (logPageId) {
            events.push({
                id: "backlog",
                name: "Open the log",
                graph: graph(
                    [["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, 0, 0, { actionId: "backlog" }], ["open", BLUEPRINT_NODE_TYPE_PAGE_GO, 260, 0, { surfaceId: logPageId }]],
                    [["pressed.then", "open.in"]],
                ),
            });
        }
        this.blueprints.push(blueprint(this.nextId(), "Dialogue", { kind: "surfaceMain", surfaceId }, events));
    }

    /** A pressed option makes that choice. */
    choiceList(surfaceId: string, elementId: string): void {
        this.blueprints.push(blueprint(this.nextId(), "Choice list", { kind: "widgetMain", surfaceId, elementId }, [{
            id: "choose",
            name: "Choose the pressed option",
            graph: graph(
                [["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK, 0, 0], ["choose", BLUEPRINT_NODE_TYPE_GAME_CHOOSE, 260, 0]],
                [["pressed.then", "choose.in"], ["pressed.index", "choose.index"]],
            ),
        }]));
    }

    /**
     * Auto or Skip turned on and off by a click. With a `selected` look the button lights while it
     * is on, and the quick menu lights it again whenever it opens (`autoLitOnOpen`).
     */
    toggle(kind: "auto" | "skip", surfaceId: string, elementId: string, elementType: string, lit: boolean): void {
        const get = kind === "auto" ? BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD : BLUEPRINT_NODE_TYPE_GAME_GET_SKIPPING;
        const set = kind === "auto" ? BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD : BLUEPRINT_NODE_TYPE_GAME_SET_SKIPPING;
        const port = kind === "auto" ? "autoForward" : "skipping";
        const nodes: NodeSpec[] = [
            ["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, 0, 0],
            ["now", get, 0, 120],
            ["flip", BLUEPRINT_NODE_TYPE_BOOLEAN_NOT, 220, 120],
            ["change", set, 440, 0],
        ];
        const edges: EdgeSpec[] = [["pressed.then", "change.in"], [`now.${port}`, "flip.a"], ["flip.result", `change.${port}`]];
        if (lit) {
            nodes.push(
                ["after", get, 440, 160],
                ["branch", BLUEPRINT_NODE_TYPE_FLOW_IF, 680, 0],
                ["light", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT, 920, -80, { variantId: "selected" }],
                elementRef("lightEl", surfaceId, elementId, elementType, 680, -140),
                ["dim", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT, 920, 100, { variantId: "default" }],
                elementRef("dimEl", surfaceId, elementId, elementType, 680, 200),
            );
            edges.push(
                ["change.next", "branch.in"],
                [`after.${port}`, "branch.condition"],
                ["branch.true", "light.in"],
                ["lightEl.element", "light.element"],
                ["branch.false", "dim.in"],
                ["dimEl.element", "dim.element"],
            );
        }
        this.blueprints.push(blueprint(this.nextId(), kind === "auto" ? "Auto" : "Skip", { kind: "widgetMain", surfaceId, elementId }, [{
            id: kind,
            name: kind === "auto" ? "Turn Auto on or off" : "Turn Skip on or off",
            graph: graph(nodes, edges),
        }]));
    }

    /** The quick menu lights its Auto and Skip buttons for what is already on when it opens. */
    quickMenuSurface(surfaceId: string, lit: ReadonlyArray<{ kind: "auto" | "skip"; elementId: string; elementType: string }>): void {
        if (lit.length === 0) {
            return;
        }
        const events: EventSpec[] = lit.map(({ kind, elementId, elementType }) => {
            const get = kind === "auto" ? BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD : BLUEPRINT_NODE_TYPE_GAME_GET_SKIPPING;
            const port = kind === "auto" ? "autoForward" : "skipping";
            return {
                id: `${kind}Lit`,
                name: kind === "auto" ? "Show whether Auto is on" : "Show whether Skip is on",
                graph: graph(
                    [
                        ["opened", BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT, 0, 0],
                        ["read", get, 0, 120],
                        ["branch", BLUEPRINT_NODE_TYPE_FLOW_IF, 260, 0],
                        ["light", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT, 500, -80, { variantId: "selected" }],
                        elementRef("lightEl", surfaceId, elementId, elementType, 260, -140),
                        ["dim", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT, 500, 100, { variantId: "default" }],
                        elementRef("dimEl", surfaceId, elementId, elementType, 260, 200),
                    ],
                    [
                        ["opened.then", "branch.in"],
                        [`read.${port}`, "branch.condition"],
                        ["branch.true", "light.in"],
                        ["lightEl.element", "light.element"],
                        ["branch.false", "dim.in"],
                        ["dimEl.element", "dim.element"],
                    ],
                ),
            };
        });
        this.blueprints.push(blueprint(this.nextId(), "Quick menu", { kind: "surfaceMain", surfaceId }, events));
    }

    /** A click opens one of the project's pages. */
    openPage(name: string, surfaceId: string, elementId: string, pageId: string): void {
        this.blueprints.push(blueprint(this.nextId(), name, { kind: "widgetMain", surfaceId, elementId }, [{
            id: "open",
            name: `Open the ${name} page`,
            graph: graph(
                [["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, 0, 0], ["open", BLUEPRINT_NODE_TYPE_PAGE_GO, 260, 0, { surfaceId: pageId }]],
                [["pressed.then", "open.in"]],
            ),
        }]));
    }

    /** A click hides the dialogue box, or brings it back. */
    toggleDialog(surfaceId: string, elementId: string): void {
        this.blueprints.push(blueprint(this.nextId(), "Hide", { kind: "widgetMain", surfaceId, elementId }, [{
            id: "hide",
            name: "Hide or show the dialogue box",
            graph: graph(
                [["pressed", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, 0, 0], ["toggle", BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY, 260, 0]],
                [["pressed.then", "toggle.in"]],
            ),
        }]));
    }

    /** The blueprints as the document the import takes, or null when there are none. */
    document(): BlueprintDocument | null {
        if (this.blueprints.length === 0) {
            return null;
        }
        return {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: Object.fromEntries(this.blueprints.map(entry => [entry.id, entry])),
            ownerRecords: Object.fromEntries(this.blueprints.map(entry => [encodeBlueprintOwnerKey(entry.owner), { blueprintId: entry.id }])),
        };
    }
}

/**
 * The input actions the dialogue box answers, as the starter project declares them. They travel with
 * the imported box so a project without them gains them; a project that has them keeps its own.
 */
export const DIALOG_INPUT_ACTIONS: Record<string, UIInputActionDef> = {
    advance: {
        id: "advance",
        name: "Advance",
        bindings: [
            { kind: "pointer", gesture: "click" },
            { kind: "key", key: "Space" },
            { kind: "key", key: "Enter" },
            { kind: "gamepad", button: "A" },
        ],
    },
    backlog: {
        id: "backlog",
        name: "Backlog",
        bindings: [{ kind: "pointer", gesture: "wheelUp" }, { kind: "gamepad", button: "LB" }],
    },
    hide: {
        id: "hide",
        name: "Hide",
        bindings: [{ kind: "pointer", gesture: "longPress" }],
    },
} as Record<string, UIInputActionDef>;
