/**
 * Taking one step back over a list of records without writing over anybody else's: only the records
 * the step changed, only while they still read as it left them.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { isEmptyRecordRestore, planRecordRestore } from "./recordRestore";

type Row = { id: string; name: string };
const row = (id: string, name = id): Row => ({ id, name });

describe("planRecordRestore", () => {
    it("puts back only what the step changed, and leaves another author's edit alone", () => {
        const before = [row("a"), row("b")];
        const after = [row("a", "A2"), row("b")];
        const current = [row("a", "A2"), row("b", "theirs")];

        expect(planRecordRestore(after, before, current)).toEqual({
            conflict: false,
            deletes: [],
            creates: [],
            updates: [row("a")],
            moves: [],
        });
    });

    it("refuses when a record the step changed has been changed since", () => {
        const before = [row("a")];
        const after = [row("a", "A2")];
        expect(planRecordRestore(after, before, [row("a", "theirs")])).toEqual({ conflict: true });
    });

    it("brings a deleted record back in front of its old neighbour, and removes a created one", () => {
        const before = [row("a"), row("b"), row("c")];
        const after = [row("a"), row("c"), row("new")];
        const current = [row("a"), row("c"), row("new"), row("theirs")];

        const plan = planRecordRestore(after, before, current);
        expect(plan).toEqual({
            conflict: false,
            deletes: ["new"],
            creates: [{ record: row("b"), beforeId: "c" }],
            updates: [],
            moves: [],
        });
    });

    it("moves a record the step only moved back where it was", () => {
        const before = [row("a"), row("b"), row("c")];
        const after = [row("b"), row("c"), row("a")];

        const plan = planRecordRestore(after, before, after);
        expect(plan.conflict).toBe(false);
        expect(!plan.conflict && plan.moves).toContainEqual({ id: "a", beforeId: "b" });
    });

    it("plans nothing for a step that changed nothing", () => {
        const rows = [row("a")];
        expect(isEmptyRecordRestore(planRecordRestore(rows, rows, rows))).toBe(true);
    });
});
