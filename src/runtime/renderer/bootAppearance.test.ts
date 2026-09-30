/**
 * A loading state that paints its own answer for the background is the defect this replaced, only
 * quieter: the game changes colour the moment it appears, and again when it goes. These hold it to
 * the shell's answer and hold the indicator to being visible on whatever that answer is.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { resolveGameRuntimeInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";
import {
    RUNTIME_BOOT_FALLBACK_ACCENT,
    RUNTIME_BOOT_FALLBACK_BACKGROUND,
    resolveRuntimeBootColors,
} from "./bootAppearance";

function packWithEntryBackground(backgroundColor: string | undefined): GameRuntimePackV1 {
    return {
        schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
        mode: "production",
        entry: { kind: "surface", surfaceId: "title" },
        assets: { items: {} },
        bundle: {
            bundleId: "bundle",
            revision: 1,
            brand: [
                { id: "background", value: "#101317" },
                { id: "surface.sunken", value: "#0A090D" },
            ],
            ui: {
                uidoc: {
                    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
                    id: "doc",
                    name: "Doc",
                    surfaces: [{
                        id: "title",
                        name: "Title",
                        host: "app",
                        kind: "appSurface",
                        designSize: { width: 1280, height: 720 },
                        rootElementId: "root",
                        ...(backgroundColor === undefined ? {} : { settings: { backgroundColor } }),
                    }],
                    elements: {},
                },
            },
        },
    } as unknown as GameRuntimePackV1;
}

describe("the colours a game waits in", () => {
    it("paints nothing at all before the pack has said anything", () => {
        // The shell coloured its own window for this game before the page existed. Anything painted
        // here would be a frame of one colour between two frames of another.
        expect(resolveRuntimeBootColors(null)).toEqual({
            background: RUNTIME_BOOT_FALLBACK_BACKGROUND,
            accent: RUNTIME_BOOT_FALLBACK_ACCENT,
        });
        expect(RUNTIME_BOOT_FALLBACK_BACKGROUND).toBe("transparent");
    });

    it("asks the shell's own question rather than answering it a second way", () => {
        // Same function the desktop window and the web export's generated page use. Held by
        // identity rather than by a colour, so a change to that rule cannot leave this one behind.
        for (const authored of ["nlbrand:surface.sunken", "#FFF8F0", "transparent", undefined]) {
            const pack = packWithEntryBackground(authored);
            expect(resolveRuntimeBootColors(pack).background)
                .toBe(resolveGameRuntimeInitialBackgroundColor(pack));
        }
    });

    it("follows a brand link into the pack's own palette", () => {
        expect(resolveRuntimeBootColors(packWithEntryBackground("nlbrand:surface.sunken")).background)
            .toBe("#0a090d");
    });

    it("draws the indicator in ink that reads against that background", () => {
        // The one thing this mark has to do. A palette colour could be the background itself; a
        // white bar would be invisible on the white an unconfigured app surface gets.
        expect(resolveRuntimeBootColors(packWithEntryBackground("#0A090D")).accent).toBe("rgb(255 255 255)");
        expect(resolveRuntimeBootColors(packWithEntryBackground("#FFF8F0")).accent).toBe("rgb(27 33 41)");
        expect(resolveRuntimeBootColors(packWithEntryBackground(undefined)).accent).toBe("rgb(27 33 41)");
    });
});
