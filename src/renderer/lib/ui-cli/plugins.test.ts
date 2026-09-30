import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { uiElementTypeAcceptsUserChildren } from "@shared/types/ui-editor/document";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { runCli } from "./cli";

/**
 * `--plugin`: the interface tool reading a plugin's widget declarations the way the editor does.
 *
 * The plugin here is a real one on disk - a manifest and a hand-written ES module entry importing
 * `narraleaf-studio/plugin` and `react` by their bare names, which is what a plugin ships - so what is
 * under test is the whole path: manifest, entry, setup, registration, and the check that reads it.
 */

const PLUGIN_ID = "probe.cli";
const METER = `${PLUGIN_ID}.meter`;
const BOX = `${PLUGIN_ID}.box`;

const ENTRY = `
import { definePlugin, ui } from "narraleaf-studio/plugin";
import React from "react";

const partsOf = ({ element, generateId }) => ({
    children: [{
        id: generateId(),
        type: "nl.container",
        name: "Fill",
        parentId: element.id,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        extra: { partSlot: "fill" },
    }],
});

export default definePlugin({
    setup(app) {
        // Services this tool does not provide answer with inert stand-ins.
        const dispose = app.services.ui.panels.register({ id: app.plugin.id + ".panel" });
        void ui.Button;
        app.services.widgets.registerMany([
            {
                type: app.plugin.id + ".meter",
                displayName: "Meter",
                partSlots: ["fill"],
                createDefaultElement: () => ({ name: "Meter", layout: { x: 0, y: 0, width: 200, height: 20 }, props: { value: 0.5 } }),
                createDefaultChildElements: partsOf,
                render: () => React.createElement("div"),
            },
            {
                type: app.plugin.id + ".box",
                displayName: "Box",
                acceptsChildren: true,
                createDefaultElement: () => ({ name: "Box", layout: { x: 0, y: 0, width: 100, height: 100 }, props: {} }),
                render: () => null,
            },
            { type: "someone.else.widget", displayName: "Stolen", createDefaultElement: () => ({}), render: () => null },
        ]);
        return dispose;
    },
});
`;

let root: string;
let pluginDir: string;

function write(file: string, text: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
    return file;
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nls-ui-cli-plugin-"));
    pluginDir = path.join(root, PLUGIN_ID);
    write(path.join(pluginDir, "manifest.json"), JSON.stringify({
        manifestVersion: 2,
        id: PLUGIN_ID,
        name: "CLI probe",
        version: "1.0.0",
        entries: { studio: "main.js" },
        contributes: { widgets: [METER, BOX] },
        permissions: [],
    }));
    write(path.join(pluginDir, "main.js"), ENTRY);
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
    widgetModuleRegistry.unregister(METER);
    widgetModuleRegistry.unregister(BOX);
    vi.restoreAllMocks();
});

function run(argv: string[]): { code: number; out: string; err: string } {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(argv, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A page with a meter whose one child is its fill, and one whose child is a label an author put there. */
function uiFile(childOfMeter: "fill" | "label"): string {
    const child = childOfMeter === "fill"
        ? ["            Fill: nl.container @0,0 10x10", "                extra.partSlot = fill"]
        : ["            Label: nl.text @0,0 100x20", "                text = \"no\""];
    return write(path.join(root, `${childOfMeter}.ui`), [
        'surface "Gauge" id=gauge kind=appSurface size=640x360',
        "    Root: nl.root @0,0 640x360",
        `        Meter: ${METER} @10,10 200x20`,
        ...child,
        `        Box: ${BOX} @10,60 100x100`,
        "            Inside: nl.text @0,0 50x20",
        "",
    ].join("\n"));
}

describe("ui --plugin", () => {
    it("describes a plugin's widget from its own declaration", () => {
        const result = run(["widget", METER, "--plugin", pluginDir]);
        expect(result.code).toBe(0);
        expect(result.out).toContain(`plugin     ${PLUGIN_ID} (loaded with --plugin)`);
        expect(result.out).toContain("structural parts only - an author may not add children");
        expect(result.out).toMatch(/Fill\s+\[nl\.container\]\s+slot=fill/);
        // Studio refuses a widget type outside the plugin's own namespace, and so does this.
        expect(result.err).toContain("someone.else.widget");
        expect(uiElementTypeAcceptsUserChildren(BOX)).toBe(true);
    });

    it("refuses a child that is not one of a plugin widget's parts, and accepts one that is", () => {
        const refused = run(["check", uiFile("label"), "--plugin", pluginDir]);
        expect(refused.code).toBe(1);
        expect(refused.out).toContain("ui.not_a_part");
        expect(refused.out).toContain("extra.partSlot = <slot>");
        // The box takes whatever an author puts in it.
        expect(refused.out.match(/ui\.not_a_part/g)).toHaveLength(1);

        const accepted = run(["check", uiFile("fill"), "--plugin", pluginDir]);
        expect(accepted.out).not.toContain("ui.not_a_part");
        expect(accepted.out).not.toContain("ui.unknown_widget_type");
        expect(accepted.code).toBe(0);
    });

    it("says what to pass when a plugin's widget is not known", () => {
        const result = run(["check", uiFile("fill")]);
        expect(result.code).toBe(1);
        expect(result.out).toContain("ui.unknown_widget_type");
        expect(result.out).toContain("--plugin <dir>");
    });

    it("refuses a directory that is not a plugin, rather than checking without it", () => {
        const result = run(["widget", METER, "--plugin", root]);
        expect(result.code).toBe(2);
        expect(result.err).toContain("No manifest.json");
    });
});
