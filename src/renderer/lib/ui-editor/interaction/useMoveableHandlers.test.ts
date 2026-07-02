import { describe, expect, it } from "vitest";
import { resolveGroupDragTranslate } from "./useMoveableHandlers";

describe("useMoveableHandlers", () => {
    it("uses child target drag deltas before the group controller delta", () => {
        expect(resolveGroupDragTranslate([14, -6], [200, 300])).toEqual([200, 300]);
    });

    it("falls back to the group controller delta when a child delta is unavailable", () => {
        expect(resolveGroupDragTranslate([8, 9], undefined)).toEqual([8, 9]);
    });

    it("normalizes invalid moveable translate values", () => {
        expect(resolveGroupDragTranslate([Number.NaN, Number.POSITIVE_INFINITY], undefined)).toEqual([0, 0]);
    });
});
