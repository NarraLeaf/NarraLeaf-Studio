import { describe, expect, it } from "vitest";
import { BLUEPRINT_NODE_TYPE_DATA_MEMO, BLUEPRINT_NODE_TYPE_LOCAL_GET } from "@shared/types/blueprint/graph";
import { isBlueprintFanOutOutputPin } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import {
    BLUEPRINT_MEMO_RECORD_KEY,
    BLUEPRINT_MEMO_SLOT_PREFIX,
} from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { readBlueprintMemoValue, writeBlueprintMemoValue } from "./memoValues";

function localsWithRecord(record: Record<string, unknown> = {}): Record<string, unknown> {
    return { [BLUEPRINT_MEMO_RECORD_KEY]: record };
}

describe("memo slots", () => {
    // The point of the node: one output, many consumers. Get Var cannot do this because a later Set
    // changes what the second consumer reads; a Memo has no second writer.
    it("is the only data output allowed to fan out", () => {
        expect(isBlueprintFanOutOutputPin(BLUEPRINT_NODE_TYPE_DATA_MEMO, "result")).toBe(true);
        expect(isBlueprintFanOutOutputPin(BLUEPRINT_NODE_TYPE_LOCAL_GET, "value")).toBe(false);
    });

    it("reads null before it has been written, and never undefined", () => {
        expect(readBlueprintMemoValue(localsWithRecord(), "n1")).toBeNull();
        expect(readBlueprintMemoValue(undefined, "n1")).toBeNull();

        const locals = localsWithRecord();
        writeBlueprintMemoValue(locals, "n1", undefined);
        expect(readBlueprintMemoValue(locals, "n1")).toBeNull();
    });

    it("writes into the blueprint's lifecycle record, not a per-execution object", () => {
        // The record is the object the widget keeps across event dispatches, so a value parked during
        // one execution is still there for the next - and goes away with the widget, like a Var.
        const record: Record<string, unknown> = {};
        writeBlueprintMemoValue(localsWithRecord(record), "n1", 42);

        expect(record[`${BLUEPRINT_MEMO_SLOT_PREFIX}n1`]).toBe(42);
        expect(readBlueprintMemoValue(localsWithRecord(record), "n1")).toBe(42);
    });

    it("keeps one slot per node", () => {
        const locals = localsWithRecord();
        writeBlueprintMemoValue(locals, "n1", "a");
        writeBlueprintMemoValue(locals, "n2", "b");
        expect(readBlueprintMemoValue(locals, "n1")).toBe("a");
        expect(readBlueprintMemoValue(locals, "n2")).toBe("b");
    });

    it("keeps a false or zero value rather than treating it as empty", () => {
        const locals = localsWithRecord();
        writeBlueprintMemoValue(locals, "n1", false);
        writeBlueprintMemoValue(locals, "n2", 0);
        expect(readBlueprintMemoValue(locals, "n1")).toBe(false);
        expect(readBlueprintMemoValue(locals, "n2")).toBe(0);
    });
});
