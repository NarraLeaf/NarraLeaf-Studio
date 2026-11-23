/**
 * What the importer will make of a frame, as a checklist the designer reads before exporting.
 *
 * Bundled into the Figma plugin (`tools/figma-plugin`), which runs it on the frame it would export
 * and shows each entry with a way to select the layer it names. Everything here is read through
 * `gameUiReading.ts`, as the converter reads it, so the list says what the import will do rather
 * than what a second set of rules thinks it might.
 *
 * Entries carry codes and layer names, not sentences: the plugin words them in its own language.
 *
 * Comments in English per project convention.
 */

import type { FigmaExportNode } from "./figmaExportFormat";
import { isMarked, type GameUiSlot, type QuickMenuAction } from "./gameUiRoles";
import {
    absoluteBox,
    canBeAvatar,
    childrenOf,
    gameUiPartsOf,
    insideButtons,
    layerName,
    listOptionsOf,
    partLayers,
    readButton,
    readDialog,
    readQuickMenu,
} from "./gameUiReading";

/**
 * How a job was found. `marked`: the layer carries the plugin's mark. `named`: its name says so.
 * `guessed`: neither, and the importer picked it by position. `missing`: nothing does the job.
 */
export type ChecklistStatus = "marked" | "named" | "guessed" | "missing";

export type ChecklistLayer = { id: string; name: string };

export type ChecklistEntry =
    | { kind: "sentence" | "name"; status: ChecklistStatus; layer: ChecklistLayer | null }
    /** `unusable`: a layer is marked or named as the face, but is not a picture or a plain shape. */
    | { kind: "avatar"; status: ChecklistStatus | "unusable"; layer: ChecklistLayer | null }
    /** The options of a choice menu or the messages of a notification stack; the first is the row drawn. */
    | { kind: "rows"; status: "named" | "missing"; count: number; layer: ChecklistLayer | null }
    /** A quick-menu button. `lit`: for Auto and Skip, whether the button has a look for while it is on. */
    | { kind: "button"; status: "marked" | "named"; action: QuickMenuAction; layer: ChecklistLayer; lit?: boolean }
    /** A quick menu in which no button was recognised. */
    | { kind: "noButtons"; status: "missing" }
    /** A group drawn as a button in states, which also holds layers a button cannot. */
    | { kind: "mixedButton"; status: "missing"; layer: ChecklistLayer };

export type ChecklistPart = {
    slot: GameUiSlot;
    layer: ChecklistLayer;
    /** Whether the slot came from a mark rather than from the name. */
    marked: boolean;
    /** Another part of the frame already fills this slot, so this one is not imported. */
    duplicate: boolean;
    entries: ChecklistEntry[];
};

export type FrameChecklist = {
    frame: ChecklistLayer;
    /** Empty when the frame imports as a page. */
    parts: ChecklistPart[];
    /** Layers of a game-screen frame that belong to no part - the background, the sprites - and stay out. */
    leftOut: ChecklistLayer[];
};

const layerOf = (node: FigmaExportNode): ChecklistLayer => ({ id: String(node.id), name: layerName(node.name) });

const statusOf = (node: FigmaExportNode, guessed: boolean): ChecklistStatus => (guessed ? "guessed" : isMarked(node) ? "marked" : "named");

/** The checklist for one frame of the design. */
export function checkFrame(frame: FigmaExportNode): FrameChecklist {
    const parts = gameUiPartsOf(frame);
    const taken = new Set(parts.map(part => part.node));
    const leftOut = parts.length > 0 && !parts[0].whole
        ? childrenOf(frame).filter(child => !taken.has(child)).map(layerOf)
        : [];
    const seen = new Set<GameUiSlot>();
    return {
        frame: layerOf(frame),
        leftOut,
        parts: parts.map(part => {
            const duplicate = seen.has(part.slot);
            seen.add(part.slot);
            const layers = partLayers(part, parts);
            return {
                slot: part.slot,
                layer: layerOf(part.node),
                marked: isMarked(part.node),
                duplicate,
                entries: duplicate ? [] : entriesOf(part.slot, part.whole, part.node, layers),
            };
        }),
    };
}

function entriesOf(slot: GameUiSlot, whole: boolean, node: FigmaExportNode, layers: readonly FigmaExportNode[]): ChecklistEntry[] {
    if (!whole && node.kind !== "group" && node.kind !== "frame") {
        // A single picture named for a slot: drawn as it is, with nothing in it to wire.
        return [];
    }
    const swallowed = insideButtons(layers);
    // A layer a button swallows (its looks, its label) is not an element the import can give a job to.
    const usable = (layer: FigmaExportNode) => !swallowed.has(layer);
    const mixed: ChecklistEntry[] = [];
    const findMixed = (list: readonly FigmaExportNode[]) => list.forEach(layer => {
        if (swallowed.has(layer)) return;
        if (readButton(layer) === "mixed") mixed.push({ kind: "mixedButton", status: "missing", layer: layerOf(layer) });
        findMixed(childrenOf(layer));
    });
    findMixed(layers);

    if (slot === "dialog") {
        const reading = readDialog(layers, usable);
        const entries: ChecklistEntry[] = [
            {
                kind: "sentence",
                status: reading.sentence ? statusOf(reading.sentence, reading.sentenceGuessed) : "missing",
                layer: reading.sentence ? layerOf(reading.sentence) : null,
            },
            {
                kind: "name",
                status: reading.name ? statusOf(reading.name, reading.nameGuessed) : "missing",
                layer: reading.name ? layerOf(reading.name) : null,
            },
            {
                kind: "avatar",
                status: !reading.avatar ? "missing" : canBeAvatar(reading.avatar) ? statusOf(reading.avatar, false) : "unusable",
                layer: reading.avatar ? layerOf(reading.avatar) : null,
            },
        ];
        return [...entries, ...mixed];
    }

    if (slot === "choice" || slot === "notification") {
        const options = listOptionsOf(layers, layer => absoluteBox(layer).y);
        return [{ kind: "rows", status: options.length > 0 ? "named" : "missing", count: options.length, layer: options[0] ? layerOf(options[0]) : null }];
    }

    const buttons = readQuickMenu(layers, usable);
    if (buttons.length === 0) {
        return [{ kind: "noButtons", status: "missing" }, ...mixed];
    }
    return [
        ...buttons.map(({ action, node: button }): ChecklistEntry => {
            const shape = readButton(button);
            const entry: ChecklistEntry = { kind: "button", status: isMarked(button) ? "marked" : "named", action, layer: layerOf(button) };
            if (action === "auto" || action === "skip") {
                entry.lit = shape !== null && shape !== "mixed" && Boolean(shape.states.selected);
            }
            return entry;
        }),
        ...mixed,
    ];
}
