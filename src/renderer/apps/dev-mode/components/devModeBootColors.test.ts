// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { UISurface } from "@shared/types/ui-editor/document";
import { resolveSurfaceInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";
import { bootScreenAccent } from "@/lib/ui-editor/runtime/app/bootScreenAccent";
import { resolveRuntimeBootDisplayColors } from "../../../../runtime/renderer/bootColors";

describe("boot colour calls without a browser", () => {
    it("keeps the shared shell lookup and runtime adapter callable", () => {
        const surface = {
            id: "title", kind: "appSurface", settings: { backgroundColor: "white" },
        } as UISurface;
        const pack = {
            entry: { surfaceId: "title" },
            bundle: { ui: { uidoc: { surfaces: [surface] } } },
        } as unknown as GameRuntimePackV1;

        expect(typeof document).toBe("undefined");
        expect(resolveSurfaceInitialBackgroundColor(surface, undefined)).toBe("white");
        expect(bootScreenAccent("#fff")).toBe("rgb(27 33 41)");
        expect(bootScreenAccent("#101317")).toBe("rgb(255 255 255)");
        expect(resolveRuntimeBootDisplayColors(pack)).toEqual({ background: "white", accent: "rgb(255 255 255)" });
        expect(resolveRuntimeBootDisplayColors(null)).toEqual({ background: "transparent", accent: "rgb(255 255 255)" });
    });
});
