/**
 * Reading a design the way the importer will: which parts fill which Game UI slot, which layer is
 * the line, the speaker's name and the face, which layers are buttons drawn in states, what the
 * quick menu's buttons do.
 *
 * Two readers share this. The converter acts on it, and the Figma plugin shows it to the designer
 * as a checklist before anything is exported (`gameUiChecklist.ts`, bundled into the plugin). Both
 * must read a design the same way, or the checklist would promise what the import does not do - so
 * every decision about what a layer is lives here, and the converter keeps only what it builds.
 *
 * Pure, and free of anything the plugin's sandbox cannot run: only type imports leave this folder.
 *
 * Comments in English per project convention.
 */

import { buttonStateOfName, type ButtonState } from "./buttonStates";
import { dialogPartOf, gameUiSlotOf, quickMenuActionOf, type GameUiSlot, type QuickMenuAction } from "./gameUiRoles";
import type { FigmaExportNode, FigmaMatrix } from "./figmaExportFormat";
import { IDENTITY_MATRIX, placeInParent } from "./figmaGeometry";

const MAX_NAME_LENGTH = 80;

export const childrenOf = (node: FigmaExportNode): FigmaExportNode[] => (Array.isArray(node.children) ? node.children : []);

/** A layer's name as Studio shows it: one line, and not endless. */
export function layerName(raw: unknown): string {
    const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    return text.length > MAX_NAME_LENGTH ? text.slice(0, MAX_NAME_LENGTH) : text;
}

export function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function matrixOf(raw: unknown): FigmaMatrix {
    if (
        Array.isArray(raw)
        && raw.length === 2
        && raw.every(row => Array.isArray(row) && row.length === 3 && row.every(value => typeof value === "number" && Number.isFinite(value)))
    ) {
        return raw as FigmaMatrix;
    }
    return IDENTITY_MATRIX;
}

/** A layer's box on the page, before scaling. */
export function absoluteBox(node: FigmaExportNode): { x: number; y: number; width: number; height: number } {
    return placeInParent({ transform: matrixOf(node.transform), width: num(node.width, 0), height: num(node.height, 0) }, IDENTITY_MATRIX);
}

export const areaOf = (node: FigmaExportNode): number => num(node.width, 0) * num(node.height, 0);

/** Every layer under `nodes`, depth first, with the layer each sits in. */
export function walkLayers(
    nodes: readonly FigmaExportNode[],
    parent: FigmaExportNode | null,
    visit: (node: FigmaExportNode, parent: FigmaExportNode | null) => void,
): void {
    for (const node of nodes) {
        visit(node, parent);
        walkLayers(childrenOf(node), node, visit);
    }
}

// ---------------------------------------------------------------------------
// Buttons drawn in states
// ---------------------------------------------------------------------------

export type ButtonShape = {
    /** The look of each state the source has. `default` is always present. */
    states: Partial<Record<ButtonState, FigmaExportNode>>;
    /** The text that becomes the button's label, taken from the placed button. */
    label: FigmaExportNode | null;
    /** Each state's own text, when the states are variants that restyle it. */
    labels: Partial<Record<ButtonState, FigmaExportNode>>;
};

/** A look a state can be: a picture, a shape, or a frame drawn by its own fill and stroke. */
function isStateLook(node: FigmaExportNode): boolean {
    return node.kind === "raster" || node.kind === "shape" || node.kind === "ellipse"
        || ((node.kind === "frame" || node.kind === "group") && childrenOf(node).length === 0);
}

/**
 * Whether a node is a button drawn in states, and its states if so; `"mixed"` when it has states
 * but also layers a button cannot hold, which the importer reports by name.
 *
 * Two shapes are read. An instance of a Figma component set whose variants differ in a state
 * property; each variant may hold at most one text, the label. Or a group or frame whose children are
 * named for states (`normal`, `hover` ... in any language `buttonStates.ts` reads), with at most one
 * text beside them. Either needs a default look and at least one other.
 */
export function readButton(node: FigmaExportNode): ButtonShape | "mixed" | null {
    if (node.variantValue && Array.isArray(node.variants) && node.variants.length > 0) {
        const own = buttonStateOfName(node.variantValue);
        if (!own) {
            return null;
        }
        const states: ButtonShape["states"] = { [own]: node };
        for (const variant of node.variants) {
            const state = buttonStateOfName(variant.value);
            if (state && !states[state]) {
                states[state] = variant.node;
            }
        }
        if (!states.default || Object.keys(states).length < 2) {
            return null;
        }
        const looks = Object.values(states) as FigmaExportNode[];
        if (looks.some(look => childrenOf(look).some(child => child.kind !== "text") || childrenOf(look).length > 1)) {
            return "mixed";
        }
        const labels: ButtonShape["labels"] = {};
        for (const [state, look] of Object.entries(states) as [ButtonState, FigmaExportNode][]) {
            const text = childrenOf(look)[0];
            if (text) labels[state] = text;
        }
        return { states, label: childrenOf(node)[0] ?? null, labels };
    }

    if (node.kind !== "group" && node.kind !== "frame") {
        return null;
    }
    const states: ButtonShape["states"] = {};
    let label: FigmaExportNode | null = null;
    let others = 0;
    for (const child of childrenOf(node)) {
        const state = buttonStateOfName(child.name);
        if (state && !states[state] && isStateLook(child)) {
            states[state] = child;
        } else if (child.kind === "text" && !label) {
            label = child;
        } else {
            others += 1;
        }
    }
    if (!states.default || Object.keys(states).length < 2) {
        return null;
    }
    return others > 0 ? "mixed" : { states, label, labels: {} };
}

/**
 * The layers under `nodes` that are not elements of their own because a button drawn in states
 * swallows them: its looks and its label. What is left is what the import places one by one.
 */
export function insideButtons(nodes: readonly FigmaExportNode[]): Set<FigmaExportNode> {
    const inside = new Set<FigmaExportNode>();
    const visit = (node: FigmaExportNode, swallowed: boolean): void => {
        if (swallowed) inside.add(node);
        const button = swallowed ? null : readButton(node);
        const swallows = swallowed || (button !== null && button !== "mixed");
        childrenOf(node).forEach(child => visit(child, swallows));
    };
    nodes.forEach(node => visit(node, false));
    return inside;
}

// ---------------------------------------------------------------------------
// Game UI parts
// ---------------------------------------------------------------------------

/** What a frame of the design becomes. */
export type DesignFrameTarget = "page" | "gameUi";

/** One part of a game-screen design that becomes the Game UI of a slot. */
export type GameUiPart = {
    slot: GameUiSlot;
    node: FigmaExportNode;
    /** The frame itself is the part: its layers go straight onto the Game UI, its own fill does not. */
    whole: boolean;
};

/**
 * The parts of a frame that fill Game UI slots, in the order they are drawn.
 *
 * A frame marked or named for a slot is that slot's Game UI on its own. Otherwise each top-level
 * group marked or named for a slot is one, and so is one for another slot directly inside one of
 * those - the quick menu drawn on the dialogue band is the quick menu, not a part of the box. The
 * first part of a slot is the one that counts; the rest are reported.
 */
export function gameUiPartsOf(frame: FigmaExportNode): GameUiPart[] {
    const own = gameUiSlotOf(frame);
    const named = (node: FigmaExportNode, except: GameUiSlot | null): GameUiPart[] =>
        childrenOf(node).flatMap(child => {
            if (child.kind === "text") return [];
            const slot = gameUiSlotOf(child);
            return slot && slot !== except ? [{ slot, node: child, whole: false }] : [];
        });
    if (own) {
        return [{ slot: own, node: frame, whole: true }, ...named(frame, own)];
    }
    return named(frame, null).flatMap(part => [part, ...named(part.node, part.slot)]);
}

/** What a frame becomes when the author has not said: Game UI when any of it is marked or named for a slot. */
export function detectFrameTarget(frame: FigmaExportNode): DesignFrameTarget {
    return gameUiPartsOf(frame).length > 0 ? "gameUi" : "page";
}

/** The layers of a part, without the parts nested in it. */
export function partLayers(part: GameUiPart, parts: readonly GameUiPart[]): FigmaExportNode[] {
    const nested = new Set(parts.map(entry => entry.node));
    return childrenOf(part.node).filter(child => !nested.has(child));
}

// ---------------------------------------------------------------------------
// The dialogue box
// ---------------------------------------------------------------------------

export type DialogReading = {
    sentence: FigmaExportNode | null;
    /** The line was not marked or named, and was taken to be the largest text. */
    sentenceGuessed: boolean;
    name: FigmaExportNode | null;
    /** The name was not marked or named, and was taken to be the text just above the line. */
    nameGuessed: boolean;
    /** The layer the name sits in, when that is a layer of its own inside the box: shown only while someone speaks. */
    plate: FigmaExportNode | null;
    avatar: FigmaExportNode | null;
};

/**
 * Which of the box's layers are the line, the speaker's name and the face. A part is found by its
 * mark or name; when the line or the name is neither, the largest text is taken for the line and the
 * text just above it for the name. `usable` says whether a layer is an element the importer can give
 * the job to (a text inside a button is the button's label, not a text).
 */
export function readDialog(children: readonly FigmaExportNode[], usable: (node: FigmaExportNode) => boolean): DialogReading {
    const texts: FigmaExportNode[] = [];
    const parents = new Map<FigmaExportNode, FigmaExportNode | null>();
    let avatar: FigmaExportNode | null = null;
    walkLayers(children, null, (node, parent) => {
        parents.set(node, parent);
        if (!usable(node)) return;
        if (node.kind === "text") {
            texts.push(node);
        } else if (!avatar && dialogPartOf(node) === "avatar") {
            avatar = node;
        }
    });
    const largest = (list: readonly FigmaExportNode[]): FigmaExportNode | null =>
        list.reduce<FigmaExportNode | null>((best, node) => (!best || areaOf(node) > areaOf(best) ? node : best), null);

    let sentence = largest(texts.filter(node => dialogPartOf(node) === "sentence"));
    let sentenceGuessed = false;
    if (!sentence) {
        sentence = largest(texts.filter(node => dialogPartOf(node) !== "name"));
        sentenceGuessed = sentence !== null;
    }

    let name = texts.find(node => node !== sentence && dialogPartOf(node) === "name") ?? null;
    let nameGuessed = false;
    if (!name && sentence) {
        const line = absoluteBox(sentence);
        const bottom = (node: FigmaExportNode) => {
            const box = absoluteBox(node);
            return box.y + box.height;
        };
        const above = texts.filter(node => node !== sentence && bottom(node) <= line.y + 4 && areaOf(node) < areaOf(sentence!));
        name = above.reduce<FigmaExportNode | null>((best, node) => (!best || bottom(node) > bottom(best) ? node : best), null);
        nameGuessed = name !== null;
    }
    return { sentence, sentenceGuessed, name, nameGuessed, plate: name ? parents.get(name) ?? null : null, avatar };
}

/** Whether a layer can show the speaker's face: a picture, or a shape that becomes an empty image. */
export function canBeAvatar(node: FigmaExportNode): boolean {
    return node.kind === "raster" || node.kind === "shape" || node.kind === "ellipse"
        || ((node.kind === "frame" || node.kind === "group") && childrenOf(node).length === 0);
}

// ---------------------------------------------------------------------------
// Lists and the quick menu
// ---------------------------------------------------------------------------

/** The words a layer shows: its own, or the first text inside it. */
export function wordsOf(node: FigmaExportNode): string {
    if (node.kind === "text") {
        return typeof node.text?.characters === "string" ? node.text.characters : "";
    }
    for (const child of childrenOf(node)) {
        const words = wordsOf(child);
        if (words) return words;
    }
    return "";
}

/**
 * The options drawn in a choice menu or a stack of notifications: each a text, or a group or frame
 * holding one, top to bottom by `top`. The first is the row every item is drawn from.
 */
export function listOptionsOf(children: readonly FigmaExportNode[], top: (node: FigmaExportNode) => number): FigmaExportNode[] {
    const hasText = (node: FigmaExportNode): boolean => node.kind === "text" || childrenOf(node).some(hasText);
    return children
        .filter(child => child.kind === "text" || ((child.kind === "group" || child.kind === "frame") && hasText(child)))
        .sort((a, b) => top(a) - top(b));
}

/**
 * The quick menu's buttons and what each does, by mark or name. The outermost layer with such a
 * name is the button - a group named `Auto` holding a picture and a text is one button, not two.
 */
export function readQuickMenu(
    children: readonly FigmaExportNode[],
    usable: (node: FigmaExportNode) => boolean,
): { action: QuickMenuAction; node: FigmaExportNode }[] {
    const out: { action: QuickMenuAction; node: FigmaExportNode }[] = [];
    const visit = (node: FigmaExportNode): void => {
        const action = quickMenuActionOf(node);
        if (action && usable(node)) {
            out.push({ action, node });
        } else {
            childrenOf(node).forEach(visit);
        }
    };
    children.forEach(visit);
    return out;
}
