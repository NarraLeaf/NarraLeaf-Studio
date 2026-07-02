import { describe, expect, it } from "vitest";
import { resolveGroupDragTranslate } from "./useMoveableHandlers";

describe("useMoveableHandlers", () => {
    it("uses the group drag delta before child-local deltas", () => {
        expect(resolveGroupDragTranslate([14, -6], [200, 300])).toEqual([14, -6]);
    });

    it("falls back to a child delta when the group delta is unavailable", () => {
        expect(resolveGroupDragTranslate(undefined, [8, 9])).toEqual([8, 9]);
    });

    it("normalizes invalid moveable translate values", () => {
        expect(resolveGroupDragTranslate([Number.NaN, Number.POSITIVE_INFINITY], undefined)).toEqual([0, 0]);
    });
});
