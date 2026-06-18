import { describe, expect, it } from "vitest";
import { resolveFloatingToolbarPosition } from "./floatingToolbarPosition";

describe("resolveFloatingToolbarPosition", () => {
    it("anchors the toolbar to the selected element's left edge above its top edge", () => {
        const position = resolveFloatingToolbarPosition({
            targetRect: { left: 180, top: 120 },
            surfaceRect: { left: 40, top: 20 },
        });

        expect(position).toEqual({
            left: 140,
            top: 92,
        });
    });

    it("keeps the toolbar below the editor chrome minimum top", () => {
        const position = resolveFloatingToolbarPosition({
            targetRect: { left: 180, top: 24 },
            surfaceRect: { left: 40, top: 20 },
        });

        expect(position).toEqual({
            left: 140,
            top: 34,
        });
    });
});
