/**
 * How big a blueprint card is and where its pins sit, worked out from the node's definition.
 *
 * The canvas formats a graph from cards it has measured. The command line has no canvas, so it
 * formats from this instead - and the two only agree if this draws the same card the canvas does.
 * It follows `BlueprintFlowNode`'s card row for row: a header with the category and the title, the
 * fields the card shows under them, then one row per pin pair, inputs down the left and outputs down
 * the right, a row as tall as the taller of its two cells. The constants are measured off the
 * editor's own cards, at the default zoom, and are what has to change if the card's styles do.
 *
 * Heights are exact for every card the shipped skeleton holds. Widths depend on text, and the text
 * depends on the interface language, so a width is estimated from the widest of the three
 * languages' labels and rounded up rather than down: a card the layout thinks is wider than it is
 * leaves a little more room than needed, while one it thinks is narrower would overlap its
 * neighbour.
 *
 * Comments in English per project convention.
 */

import { createTranslator, type LocaleCode } from "@shared/i18n";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintInspectorParamKind,
    type BlueprintNodeEditorCatalogEntry,
} from "@/lib/ui-editor/blueprint-nodes/types";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import type { BlueprintLayoutPin } from "@/apps/workspace/modules/blueprint-lite/flow/blueprintAutoLayout";

/** Measured off the editor's cards. */
const CARD = {
    minWidth: 200,
    maxWidth: 280,
    /** Top border, the category and title, and the line under them. */
    header: 44.6,
    /** The padding above the first pin row and below the last. */
    pinPadding: 6,
    /** Bottom border. */
    bottom: 0.8,
    /** A pin row, and the gap between two rows. */
    row: 20,
    rowGap: 2,
    /** A row whose pin is opened into a field for its value: a text or number box, or a yes/no menu. */
    literalRow: 21.6,
    literalBooleanRow: 28,
    /** The dashed "add a pin" or "edit save fields" button that takes a row of its own. */
    buttonRow: 30,
    /** An Element card: its header, the element's preview and the output under it. */
    elementHeight: 211,
    elementFirstPin: 194.2,
    /** An Element card is as wide as the element's name needs; most names fit in this. */
    elementWidth: 210,
} as const;

/** What one field shown on the card adds to its header. */
const FIELD_HEIGHT: Partial<Record<BlueprintInspectorParamKind, number>> = {
    select: 58.8,
    variableRef: 58.8,
    persistentVariableRef: 58.8,
    savedVariableRef: 58.8,
    sceneVariableRef: 58.8,
    audioAsset: 56.4,
    string: 58.8,
    number: 58.8,
    literal: 58.8,
    keyboardBinding: 58.8,
    buttonCursor: 58.8,
    color: 58.8,
    json: 58.8,
    imageAsset: 58.8,
};
const DEFAULT_FIELD_HEIGHT = 58.8;

/** The cards whose header holds a panel of their own instead of the generic fields. */
const CUSTOM_HEADER: Record<string, number> = {
    [BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT]: 130.8,
    [BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT]: 130.8,
    [BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY]: 110.8,
    [BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY]: 110.8,
    [BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY]: 58.8,
    [BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY]: 58.8,
    [BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY]: 200,
    [BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY]: 200,
};

/** Text widths at the card's two sizes, per character: wide for CJK, narrow otherwise. */
const TEXT = {
    small: { wide: 10.5, narrow: 6 },
    title: { wide: 12.5, narrow: 7 },
} as const;

const LOCALES: readonly LocaleCode[] = ["en", "zh", "ja"];

/**
 * No card is drawn narrower than this. Widths here are estimates rounded up, so where a question
 * needs a card's smallest possible extent - does an author's frame hold it - this is the width to ask with.
 */
export const BLUEPRINT_CARD_NARROWEST = CARD.minWidth;

export type BlueprintCardGeometry = {
    width: number;
    height: number;
    pins: BlueprintLayoutPin[];
};

type Cell = { pin?: { id: string; side: "in" | "out"; kind: "exec" | "data" }; height: number; width: number };

/**
 * The card a node draws: its size and its pins' centres from its top edge.
 *
 * `wiredInputs` matters because an input whose value is typed into the card is only drawn as a
 * field while nothing is wired into it.
 */
export function blueprintCardGeometry(
    entry: BlueprintNodeEditorCatalogEntry,
    params: Readonly<Record<string, unknown>>,
    wiredInputs: ReadonlySet<string>,
): BlueprintCardGeometry {
    const outputs = entry.pins.filter(pin => pin.kind === "output");
    if (entry.role === "elementLiteral" || entry.role === "elementEventHead") {
        return {
            width: CARD.elementWidth,
            height: CARD.elementHeight + (CARD.row + CARD.rowGap) * Math.max(0, outputs.length - 1),
            pins: outputs.map((pin, index) => ({
                id: pin.id,
                side: "out",
                kind: pin.semantic,
                offset: CARD.elementFirstPin + (CARD.row + CARD.rowGap) * index,
            })),
        };
    }

    const open = readOpenLiteralPins(params);
    const translators = LOCALES.map(locale => createTranslator(locale).t);
    const caption = (label: string | undefined, id: string, valueType?: string) =>
        Math.max(
            ...translators.map(t => {
                const name = label?.trim() ? resolveBlueprintLabel(label.trim(), t) : id;
                return textWidth(valueType && valueType !== "any" ? `${name} · ${valueType}` : name, "small");
            }),
        );

    const left: Cell[] = [];
    const right: Cell[] = [];
    const inputs = [
        ...entry.pins.filter(pin => pin.kind === "input" && pin.semantic === "exec"),
        ...entry.pins.filter(pin => pin.kind === "input" && pin.semantic === "data"),
    ];
    for (const pin of inputs) {
        const asField =
            pin.semantic === "data" && Boolean(pin.allowInlineLiteral) && !wiredInputs.has(pin.id) && open.has(pin.id);
        left.push(
            asField
                ? {
                      height: pin.valueType === "boolean" ? CARD.literalBooleanRow : CARD.literalRow,
                      width: 24 + caption(pin.label, pin.id) + 170,
                  }
                : {
                      pin: { id: pin.id, side: "in", kind: pin.semantic },
                      height: CARD.row,
                      width: 18 + caption(pin.label, pin.id, pin.semantic === "data" ? pin.valueType : undefined),
                  },
        );
    }
    const addsPins = Boolean(entry.supportsDynamicInputPins);
    if (addsPins && !entry.dynamicPinsGenerateOutputs) {
        left.push({ height: CARD.buttonRow, width: 0 });
    }
    if (entry.supportsSaveSchemaPins && entry.saveSchemaPinKind === "input") {
        left.push({ height: CARD.buttonRow, width: 0 });
    }
    const spacers =
        entry.type === BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING ? 2 : entry.type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE ? 1 : 0;
    for (let i = 0; i < spacers; i += 1) {
        right.push({ height: CARD.row, width: 0 });
    }
    const orderedOutputs = [
        ...outputs.filter(pin => pin.semantic === "exec"),
        ...outputs.filter(pin => pin.semantic === "data"),
    ];
    for (const pin of orderedOutputs) {
        right.push({
            pin: { id: pin.id, side: "out", kind: pin.semantic },
            height: CARD.row,
            width: 18 + caption(pin.label, pin.id, pin.semantic === "data" ? pin.valueType : undefined),
        });
    }
    if (addsPins && entry.dynamicPinsGenerateOutputs) {
        right.push({ height: CARD.buttonRow, width: 0 });
    }
    if (entry.supportsSaveSchemaPins && entry.saveSchemaPinKind === "output") {
        right.push({ height: CARD.buttonRow, width: 0 });
    }

    const custom = CUSTOM_HEADER[entry.type];
    const fields = custom === undefined ? entry.inspectorParams ?? [] : [];
    const headerExtra =
        custom ?? fields.reduce((sum, field) => sum + (FIELD_HEIGHT[field.kind] ?? DEFAULT_FIELD_HEIGHT), 0);

    const pins: BlueprintLayoutPin[] = [];
    const rowCount = Math.max(left.length, right.length);
    let cursor = CARD.header + headerExtra + CARD.pinPadding;
    let widest = 0;
    for (let i = 0; i < rowCount; i += 1) {
        const l = left[i];
        const r = right[i];
        const height = Math.max(l?.height ?? 0, r?.height ?? 0);
        for (const cell of [l, r]) {
            if (cell?.pin) {
                pins.push({ ...cell.pin, offset: round(cursor + height / 2) });
            }
        }
        widest = Math.max(widest, (l?.width ?? 0) + (r?.width ?? 0) + 12);
        cursor += height + CARD.rowGap;
    }
    const height = rowCount > 0 ? cursor - CARD.rowGap + CARD.pinPadding + CARD.bottom : CARD.header + headerExtra;

    const title = Math.max(
        ...translators.map(t =>
            Math.max(
                textWidth(resolveBlueprintNodeTitle(entry.displayName, t), "title"),
                textWidth(resolveBlueprintCategoryLabel(entry.category, t), "small"),
            ),
        ),
    ) + 18;
    const fieldWidth = fields.some(field => field.kind === "select" && !field.options) ? CARD.maxWidth : 0;
    const width = Math.min(CARD.maxWidth, Math.max(CARD.minWidth, Math.ceil(Math.max(widest, title, fieldWidth))));
    return { width, height: round(height), pins };
}

function readOpenLiteralPins(params: Readonly<Record<string, unknown>>): Set<string> {
    const raw = params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY];
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
}

function textWidth(text: string, size: keyof typeof TEXT): number {
    let width = 0;
    for (const char of text) {
        width += /[⺀-鿿　-ヿ＀-￯]/.test(char) ? TEXT[size].wide : TEXT[size].narrow;
    }
    return width;
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}
