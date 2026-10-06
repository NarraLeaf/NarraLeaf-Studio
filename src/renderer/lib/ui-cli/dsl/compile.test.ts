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

    it("says only that a widget type is unknown, not that it takes no children", () => {
        // A plugin's container is unknown here - this tool loads no plugins - and whether it holds
        // children is the plugin's to declare, so "takes no children" would be a guess, and wrong.
        const text = `${MINIMAL}        Box: acme.widgets.box @0,0 10x10\n            Inner: nl.text @0,0 1x1\n`;
        expect(codes(text)).toEqual(["ui.unknown_widget_type"]);
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

    it("says nothing about a list item field read inside a component definition, which reads the row it is placed in", () => {
        const text = `component "Card" id=card size=100x20
    Card: nl.container id=card-root @0,0 100x20
        Label: nl.text @0,0 100x20
            bind text = field caption
`;
        expect(codes(text)).not.toContain("ui.list_field_outside_item");
    });

    it("says nothing about a list item field read from inside the item template", () => {
        const text = `${MINIMAL}        Rows: nl.list id=rows @0,0 100x100\n`
            + "            Row: nl.container @0,0 100x20\n"
            + "                Label: nl.text @0,0 100x20\n"
            + "                    bind text = field caption\n";
        expect(codes(text)).not.toContain("ui.list_field_outside_item");
    });

    it("takes a row field for whether an element shows, on any type", () => {
        // What the inspector's visibility field picker writes and `print` writes back out, so a
        // dump of a surface that uses it has to compile again.
        const text = `${MINIMAL}        Rows: nl.list id=rows @0,0 100x100\n`
            + "            Row: nl.container @0,0 100x20\n"
            + "                Lock: nl.container id=lock @0,0 20x20\n"
            + "                    bind layout.visible = field locked\n";
        const result = compile(text);
        expect(result.diagnostics).toEqual([]);
        expect(result.surfaces[0].elements.lock.valueBindings).toEqual({
            "layout.visible": { kind: "listItemField", fieldId: "locked" },
        });
    });

    it("refuses a value blueprint for whether an element shows, which nothing would evaluate", () => {
        const text = `${MINIMAL}        Rows: nl.list id=rows @0,0 100x100\n`
            + "            Row: nl.container @0,0 100x20\n"
            + "                Lock: nl.container id=lock @0,0 20x20\n"
            + "                    bind layout.visible = blueprint bp-1\n";
        expect(codes(text)).toContain("ui.prop_not_bindable");
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

describe("where a widget's words come from", () => {
    const keyed = (label: string) =>
        `${MINIMAL}        Start: nl.button id=start @0,0 10x10\n            label = ${JSON.stringify(label)}\n            localizationKey = menu.start\n`;
    const KEYS = { sourceLocale: "en", keys: new Map([["menu.start", "Start"]]) };

    function diagnostics(text: string, options: Parameters<typeof compileUiFile>[1]) {
        return compileUiFile(parseUiFile(text), options).diagnostics;
    }

    function compiled(text: string, options: Parameters<typeof compileUiFile>[1]) {
        return compileUiFile(parseUiFile(text), options);
    }

    it("takes a widget's key and marks as props it has, and leaves out the switch an older file carries", () => {
        const text = `${MINIMAL}        Title: nl.text id=t @0,0 10x10\n            text = "Hello"\n            localizable = true\n`
            + "            rich = []\n";
        const result = compiled(text, {});
        expect(result.diagnostics.map(item => item.code)).not.toContain("ui.unknown_prop");
        expect(result.diagnostics.filter(item => item.code === "ui.legacy_prop").map(item => item.severity)).toEqual(["info"]);
        const title = Object.values(result.surfaces[0].elements).find(element => element.id === "t");
        expect(title?.props).toEqual({ text: "Hello", rich: [] });
        expect(codes(`${MINIMAL}        Art: nl.image id=a @0,0 10x10\n            localizationKey = menu.start\n`)).toContain("ui.unknown_prop");
    });

    it("refuses words written onto a keyed widget that the key's text would replace", () => {
        const found = diagnostics(keyed("Begin the game"), { textKeys: KEYS }).filter(item => item.code === "ui.words_two_sources");
        expect(found).toHaveLength(1);
        expect(found[0].severity).toBe("error");
        expect(found[0].message).toContain("menu.start");
    });

    it("leaves out words that are the key's, as a keyed widget holds none of its own", () => {
        const result = compiled(keyed("Start"), { textKeys: KEYS });
        expect(result.diagnostics.filter(item => item.code === "ui.words_dropped").map(item => item.severity)).toEqual(["info"]);
        expect(result.diagnostics.map(item => item.code)).not.toContain("ui.words_two_sources");
        const start = Object.values(result.surfaces[0].elements).find(element => element.id === "start");
        expect(start?.props).toEqual({ localizationKey: "menu.start" });
    });

    it("refuses them without a source language too, where keys are read as well", () => {
        const found = diagnostics(keyed("Begin"), { textKeys: { ...KEYS, sourceLocale: "" } })
            .filter(item => item.code === "ui.words_two_sources");
        expect(found.map(item => item.severity)).toEqual(["error"]);
    });

    it("says nothing without the project's keys, and names a key the project does not have", () => {
        expect(codes(keyed("Begin"))).not.toContain("ui.words_two_sources");
        const missing = diagnostics(keyed("Begin"), { textKeys: { sourceLocale: "en", keys: new Map() } });
        expect(missing.map(item => item.code)).not.toContain("ui.words_two_sources");
        expect(missing.filter(item => item.code === "ui.key_missing").map(item => item.severity)).toEqual(["warning"]);
    });
});

describe("a component's text parameters", () => {
    const COMPONENT = `component "Nav item" id=nav size=400x80
    param label "Label" type=text = "Item"
    param target "Target" = title
    Root: nl.container id=nav-root @0,0 400x80
        Label: nl.text id=nav-label @0,0 400x80
            text = "Sample"
            bind text = param label
`;
    const PAGE = (link: string) => `${MINIMAL}        Nav: nl.container id=p1 @0,0 400x80\n            component nav ${link}\n`;
    const KEYS = { sourceLocale: "zh", keys: new Map([["nav.title", "标题"]]) };

    function compiled(text: string, options: Parameters<typeof compileUiFile>[1] = {}) {
        return compileUiFile(parseUiFile(text), options);
    }

    it("reads a text parameter, the binding that shows it, and a placement's words and key", () => {
        const result = compiled(`${COMPONENT}\n${PAGE('label="Start"')}\n${MINIMAL.replace('"S" id=s', '"T" id=t')}        Nav: nl.container id=p2 @0,0 400x80\n            component nav label.key=nav.title\n`, { textKeys: KEYS });
        expect(result.diagnostics).toEqual([]);
        const component = result.components[0].component;
        expect(component.params).toEqual([
            { id: "label", name: "Label", type: "text", defaultValue: "Item" },
            { id: "target", name: "Target", type: "string", defaultValue: "title" },
        ]);
        expect(component.elements["nav-label"].valueBindings).toEqual({ text: { kind: "componentParam", paramId: "label" } });
        expect(result.surfaces[0].elements.p1.extra).toEqual({ componentLink: { componentId: "nav", linked: true, params: { label: "Start" } } });
        expect(result.surfaces[1].elements.p2.extra).toEqual({ componentLink: { componentId: "nav", linked: true, paramKeys: { label: "nav.title" } } });
    });

    it("refuses a parameter binding outside a component, on a string parameter, or on a prop that is not words", () => {
        expect(codes(`${MINIMAL}        T: nl.text @0,0 10x10\n            bind text = param label\n`)).toContain("ui.param_outside_component");
        expect(codes(COMPONENT.replace("bind text = param label", "bind text = param target"))).toContain("ui.param_not_text");
        expect(codes(COMPONENT.replace("bind text = param label", "bind text = param gone"))).toContain("ui.param_not_text");
        expect(codes(COMPONENT.replace("Label: nl.text id=nav-label @0,0 400x80\n            text = \"Sample\"\n            bind text = param label", "Art: nl.image id=nav-art @0,0 400x80\n            bind imageFill.assetId = param label")))
            .toContain("ui.prop_not_bindable");
    });

    it("checks the values a placement gives against what the component declares", () => {
        const check = (link: string) => compiled(`${COMPONENT}\n${PAGE(link)}`, { textKeys: KEYS }).diagnostics.map(item => `${item.severity} ${item.code}`);
        expect(check('label="A" label.key=nav.title')).toEqual(["error ui.words_two_sources"]);
        expect(check("target.key=nav.title")).toEqual(["error ui.param_key_not_text"]);
        expect(check("label.key=nav.gone")).toEqual(["warning ui.key_missing"]);
        expect(check('other="x"')).toEqual(["warning ui.param_unknown"]);
    });

    it("refuses a param type that is neither string nor text", () => {
        expect(() => parseUiFile(COMPONENT.replace("type=text", "type=words"))).toThrow(/string or text/);
    });
});

describe("a page's parameters", () => {
    const PAGE = `surface "Confirm" id=confirm kind=appSurface size=800x600
    param message "message" = ""
    param count "count" type=number = 3
    param rows "buttons" type=json = []
    param loud "loud" type=boolean
    Root: nl.root @0,0 800x600
`;

    it("reads each param line as a declaration, typed, in order", () => {
        const result = compile(PAGE);
        expect(result.diagnostics).toEqual([]);
        expect((result.surfaces[0].surface as { params?: unknown }).params).toEqual([
            { id: "message", name: "message", type: "string", defaultValue: "" },
            { id: "count", name: "count", type: "number", defaultValue: 3 },
            { id: "rows", name: "buttons", type: "json", defaultValue: [] },
            { id: "loud", name: "loud", type: "boolean" },
        ]);
    });

    it("refuses what the editor would not take", () => {
        expect(codes(PAGE.replace('param loud "loud" type=boolean', 'param loud "loud" type=date'))).toContain("ui.page_param_type");
        expect(codes(PAGE.replace('param loud "loud" type=boolean', 'param "two words" "x"'))).toContain("ui.page_param_id");
        expect(codes(PAGE.replace('param loud "loud" type=boolean', 'param other "message"'))).toContain("ui.page_param_duplicate");
        expect(codes(PAGE.replace('type=number = 3', 'type=number = "three"'))).toContain("ui.page_param_default");
    });

    it("refuses a param on a Game UI", () => {
        expect(codes(`surface "Box" id=box slot=dialog size=800x600
    param message "message"
    Root: nl.root @0,0 800x600
`)).toContain("ui.page_param_on_game_ui");
    });
});
