import { describe, expect, it } from "vitest";
import { patchExportBlocker, type PatchExportSelection } from "./patchExportReadiness";

const READY: PatchExportSelection = {
    outputFile: "D:/out/patch/game.assetpatch",
    baselineMode: "variant",
    baselineAppDir: "",
    readingBaseline: false,
    baselineUnreadable: false,
    baselineNotGranted: false,
    baselineAppTagId: null,
    dlcAttachTo: null,
};

describe("patchExportBlocker", () => {
    it("lets a complete selection through in either mode", () => {
        expect(patchExportBlocker(READY)).toBeNull();
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/builds/win-unpacked",
            baselineAppTagId: "release",
        })).toBeNull();
    });

    it("refuses a file with nowhere to go", () => {
        expect(patchExportBlocker({ ...READY, outputFile: "" })).toBe("output");
    });

    it("waits while the chosen build folder is being read", () => {
        // Pressing Export here would race the answer, and what the folder says decides both the
        // edition the file installs into and whether the DLC checks below apply at all.
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/builds/win-unpacked",
            readingBaseline: true,
        })).toBe("reading");
    });

    it("refuses a folder that holds no build of this game", () => {
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/documents",
            baselineUnreadable: true,
        })).toBe("artifact");
    });

    /**
     * The two facts about a folder that must never share a sentence.
     *
     * A folder nothing was allowed to open is not a folder that was found empty. Answering
     * `"artifact"` here would tell an author who typed a valid path - or came back to a remembered
     * one - that a folder holding their build holds no build, and the folder is right there for
     * them to open and disagree with.
     */
    it("tells a folder it may not open apart from one that holds no build", () => {
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/builds/win-unpacked",
            baselineNotGranted: true,
        })).toBe("artifactAccess");
    });

    it("names the access state even where the read also failed", () => {
        // Both flags arrive together when the refusal *is* the read failure, and the more specific
        // one is the one with a remedy in it.
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/builds/win-unpacked",
            baselineUnreadable: true,
            baselineNotGranted: true,
        })).toBe("artifactAccess");
    });

    it("ignores an unread folder that was never named", () => {
        // An empty folder in artifact mode is a choice, not an omission: it means carry the whole
        // game. The reading flags describe a folder that is not there, so neither applies.
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "",
            readingBaseline: true,
            baselineUnreadable: true,
            baselineNotGranted: true,
        })).toBeNull();
    });

    it("requires the build a DLC adds to", () => {
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "",
            dlcAttachTo: "release",
        })).toBe("dlcBaseline");
    });

    it("refuses a build from a different edition than the DLC attaches to", () => {
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/builds/demo",
            baselineAppTagId: "demo",
            dlcAttachTo: "release",
        })).toBe("dlcVariant");
    });

    it("accepts a build that states no edition beside a DLC", () => {
        // A build made before builds recorded their variant says nothing, and the dialog asks the
        // author instead. Refusing here would make every DLC unexportable against an older build.
        expect(patchExportBlocker({
            ...READY,
            baselineMode: "artifact",
            baselineAppDir: "D:/builds/older",
            baselineAppTagId: null,
            dlcAttachTo: "release",
        })).toBeNull();
    });

    it("asks nothing of a DLC in the mode that builds its own baseline", () => {
        // Variant mode compiles the edition the DLC attaches to as part of the export, so there is
        // no folder to name and no edition to disagree with.
        expect(patchExportBlocker({ ...READY, dlcAttachTo: "release" })).toBeNull();
    });

    it("does not refuse an export that would carry no changes", () => {
        // Content and target being the same variant produces a valid patch with nothing in it. The
        // dialog says so beside the field; the button stays live because the file still writes.
        expect(patchExportBlocker(READY)).toBeNull();
    });
});
