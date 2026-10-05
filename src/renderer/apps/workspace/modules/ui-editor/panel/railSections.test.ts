import { describe, expect, it } from "vitest";
import { cleanUIRailSizes, readUIRailSections, UI_RAIL_FILL_SECTION, UI_RAIL_SECTIONS } from "./railSections";

describe("readUIRailSections", () => {
    it("opens the interface list and folds both libraries on a project that never touched the rail", () => {
        expect(readUIRailSections(undefined)).toEqual({
            open: { surfaces: true, componentLibrary: false, inputActions: false },
            sizes: {},
        });
    });

    it("reads a record written before the rail had sizes", () => {
        expect(readUIRailSections({ componentLibrary: true })).toEqual({
            open: { surfaces: true, componentLibrary: true, inputActions: false },
            sizes: {},
        });
        expect(readUIRailSections({ componentLibrary: false, inputActions: true }).open)
            .toEqual({ surfaces: true, componentLibrary: false, inputActions: true });
    });

    it("keeps the interface list closed only when the author closed it", () => {
        expect(readUIRailSections({ surfaces: false }).open.surfaces).toBe(false);
        expect(readUIRailSections({ surfaces: "no" }).open.surfaces).toBe(true);
    });

    it("brings the sizes back, dropping anything that is not a positive size of a known section", () => {
        expect(readUIRailSections({
            componentLibrary: true,
            sizes: { surfaces: 310.4, componentLibrary: 260, inputActions: -1, stray: 90 },
        }).sizes).toEqual({ surfaces: 310, componentLibrary: 260 });
        expect(readUIRailSections({ sizes: "tall" }).sizes).toEqual({});
        expect(readUIRailSections("garbage")).toEqual(readUIRailSections(undefined));
    });
});

describe("cleanUIRailSizes", () => {
    it("drops a section whose size was reset", () => {
        expect(cleanUIRailSizes({ surfaces: 300, componentLibrary: undefined, inputActions: 140 }))
            .toEqual({ surfaces: 300, inputActions: 140 });
    });
});

describe("UI_RAIL_SECTIONS", () => {
    it("lists the interface list first, as the section that takes up the slack", () => {
        expect(UI_RAIL_SECTIONS.map(section => section.id)).toEqual(["surfaces", "componentLibrary", "inputActions"]);
        expect(UI_RAIL_SECTIONS[0]!.id).toBe(UI_RAIL_FILL_SECTION);
        for (const section of UI_RAIL_SECTIONS) {
            expect(section.defaultSize).toBeGreaterThanOrEqual(section.minSize);
        }
    });
});
