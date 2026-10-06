/**
 * The two ends of a wire on the blueprint canvas, and the words the canvas names them with.
 *
 * A wire is drawn between two pins, and on a graph wider than the screen one of them is often off
 * it. Hovering a wire names the end the pointer is away from, and the wire's and a pin's context
 * menus offer to go there; both need the same three answers - which pins a wire joins, which of its
 * ends is the far one, and what the author calls the node and pin at that end - so they are worked
 * out here, away from the canvas, where they can be tested without one. The wire's accessible name
 * is built from the same words.
 *
 * Names are the ones the card itself shows: the node's title in the interface language, what the card
 * says under it (the element it is bound to, the value in its first field), and the pin's label.
 * Nothing here ever falls back to an id - a pin with no label is named by its node alone, and a node
 * the editor does not know is called unknown, as its card is.
 */

import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { UseTranslation } from "@/lib/i18n";
import { BLUEPRINT_SCENE_VARIABLE_OPTIONS_SOURCE } from "@/lib/ui-editor/blueprint-nodes/built-in/storyVariableNodes";
import { resolveBlueprintLabel, resolveBlueprintNodeTitle } from "../blueprintNodeI18n";

type Translate = UseTranslation["t"];

/** Which side of its card a pin sits on: inputs on the left, outputs on the right. */
export type BlueprintPinSide = "input" | "output";

/**
 * Written on a card's pin row - the dot and its label - so a right click anywhere on the row can be
 * told apart from one on the rest of the card, and the node menu can offer that pin's wires.
 */
export const BLUEPRINT_PIN_ATTRIBUTE = "data-blueprint-pin";
export const BLUEPRINT_PIN_SIDE_ATTRIBUTE = "data-blueprint-pin-side";

/** The pin row a DOM event landed on, inside the card of `nodeId`; null when it landed elsewhere. */
export function readBlueprintPinAt(target: EventTarget | null, nodeId: string): BlueprintWireEnd | null {
    if (!target || typeof (target as Element).closest !== "function") {
        return null;
    }
    const row = (target as Element).closest(`[${BLUEPRINT_PIN_ATTRIBUTE}]`);
    const pinId = row?.getAttribute(BLUEPRINT_PIN_ATTRIBUTE);
    const side = row?.getAttribute(BLUEPRINT_PIN_SIDE_ATTRIBUTE);
    if (!row || !pinId || (side !== "input" && side !== "output")) {
        return null;
    }
    // A pin row belongs to the card it sits in; one met on the way up from somewhere else is not this node's.
    const card = row.closest(".react-flow__node");
    if (card && card.getAttribute("data-id") !== nodeId) {
        return null;
    }
    return { nodeId, pinId, side };
}

/** One end of a wire: the node, the pin on it, and which side of the card that pin is on. */
export type BlueprintWireEnd = { nodeId: string; pinId: string; side: BlueprintPinSide };

/** The wire as React Flow hands it to an event: an output (`source`) wired to an input (`target`). */
export type BlueprintFlowWire = {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
};

/** Both ends of a wire, output first. */
export function blueprintWireEnds(wire: BlueprintFlowWire): { source: BlueprintWireEnd; target: BlueprintWireEnd } {
    return {
        source: { nodeId: wire.source, pinId: wire.sourceHandle ?? "", side: "output" },
        target: { nodeId: wire.target, pinId: wire.targetHandle ?? "", side: "input" },
    };
}

type Point = { x: number; y: number };

/**
 * The end of a wire the point is further from.
 *
 * Straight-line distance to each pin rather than position along the curve: the far end is the one
 * the author cannot see from where they are pointing, and a wire that doubles back on itself is
 * still nearest the pin it leaves from at the place it leaves. A point exactly halfway names the
 * input, the end the run of the graph is heading for.
 */
export function pickFarBlueprintWireEnd(point: Point, source: Point, target: Point): "source" | "target" {
    const toSource = Math.hypot(point.x - source.x, point.y - source.y);
    const toTarget = Math.hypot(point.x - target.x, point.y - target.y);
    return toSource > toTarget ? "source" : "target";
}

/**
 * Every wire on one pin, each given as the end at its other side, in the order the graph lists them.
 *
 * An output can feed any number of inputs; an input is fed by one wire, but a document written by
 * hand may hold more, and each of those is still a wire the author can see and may want to follow.
 */
export function listBlueprintPinConnections(ir: BlueprintGraphIr, end: BlueprintWireEnd): BlueprintWireEnd[] {
    const out: BlueprintWireEnd[] = [];
    for (const edge of ir.edges ?? []) {
        if (end.side === "output" && edge.from.nodeId === end.nodeId && edge.from.port === end.pinId) {
            out.push({ nodeId: edge.to.nodeId, pinId: edge.to.port, side: "input" });
        } else if (end.side === "input" && edge.to.nodeId === end.nodeId && edge.to.port === end.pinId) {
            out.push({ nodeId: edge.from.nodeId, pinId: edge.from.port, side: "output" });
        }
    }
    return out;
}

type NamedOption = { value: string; name: string };

/** What naming a node needs from its card. */
export type BlueprintWireEndCard = {
    catalog: {
        displayName: string;
        unknown?: boolean;
        role?: string;
        pins: readonly { id: string; kind: string; label?: string }[];
        inspectorParams?: readonly {
            key: string;
            kind: string;
            options?: readonly { value: string; label: string }[];
            dynamicOptionsSource?: string;
        }[];
    };
    params?: Record<string, unknown>;
    elementPreview?: { name?: string } | null;
    dynamicSelectOptions?: Record<string, readonly { value: string; label: string }[]>;
    memberVariables?: readonly NamedOption[];
    persistentVariables?: readonly NamedOption[];
    savedVariables?: readonly NamedOption[];
};

/**
 * The node and pin at one end of a wire, as the author reads them. `detail` is what the card shows
 * under its title, when it shows something; `pin` is absent for an unlabelled pin.
 */
export type BlueprintWireEndName = { node: string; detail?: string; pin?: string };

/** Longer than this and a detail is cut: it is there to tell two cards apart, not to quote them. */
const MAX_DETAIL_LENGTH = 24;

/** Text that is an id however it got there; the interface shows none. */
const LOOKS_LIKE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

function shortDetail(text: string | undefined): string | undefined {
    const trimmed = text?.trim();
    if (!trimmed || LOOKS_LIKE_ID.test(trimmed)) {
        return undefined;
    }
    return trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}…` : trimmed;
}

/**
 * What a card says about itself under its title: the element an element card is bound to, or the
 * value showing in the card's first field - the action an input event listens for, the name of a
 * function, the property a node sets. Two cards with the same title on one graph are told apart by
 * exactly this when they sit side by side, and a list of the wires on a pin needs the same telling.
 *
 * Only what the card would print is read back: an option's label, a variable's name, a short line of
 * text. A value with no name to show - an unset field, an option that has gone - gives no detail.
 */
function readCardDetail(card: BlueprintWireEndCard, t: Translate): string | undefined {
    const role = card.catalog.role;
    if (role === "elementLiteral" || role === "elementEventHead") {
        return shortDetail(card.elementPreview?.name);
    }
    const field = card.catalog.inspectorParams?.[0];
    const raw = field ? card.params?.[field.key] : undefined;
    if (!field || typeof raw !== "string" || raw === "") {
        return undefined;
    }
    switch (field.kind) {
        case "select": {
            const options = field.options ?? (field.dynamicOptionsSource ? card.dynamicSelectOptions?.[field.dynamicOptionsSource] : undefined);
            const option = options?.find(candidate => candidate.value === raw);
            return option ? shortDetail(resolveBlueprintLabel(option.label, t)) : undefined;
        }
        case "string":
            return shortDetail(raw);
        case "variableRef":
            return shortDetail(card.memberVariables?.find(variable => variable.value === raw)?.name);
        case "persistentVariableRef":
            return shortDetail(card.persistentVariables?.find(variable => variable.value === raw)?.name);
        case "savedVariableRef":
            return shortDetail(card.savedVariables?.find(variable => variable.value === raw)?.name);
        case "sceneVariableRef":
            return shortDetail(
                card.dynamicSelectOptions?.[BLUEPRINT_SCENE_VARIABLE_OPTIONS_SOURCE]?.find(option => option.value === raw)?.label,
            );
        default:
            return undefined;
    }
}

/**
 * What the canvas calls the node and pin at `end`.
 *
 * `card` is the node as the canvas drew it, or undefined for one the canvas has not got - a wire
 * left pointing at a node that is gone, which the card would have nothing to say about either.
 */
export function describeBlueprintWireEnd(
    card: BlueprintWireEndCard | undefined,
    end: BlueprintWireEnd,
    t: Translate,
): BlueprintWireEndName {
    if (!card || card.catalog.unknown) {
        return { node: t("blueprint.canvas.unknownNode") };
    }
    const node = resolveBlueprintNodeTitle(card.catalog.displayName, t);
    const detail = readCardDetail(card, t);
    const kind = end.side === "output" ? "output" : "input";
    const label = card.catalog.pins.find(pin => pin.id === end.pinId && pin.kind === kind)?.label?.trim();
    return {
        node,
        ...(detail ? { detail } : {}),
        ...(label ? { pin: resolveBlueprintLabel(label, t) } : {}),
    };
}

/**
 * Which of a list of names need a number to be told apart: for each name, its place among the names
 * equal to it (from 1), or null when it is the only one.
 *
 * A pin can be wired to several cards that read exactly alike - seven Log nodes fed by one value -
 * and a menu of seven identical rows reads as one row repeated by mistake. Numbered in the order the
 * list is in, which the caller makes the order the cards sit in on the graph.
 */
export function numberRepeatedNames(names: readonly string[]): (number | null)[] {
    const totals = new Map<string, number>();
    for (const name of names) {
        totals.set(name, (totals.get(name) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return names.map(name => {
        if ((totals.get(name) ?? 0) < 2) {
            return null;
        }
        const index = (seen.get(name) ?? 0) + 1;
        seen.set(name, index);
        return index;
    });
}

/** One line for a named end: the node with what its card says about itself, then the pin. */
export function formatBlueprintWireEnd(name: BlueprintWireEndName, t: Translate): string {
    const node = name.detail ? t("blueprint.wire.nodeDetail", { node: name.node, detail: name.detail }) : name.node;
    return name.pin ? t("blueprint.wire.end", { node, pin: name.pin }) : node;
}

/**
 * A wire's accessible name: both of its ends, output first, in the words their cards use.
 *
 * Written onto the wire so a screen reader reading the canvas hears what the author sees. Left to
 * itself React Flow names every wire `Edge from <id> to <id>`, which reads out node ids - and the
 * ids of cards an author placed are generated ones. `cardOf` answers for the cards on the canvas;
 * an end it has no card for is named the way the tooltip names one, as an unknown node.
 */
export function nameBlueprintWire(
    wire: BlueprintFlowWire,
    cardOf: (nodeId: string) => BlueprintWireEndCard | undefined,
    t: Translate,
): string {
    const { source, target } = blueprintWireEnds(wire);
    return t("blueprint.wire.name", {
        from: formatBlueprintWireEnd(describeBlueprintWireEnd(cardOf(source.nodeId), source, t), t),
        to: formatBlueprintWireEnd(describeBlueprintWireEnd(cardOf(target.nodeId), target, t), t),
    });
}
