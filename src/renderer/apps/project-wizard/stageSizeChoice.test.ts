import { describe, expect, it } from "vitest";
import {
    formatStageAspectRatio,
    parseStageSize,
    stageOrientation,
    STAGE_SIZE_PRESETS,
} from "@shared/types/stageSize";
import { projectTemplateStageSizes } from "@shared/types/projectTemplate";
import { allowsCustomStageSize, offeredStageSizes, stageSizeForTemplate } from "./stageSizeChoice";

const template = (over: Partial<Parameters<typeof projectTemplateStageSizes>[0]>) => ({
    id: "t",
    name: "T",
    description: "",
    version: "1.0.0",
    locales: {},
    ...over,
});

describe("what a template lets the author choose", () => {
    it("offers the full preset list when the template declares nothing", () => {
        expect(offeredStageSizes([])).toBe(STAGE_SIZE_PRESETS);
        expect(allowsCustomStageSize([])).toBe(true);
    });

    it("offers only what the template declares, and no typed size", () => {
        const declared = [{ width: 1920, height: 1080 }];
        expect(offeredStageSizes(declared)).toEqual(declared);
        expect(allowsCustomStageSize(declared)).toBe(false);
    });

    it("prefers the declared list over the single size, and drops unusable entries", () => {
        expect(projectTemplateStageSizes(template({
            designSize: { width: 1920, height: 1080 },
            designSizes: [{ width: 1280, height: 720 }, { width: 99, height: 99 }],
        }))).toEqual([{ width: 1280, height: 720 }]);
    });

    it("falls back to the single declared size, which is how every shipped template states one", () => {
        expect(projectTemplateStageSizes(template({ designSize: { width: 1920, height: 1080 } })))
            .toEqual([{ width: 1920, height: 1080 }]);
    });

    it("says nothing when the manifest says nothing", () => {
        expect(projectTemplateStageSizes(template({}))).toEqual([]);
    });
});

describe("carrying a size into a newly picked template", () => {
    it("keeps the author's choice when the template was drawn for it", () => {
        expect(stageSizeForTemplate("1920x1080", [{ width: 1920, height: 1080 }])).toBe("1920x1080");
    });

    /**
     * The bug this whole field exists for: the wizard used to let the size and the template
     * disagree, and the project came out with its manifest saying one thing and its surfaces
     * laid out for another, silently.
     */
    it("takes the template's size when the author's is one it cannot be laid out at", () => {
        expect(stageSizeForTemplate("1280x720", [{ width: 1920, height: 1080 }])).toBe("1920x1080");
    });

    it("leaves the choice alone for a template that constrains nothing", () => {
        expect(stageSizeForTemplate("1080x1920", [])).toBe("1080x1920");
    });
});

describe("reading a size back", () => {
    it("rejects sizes outside the bounds and non-integers rather than accepting a stage nothing fits", () => {
        expect(parseStageSize("1920x1080")).toEqual({ width: 1920, height: 1080 });
        expect(parseStageSize("100x100")).toBeNull();
        expect(parseStageSize("99999x1080")).toBeNull();
        expect(parseStageSize("1920")).toBeNull();
        expect(parseStageSize("1920.5x1080")).toBeNull();
    });

    it("names the aspect the way an author would say it", () => {
        expect(formatStageAspectRatio({ width: 1920, height: 1080 })).toBe("16:9");
        expect(formatStageAspectRatio({ width: 1080, height: 1920 })).toBe("9:16");
        expect(formatStageAspectRatio({ width: 1024, height: 768 })).toBe("4:3");
        // Lowest terms would be 8:5, which is correct and which nobody writes.
        expect(formatStageAspectRatio({ width: 1920, height: 1200 })).toBe("16:10");
        // Reduces to nothing sayable, so it is said as a decimal instead.
        expect(formatStageAspectRatio({ width: 1000, height: 777 })).toBe("1.29:1");
    });

    it("calls a square stage landscape, because a phone locks the same way for either", () => {
        expect(stageOrientation({ width: 1080, height: 1080 })).toBe("landscape");
        expect(stageOrientation({ width: 1080, height: 1920 })).toBe("portrait");
    });
});
