import { describe, expect, it } from "vitest";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { isUiPasteFromAnotherProject } from "./uiEditorForeignPaste";
import {
    buildUiSurfaceClipboardPayload,
    chooseUiSurfacePastePayload,
    describeUiSurfacePaste,
    getUiSurfacePasteLevel,
    readUiSurfaceClipboardPayload,
    type UISurfaceClipboardPayload,
} from "./uiSurfaceClipboard";

function element(id: string, parentId: string | null, childrenIds: string[], extra: Record<string, unknown> = {}) {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1 },
        ...extra,
    };
}

function sourceDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: MAIN_APP_SURFACE_ID,
                name: "Main Page",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "main-root",
            },
            {
                id: "dialog-surface",
                name: "Dialogue",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "dialog-root",
                mount: { kind: "slot", slotId: "dialog" },
            },
        ],
        elements: {
            "main-root": element("main-root", null, []),
            "dialog-root": element("dialog-root", null, ["dialog-image"]),
            "dialog-image": element("dialog-image", "dialog-root", [], {
                type: "nl.image",
                props: { imageFill: { mode: "cover", assetId: "asset-1" } },
            }),
            "loose-element": element("loose-element", null, []),
        },
        meta: {},
    } as unknown as UIDocument;
}

function blueprint(id: string, owner: Record<string, unknown>) {
    return {
        id,
        name: id,
        owner,
        graphs: { events: {}, functions: {} },
    };
}

function sourceBlueprints(): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            "bp-surface": blueprint("bp-surface", { kind: "surfaceMain", surfaceId: "dialog-surface" }),
            "bp-widget": blueprint("bp-widget", {
                kind: "widgetMain",
                surfaceId: "dialog-surface",
                elementId: "dialog-image",
            }),
            "bp-other": blueprint("bp-other", { kind: "surfaceMain", surfaceId: "other-surface" }),
            "bp-global": blueprint("bp-global", { kind: "globalMain" }),
        },
        ownerRecords: {
            "surfaceMain:dialog-surface": { blueprintId: "bp-surface" },
            "widgetMain:dialog-surface:dialog-image": {
                blueprintId: "bp-widget",
            },
            "surfaceMain:other-surface": { blueprintId: "bp-other" },
            globalMain: { blueprintId: "bp-global" },
        },
    } as unknown as BlueprintDocument;
}

function copyDialogueSurface(): UISurfaceClipboardPayload {
    const payload = buildUiSurfaceClipboardPayload({
        document: sourceDocument(),
        surfaceId: "dialog-surface",
        blueprintDocument: sourceBlueprints(),
        copyId: "copy-1",
        source: { path: "D:/projects/demo", identifier: "demo", name: "Demo" },
    });
    expect(payload).not.toBeNull();
    return payload!;
}

describe("buildUiSurfaceClipboardPayload", () => {
    it("carries the surface, its subtree and nothing else from the document", () => {
        const payload = copyDialogueSurface();

        expect(payload.document.surfaces.map(surface => surface.id)).toEqual(["dialog-surface"]);
        expect(Object.keys(payload.document.elements).sort()).toEqual(["dialog-image", "dialog-root"]);
        // The stage slot travels with the surface: it is what the receiving project places it by.
        const surface = payload.document.surfaces[0];
        expect(surface.kind === "stageSurface" ? surface.mount.slotId : null).toBe("dialog");
    });

    it("carries only the blueprints owned by that surface", () => {
        const payload = copyDialogueSurface();
        const { blueprints, ownerRecords } = payload.graphs.blueprintDocument;

        expect(Object.keys(blueprints).sort()).toEqual(["bp-surface", "bp-widget"]);
        expect(Object.keys(ownerRecords).sort()).toEqual([
            "surfaceMain:dialog-surface",
            "widgetMain:dialog-surface:dialog-image",
        ]);
    });

    it("refuses the main page, which cannot be duplicated or imported", () => {
        expect(buildUiSurfaceClipboardPayload({
            document: sourceDocument(),
            surfaceId: MAIN_APP_SURFACE_ID,
            blueprintDocument: sourceBlueprints(),
        })).toBeNull();
    });

    it("refuses a surface the document does not have", () => {
        expect(buildUiSurfaceClipboardPayload({
            document: sourceDocument(),
            surfaceId: "no-such-surface",
            blueprintDocument: null,
        })).toBeNull();
    });

    it("keeps every referenced id exactly as it was copied", () => {
        const payload = copyDialogueSurface();
        const image = payload.document.elements["dialog-image"] as unknown as { props: { imageFill: { assetId: string } } };

        expect(image.props.imageFill.assetId).toBe("asset-1");
    });
});

describe("readUiSurfaceClipboardPayload", () => {
    it("reads back what a copy wrote", () => {
        const payload = readUiSurfaceClipboardPayload(JSON.stringify(copyDialogueSurface()));

        expect(payload).not.toBeNull();
        expect(payload!.copyId).toBe("copy-1");
        expect(payload!.source?.path).toBe("D:/projects/demo");
        expect(payload!.document.surfaces.map(surface => surface.id)).toEqual(["dialog-surface"]);
        expect(Object.keys(payload!.graphs.blueprintDocument.blueprints).sort()).toEqual(["bp-surface", "bp-widget"]);
    });

    it("rejects a payload of another kind", () => {
        expect(readUiSurfaceClipboardPayload(JSON.stringify({ kind: "narraleaf.ui.elements", v: 1 }))).toBeNull();
        expect(readUiSurfaceClipboardPayload("not json")).toBeNull();
    });

    it("drops a surface whose root element did not travel", () => {
        const payload = copyDialogueSurface();
        delete payload.document.elements["dialog-root"];

        expect(readUiSurfaceClipboardPayload(JSON.stringify(payload))).toBeNull();
    });

    it("drops the main page rather than reporting a surface an import will skip", () => {
        const payload = copyDialogueSurface();
        payload.document.surfaces[0].id = MAIN_APP_SURFACE_ID;

        expect(readUiSurfaceClipboardPayload(JSON.stringify(payload))).toBeNull();
    });

    it("stands in an empty graph document for blueprints it cannot read", () => {
        const payload = copyDialogueSurface();
        const broken = { ...payload, graphs: { blueprintDocument: "nonsense" } };

        const read = readUiSurfaceClipboardPayload(JSON.stringify(broken));
        expect(read).not.toBeNull();
        expect(read!.graphs.blueprintDocument.blueprints).toEqual({});
    });
});

describe("routing a surface paste", () => {
    it("prefers the machine's clipboard when it holds a different copy", () => {
        const mine = copyDialogueSurface();
        const theirs = { ...copyDialogueSurface(), copyId: "copy-2" };

        expect(chooseUiSurfacePastePayload(mine, theirs)).toBe(theirs);
    });

    it("uses this window's own payload when both are the same copy", () => {
        const mine = copyDialogueSurface();
        const echoed = { ...copyDialogueSurface() };

        expect(chooseUiSurfacePastePayload(mine, echoed)).toBe(mine);
    });

    it("leaves this window's copy standing over a clipboard holding something else", () => {
        const mine = copyDialogueSurface();

        expect(chooseUiSurfacePastePayload(mine, null)).toBe(mine);
        expect(chooseUiSurfacePastePayload(null, null)).toBeNull();
    });

    it("reads a copy made in another project as foreign, and one made here as its own", () => {
        const payload = copyDialogueSurface();

        expect(isUiPasteFromAnotherProject(payload, "D:/projects/other")).toBe(true);
        // The same directory spelled differently is the same project. A trailing separator is the
        // spelling every host folds; slash direction and case are Windows rules, and belong to the
        // identity key's own tests where the platform can be named.
        expect(isUiPasteFromAnotherProject(payload, "D:/projects/demo/")).toBe(false);
    });

    it("reads a payload with no stamp as this project's own", () => {
        const payload = buildUiSurfaceClipboardPayload({
            document: sourceDocument(),
            surfaceId: "dialog-surface",
            blueprintDocument: null,
        })!;

        expect(isUiPasteFromAnotherProject(payload, "D:/projects/demo")).toBe(false);
    });
});

describe("describeUiSurfacePaste", () => {
    const translator = {
        t: (key: string, params?: Record<string, unknown>) => `${key}(${JSON.stringify(params ?? {})})`,
        tn: (key: string, count: number, params?: Record<string, unknown>) =>
            `${key}[${count}](${JSON.stringify(params ?? {})})`,
    } as never;

    it("names the source project and drops every clause that came to nothing", () => {
        const line = describeUiSurfacePaste({
            added: 1,
            slotsInUse: [],
            project: "Demo",
            imported: 0,
            unresolved: 0,
        }, translator);

        expect(line).toBe('uiEditor.crossProject.surfacePastedFrom[1]({"project":"Demo"})');
    });

    it("joins the counts it does have", () => {
        const line = describeUiSurfacePaste({
            added: 1,
            slotsInUse: [],
            project: null,
            imported: 2,
            unresolved: 3,
        }, translator);

        expect(line.split(" · ")).toEqual([
            "uiEditor.crossProject.surfacePasted[1]({})",
            "uiEditor.crossProject.imported[2]({})",
            "uiEditor.crossProject.unresolved[3]({})",
        ]);
    });

    it("reports an occupied stage slot instead of an interface that did not arrive", () => {
        const outcome = { added: 0, slotsInUse: ["Dialog"], project: "Demo", imported: 0, unresolved: 0 };

        expect(describeUiSurfacePaste(outcome, translator)).toBe('uiEditor.crossProject.slotTaken({"slot":"Dialog"})');
        expect(getUiSurfacePasteLevel(outcome)).toBe("warning");
    });

    it("still says something when nothing at all happened", () => {
        const outcome = { added: 0, slotsInUse: [], project: null, imported: 0, unresolved: 0 };

        expect(describeUiSurfacePaste(outcome, translator)).toBe("uiEditor.crossProject.surfaceNotAdded({})");
        expect(getUiSurfacePasteLevel(outcome)).toBe("warning");
    });

    it("is an ordinary outcome when everything resolved", () => {
        expect(getUiSurfacePasteLevel({
            added: 1,
            slotsInUse: [],
            project: "Demo",
            imported: 2,
            unresolved: 0,
        })).toBe("info");
    });
});
