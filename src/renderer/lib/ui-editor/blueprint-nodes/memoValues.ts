/**
 * Memo slots: a value parked by an exec pulse and readable from anywhere in the blueprint afterwards.
 *
 * These live in the blueprint instance's lifecycle record, not the per-execution node-output store,
 * so a Memo written in `init` is still readable from a click handler and is dropped when the widget
 * unmounts - the same lifetime a Var has. See BLUEPRINT_MEMO_RECORD_KEY for why.
 *
 * A slot that has not been written reads as `null`, never `undefined`: blueprints have one empty
 * value, and letting `undefined` escape here would fall through to the consumer's inline literal
 * instead of reading as empty.
 */

import {
    BLUEPRINT_MEMO_RECORD_KEY,
    BLUEPRINT_MEMO_SLOT_PREFIX,
} from "../blueprint-runtime/blueprintWidgetLocals";

function readRecord(blueprintLocals: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const raw = blueprintLocals?.[BLUEPRINT_MEMO_RECORD_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    return raw as Record<string, unknown>;
}

function slot(nodeId: string): string {
    return `${BLUEPRINT_MEMO_SLOT_PREFIX}${nodeId}`;
}

export function writeBlueprintMemoValue(
    blueprintLocals: Record<string, unknown> | undefined,
    nodeId: string,
    value: unknown,
): void {
    const record = readRecord(blueprintLocals);
    if (!record) {
        return;
    }
    record[slot(nodeId)] = value === undefined ? null : value;
}

export function readBlueprintMemoValue(
    blueprintLocals: Record<string, unknown> | undefined,
    nodeId: string,
): unknown {
    const record = readRecord(blueprintLocals);
    if (!record) {
        return null;
    }
    const key = slot(nodeId);
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : null;
}
