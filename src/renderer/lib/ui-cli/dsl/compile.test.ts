/**
 * What the compiler refuses, and what it fills in.
 *
 * The interesting cases are the ones where a file is syntactically fine and still describes an
 * interface that cannot exist: a child under a widget that builds its own parts, a binding on a prop
 * nothing drives, a stage widget on an app surface.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { compileUiFile } from "./compile";
import { parseUiFile } from "./parse";

function compile(text: string) {
    return compileUiFile(parseUiFile(text));
}

function codes(text: string): string[] {
    return compile(text).diagnostics.map(item => item.code);
}

const MINIMAL = `surface "S" id=s kind=appSurface size=800x600
    Root: nl.root @0,0 800x600
`;

describe("compiling a .ui file", () => {
    it("builds a surface and its tree", () => {
        const result = compile(`${MINIMAL}        Panel: nl.container id=panel @10,20 300x200\n`);
        expect(result.diagnostics).toEqual([]);
        const surface = result.surfaces[0];
        expect(surface.surface.id).toBe("s");
        expect(surface.surface.host).toBe("app");
        expect(surface.elements.panel.layout).toEqual({ x: 10, y: 20, width: 300, height: 200 });
        expect(surface.elements.panel.parentId).toBe(surface.surface.rootElementId);
        expect(result.surfaces[0].elements[surface.surface.rootElementId].childrenIds).toEqual(["panel"]);
    });

    it("mints the same id for the same element in the same place every time", () => {
        const first = compile(`${MINIMAL}        Panel: nl.container @0,0 10x10\n`);
        const second = compile(`${MINIMAL}        Panel: nl.container @0,0 10x10\n`);
        const idOf = (result: ReturnType<typeof compile>) =>
            Object.values(result.surfaces[0].elements).find(element => element.name === "Panel")?.id;
        expect(idOf(first)).toBe(idOf(second));
        expect(idOf(first)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("writes a dotted key into the object it names", () => {
        const result = compile(`${MINIMAL}        Shot: nl.image id=shot @0,0 10x10\n            imageFill.assetId = art-1\n`);
        expect(result.surfaces[0].elements.shot.props).toEqual({ imageFill: { assetId: "art-1" } });
    });

    it("refuses a widget type nothing declares", () => {
        expect(codes(`${MINIMAL}        X: nl.buton @0,0 1x1\n`)).toContain("ui.unknown_widget_type");
    });

    it("refuses a root that is not nl.root", () => {
        expect(codes('surface "S" id=s kind=appSurface size=8x6\n    Root: nl.container @0,0 8x6\n'))
            .toContain("ui.root_type");
    });

    it("refuses children under a leaf widget", () => {
        expect(codes(`${MINIMAL}        Label: nl.text id=t @0,0 1x1\n            Inner: nl.text @0,0 1x1\n`))
            .toContain("ui.no_children");
    });

    it("refuses a child that is not one of a part-owning widget's own parts", () => {
        const text = `${MINIMAL}        Toggle: nl.switch id=sw @0,0 60x32\n`
            + "            Stray: nl.container @0,0 10x10\n";
        expect(codes(text)).toContain("ui.not_a_part");
    });

    it("accepts a child that carries the widget's slot marker", () => {
        const text = `${MINIMAL}        Toggle: nl.switch id=sw @0,0 60x32\n`
            + "            Track: nl.container @0,0 60x32\n"
            + '                extra.switchSlot = track\n';
        expect(codes(text)).not.toContain("ui.not_a_part");
    });

    it("refuses a binding on a prop nothing can drive", () => {
        const text = `${MINIMAL}        Label: nl.text id=t @0,0 1x1\n            bind fontSize = blueprint bp-1\n`;
        expect(codes(text)).toContain("ui.prop_not_bindable");
    });

    it("takes the binding's value type from the table when the file does not say", () => {
        const text = `${MINIMAL}        Toggle: nl.switch id=sw @0,0 60x32\n            bind checked = blueprint bp-1\n`;
        const result = compile(text);
        expect(result.surfaces[0].elements.sw.valueBindings?.checked).toEqual({
            kind: "blueprintValue",
            blueprintId: "bp-1",
            valueType: "boolean",
        });
    });

    it("notes a list item field read by an element that is not inside a list", () => {
        const text = `${MINIMAL}        Label: nl.text id=t @0,0 1x1\n            bind text = field caption\n`;
        expect(codes(text)).toContain("ui.list_field_outside_item");
    });

    it("says nothing about a list item field read from inside the item template", () => {
        const text = `${MINIMAL}        Rows: nl.list id=rows @0,0 100x100\n`
            + "            Row: nl.container @0,0 100x20\n"
            + "                Label: nl.text @0,0 100x20\n"
            + "                    bind text = field caption\n";
        expect(codes(text)).not.toContain("ui.list_field_outside_item");
    });

    it("notes a stage widget put on an app surface", () => {
        expect(codes(`${MINIMAL}        Line: nl.dialog.sentence @0,0 10x10\n`)).toContain("ui.palette_scope");
    });

    it("reports an undeclared prop once per type and key, not once per element", () => {
        const text = `${MINIMAL}        A: nl.text id=a @0,0 1x1\n            nonsense = 1\n`
            + "        B: nl.text id=b @0,0 1x1\n            nonsense = 2\n";
        expect(codes(text).filter(code => code === "ui.unknown_prop")).toHaveLength(1);
    });

    it("names the elements a surface would lose", () => {
        const first = compile(`${MINIMAL}        Keep: nl.container id=keep @0,0 1x1\n        Gone: nl.container id=gone @0,0 1x1\n`);
        const existing = {
            schemaVersion: 12,
            id: "d",
            name: "d",
            surfaces: [first.surfaces[0].surface],
            elements: first.surfaces[0].elements,
        };
        const second = compileUiFile(
            parseUiFile(`${MINIMAL}        Keep: nl.container id=keep @0,0 1x1\n`),
            { existing },
        );
        expect(second.surfaces[0].dropped.map(item => item.name)).toEqual(["Gone"]);
    });

    it("keeps the id an element already had when the file does not state one", () => {
        const first = compile(`${MINIMAL}        Panel: nl.container id=fixed-id @0,0 1x1\n`);
        const existing = {
            schemaVersion: 12,
            id: "d",
            name: "d",
            surfaces: [first.surfaces[0].surface],
            elements: first.surfaces[0].elements,
        };
        const second = compileUiFile(
            parseUiFile(`${MINIMAL}        Panel: nl.container @0,0 1x1\n`),
            { existing },
        );
        expect(Object.keys(second.surfaces[0].elements)).toContain("fixed-id");
        expect(second.surfaces[0].dropped).toEqual([]);
    });

    it("reads a struct block", () => {
        const result = compile('struct demo.row\n    field caption: string label="Caption"\n    field shot: image\n');
        expect(result.structs["demo.row"]).toEqual({
            id: "demo.row",
            fields: [
                { id: "caption", key: "caption", label: "Caption", type: "string" },
                { id: "shot", key: "shot", type: "image" },
            ],
        });
    });

    it("reads an action block", () => {
        const result = compile('action dismiss "Dismiss"\n    key Escape\n    pointer rightClick\n');
        expect(result.actions.dismiss).toEqual({
            id: "dismiss",
            name: "Dismiss",
            bindings: [{ kind: "key", key: "Escape" }, { kind: "pointer", gesture: "rightClick" }],
        });
    });

    it("mounts a stage surface into the slot it names", () => {
        const result = compile('surface "Lines" id=st slot=dialog size=8x6\n    Root: nl.root @0,0 8x6\n');
        const surface = result.surfaces[0].surface;
        expect(surface.kind).toBe("stageSurface");
        expect(surface.host).toBe("player");
        expect(surface.kind === "stageSurface" && surface.mount).toEqual({ kind: "slot", slotId: "dialog" });
    });

    it("refuses a stage slot that does not exist", () => {
        expect(codes('surface "X" id=x slot=sidebar size=8x6\n    Root: nl.root @0,0 8x6\n'))
            .toContain("ui.unknown_slot");
    });
});
