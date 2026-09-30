import { describe, expect, it } from "vitest";
import { RETIRED_GLOBAL_STATE_KEYS, carriedRetiredValues } from "./globalState";

describe("carriedRetiredValues: editor.surfaceOpacity", () => {
    it("carries nothing at the old default, which is the editor plate's default too", () => {
        expect(carriedRetiredValues({ "editor.surfaceOpacity": 100 })).toEqual({});
    });

    it("turns a lowered opacity into the editor plate at that opacity", () => {
        expect(carriedRetiredValues({ "editor.surfaceOpacity": 55 })).toEqual({
            "ui.backgroundEditorFill": true,
            "ui.backgroundEditorOpacity": 55,
        });
    });

    it("turns a clear surface into the plate switched off", () => {
        expect(carriedRetiredValues({ "editor.surfaceOpacity": 0 })).toEqual({
            "ui.backgroundEditorFill": false,
        });
    });

    it("leaves a plate that has been set through the background dialog alone", () => {
        expect(carriedRetiredValues({ "editor.surfaceOpacity": 40, "ui.backgroundEditorFill": false })).toEqual({});
        expect(carriedRetiredValues({ "editor.surfaceOpacity": 40, "ui.backgroundEditorOpacity": 70 })).toEqual({});
    });

    it("ignores a profile without the key, and a value that is not a number", () => {
        expect(carriedRetiredValues({})).toEqual({});
        expect(carriedRetiredValues({ "editor.surfaceOpacity": "40" })).toEqual({});
    });

    it("is swept after it is carried, so it is carried once", () => {
        expect(RETIRED_GLOBAL_STATE_KEYS).toContain("editor.surfaceOpacity");
    });
});
