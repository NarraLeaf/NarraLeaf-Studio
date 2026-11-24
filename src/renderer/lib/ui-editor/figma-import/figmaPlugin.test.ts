/**
 * The Figma plugin's `code.js`, held to the source it is bundled from, and run.
 *
 * The plugin's main thread is `tools/figma-plugin/src/main.js`, which imports Studio's own reading
 * of a design (`gameUiChecklist.ts`) so its checklist cannot disagree with the import. Figma runs one
 * plain file, so the bundle is committed; a failure of the first test means the source changed and
 * the bundle did not. Regenerate it with
 *
 *     node node_modules/vitest/vitest.mjs run src/renderer/lib/ui-editor/figma-import/figmaPlugin.test.ts -u
 *
 * The rest run the bundle against a small stand-in for Figma's plugin API: enough of it to mark
 * layers from the right-click menu and to read a frame into the checklist.
 *
 * Comments in English per project convention.
 */

import * as path from "node:path";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import type { FrameChecklist } from "./gameUiChecklist";

const ROOT = path.resolve(__dirname, "../../../../..");
const PLUGIN_DIR = path.join(ROOT, "tools/figma-plugin");

const BANNER = [
    "// Generated from src/main.js and Studio's design reading - do not edit by hand.",
    "// Regenerate: node node_modules/vitest/vitest.mjs run src/renderer/lib/ui-editor/figma-import/figmaPlugin.test.ts -u",
].join("\n");

async function bundle(): Promise<string> {
    const result = await build({
        absWorkingDir: ROOT,
        entryPoints: [path.join(PLUGIN_DIR, "src/main.js")],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        // Plugin sandboxes have lagged behind browsers; nothing here needs newer syntax.
        target: "es2017",
        charset: "utf8",
        legalComments: "none",
        banner: { js: BANNER },
        logLevel: "silent",
    });
    return result.outputFiles[0].text;
}

let code: string;

beforeAll(async () => {
    code = await bundle();
}, 60_000);

// ---------------------------------------------------------------------------
// A stand-in for Figma
// ---------------------------------------------------------------------------

type FakeNode = {
    id: string;
    type: string;
    name: string;
    parent: FakeNode | null;
    children?: FakeNode[];
    characters?: string;
    autoRename?: boolean;
    relaunch: Record<string, string>;
    data: Record<string, string>;
    [key: string]: unknown;
};

let nextId = 0;

function node(type: string, name: string, box: [number, number, number, number], extra: Partial<FakeNode> = {}, children?: FakeNode[]): FakeNode {
    const [x, y, width, height] = box;
    const out: FakeNode = {
        id: `1:${++nextId}`,
        type,
        name,
        parent: null,
        visible: true,
        isMask: false,
        width,
        height,
        absoluteTransform: [[1, 0, x], [0, 1, y]],
        absoluteRenderBounds: { x, y, width, height },
        opacity: 1,
        fills: [],
        strokes: [],
        strokeWeight: 0,
        strokeAlign: "INSIDE",
        dashPattern: [],
        effects: [],
        clipsContent: false,
        relaunch: {},
        data: {},
        ...extra,
    };
    if (children) {
        out.children = children;
        children.forEach(child => (child.parent = out));
    }
    return out;
}

function text(name: string, characters: string, box: [number, number, number, number]): FakeNode {
    return node("TEXT", name, box, {
        characters,
        autoRename: name === characters,
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 24,
        fontWeight: 400,
        lineHeight: { unit: "AUTO" },
        letterSpacing: { unit: "PIXELS", value: 0 },
        textCase: "ORIGINAL",
        textAlignHorizontal: "LEFT",
        textAlignVertical: "TOP",
        textAutoResize: "NONE",
    });
}

function withApi(target: FakeNode): void {
    target.getSharedPluginData = (ns: string, key: string) => target.data[`${ns}/${key}`] ?? "";
    target.setSharedPluginData = (ns: string, key: string, value: string) => {
        target.data[`${ns}/${key}`] = value;
    };
    target.setRelaunchData = (data: Record<string, string>) => {
        target.relaunch = data;
    };
    target.findAll = (test: (candidate: FakeNode) => boolean) => {
        const out: FakeNode[] = [];
        const visit = (candidate: FakeNode) => {
            for (const child of candidate.children ?? []) {
                if (test(child)) out.push(child);
                visit(child);
            }
        };
        visit(target);
        return out;
    };
    target.children?.forEach(withApi);
}

/** A game screen: a dialogue band with an unnamed plate, line and face, and a quick menu of texts. */
function gameScreen() {
    const plate = node("FRAME", "Frame 12", [420, 760, 300, 52], {}, [text("Narra", "Narra", [440, 766, 200, 40])]);
    const line = text("This line was drawn in Figma", "This line was drawn in Figma", [420, 836, 1300, 150]);
    const face = node("RECTANGLE", "Rectangle 3", [170, 790, 200, 200]);
    const band = node("GROUP", "Bottom panel", [0, 740, 1920, 340], {}, [plate, line, face]);
    const auto = text("Auto", "Auto", [1180, 1018, 96, 40]);
    const quick = node("GROUP", "Group 7", [1180, 1018, 700, 40], {}, [auto, text("Log", "Log", [1290, 1018, 96, 40])]);
    const background = node("RECTANGLE", "Background", [0, 0, 1920, 1080]);
    const frame = node("FRAME", "Game screen", [0, 0, 1920, 1080], {}, [background, band, quick]);
    const page = node("PAGE", "Mockups", [0, 0, 0, 0], {}, [frame]);
    withApi(page);
    return { page, frame, band, plate, line, face, quick, auto };
}

type Run = {
    closedWith: string | null;
    notices: string[];
    messages: Record<string, unknown>[];
    send: (message: Record<string, unknown>) => void;
};

async function run(command: string, page: FakeNode, selection: FakeNode[], language = "zh"): Promise<Run> {
    const out: Run = { closedWith: null, notices: [], messages: [], send: () => {} };
    let onmessage: ((message: Record<string, unknown>) => void) | null = null;
    const byId = new Map<string, FakeNode>();
    const index = (target: FakeNode) => {
        byId.set(target.id, target);
        target.children?.forEach(index);
    };
    index(page);
    const figma = {
        command,
        mixed: Symbol("mixed"),
        root: { name: "File" },
        currentPage: Object.assign(page, { selection }),
        clientStorage: { getAsync: async () => language, setAsync: async () => {} },
        showUI: () => {},
        on: () => {},
        notify: (message: string) => out.notices.push(message),
        closePlugin: (message?: string) => {
            out.closedWith = message ?? "";
        },
        getNodeByIdAsync: async (id: string) => byId.get(id) ?? null,
        getImageByHash: () => null,
        base64Encode: () => "",
        viewport: { scrollAndZoomIntoView: () => {} },
        ui: {
            postMessage: (message: Record<string, unknown>) => out.messages.push(message),
            set onmessage(handler: (message: Record<string, unknown>) => void) {
                onmessage = handler;
            },
        },
    };
    new Function("figma", "__html__", code)(figma, "");
    out.send = message => onmessage?.(message);
    await new Promise(resolve => setTimeout(resolve, 0));
    return out;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

// ---------------------------------------------------------------------------

describe("the Figma plugin bundle", () => {
    it("matches its source", async () => {
        await expect(code).toMatchFileSnapshot(path.join(PLUGIN_DIR, "code.js"));
    });

    it("keeps syntax older sandboxes cannot read out of the bundle", () => {
        expect(code).not.toMatch(/\?\.[\w([]/);
        expect(code).not.toMatch(/\?\?/);
    });
});

describe("marking from the right-click menu", () => {
    it("marks the selection, renames a layer Figma named, and keeps a name the designer chose", async () => {
        const screen = gameScreen();
        const first = await run("mark:dialog", screen.page, [screen.band]);
        expect(first.closedWith).toBe("已标为对话框：1 个图层");
        expect(screen.band.data["narraleaf/role"]).toBe("dialog");
        expect(screen.band.name).toBe("对话框 · Bottom panel");
        expect(screen.band.relaunch).toEqual({ check: "对话框" });

        await run("mark:onStage", screen.page, [screen.quick]);
        expect(screen.quick.name).toBe("快捷菜单");

        const line = await run("mark:sentence", screen.page, [screen.line], "en");
        expect(line.closedWith).toBe("Marked 1 layer as Line");
        expect(screen.line.name).toBe("Line");
        expect(screen.line.autoRename).toBe(false);
    });

    it("refuses the line on a layer that is not text, and warns about a part outside the box", async () => {
        const screen = gameScreen();
        const refused = await run("mark:sentence", screen.page, [screen.face]);
        expect(refused.closedWith).toBe("1 个图层不是文本，台词和名字只能标在文本上");
        expect(screen.face.data["narraleaf/role"]).toBeUndefined();

        const outside = await run("mark:avatar", screen.page, [screen.face]);
        expect(outside.closedWith).toBe("已标为头像：1 个图层；它不在对话框里，导入时不会接线");
    });

    it("moves a single mark off the layer that had it, and clearing gives the name back", async () => {
        const screen = gameScreen();
        await run("mark:dialog", screen.page, [screen.band]);
        await run("mark:dialog", screen.page, [screen.quick]);
        expect(screen.band.data["narraleaf/role"]).toBe("");
        expect(screen.band.name).toBe("Bottom panel");
        expect(screen.quick.data["narraleaf/role"]).toBe("dialog");

        const cleared = await run("mark:clear", screen.page, [screen.quick]);
        expect(cleared.closedWith).toBe("已清除 1 个图层的标注");
        expect(screen.quick.name).toBe("Group 7");
        expect(screen.quick.relaunch).toEqual({});
    });

    it("does not rename a layer whose name already reads as the mark", async () => {
        const screen = gameScreen();
        await run("mark:auto", screen.page, [screen.auto]);
        expect(screen.auto.name).toBe("Auto");
        expect(screen.auto.data["narraleaf/role"]).toBe("auto");
    });
});

describe("the panel's checklist", () => {
    it("reads marks into the checklist Studio's import would follow", async () => {
        const screen = gameScreen();
        await run("mark:dialog", screen.page, [screen.band]);
        await run("mark:onStage", screen.page, [screen.quick]);
        await run("mark:avatar", screen.page, [screen.face]);

        const panel = await run("open", screen.page, [screen.line]);
        panel.send({ type: "ready", language: "zh" });
        await settle();
        const frames = panel.messages.filter(message => message.type === "frames").pop() as { frames: { id: string; checklist: FrameChecklist }[] };
        expect(frames.frames.map(frame => frame.id)).toEqual([screen.frame.id]);
        const checklist = frames.frames[0].checklist;
        expect(checklist.leftOut.map(layer => layer.name)).toEqual(["Background"]);
        const [dialog, quick] = checklist.parts;
        expect(dialog).toMatchObject({ slot: "dialog", marked: true });
        expect(dialog.entries).toEqual([
            { kind: "sentence", status: "guessed", layer: { id: screen.line.id, name: "This line was drawn in Figma" } },
            { kind: "name", status: "guessed", layer: { id: screen.plate.children![0].id, name: "Narra" } },
            { kind: "avatar", status: "marked", layer: { id: screen.face.id, name: "头像" } },
        ]);
        expect(quick.entries).toEqual([
            { kind: "button", status: "named", action: "auto", layer: { id: screen.auto.id, name: "Auto" }, lit: false },
            { kind: "button", status: "named", action: "log", layer: expect.objectContaining({ name: "Log" }) },
        ]);
    });

    it("marks from the panel and reads the frame again", async () => {
        const screen = gameScreen();
        await run("mark:dialog", screen.page, [screen.band]);
        const panel = await run("open", screen.page, [screen.line]);
        panel.send({ type: "ready", language: "en" });
        await settle();
        panel.send({ type: "mark", role: "sentence" });
        await settle();
        expect(panel.notices).toEqual(["Marked 1 layer as Line"]);
        const frames = panel.messages.filter(message => message.type === "frames").pop() as { frames: { checklist: FrameChecklist }[] };
        expect(frames.frames[0].checklist.parts[0].entries[0]).toMatchObject({ kind: "sentence", status: "marked" });
    });
});
