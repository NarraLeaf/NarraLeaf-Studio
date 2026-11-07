import { beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_CLIPBOARD_FORMATS, STUDIO_CLIPBOARD_MAX_BYTES } from "@shared/types/studioClipboard";
import { WindowAppType } from "@shared/types/window";
import type { AppWindow } from "../appWindow";
import {
    ClipboardReadEditorSelectionHandler,
    ClipboardReadPlainTextHandler,
    ClipboardWriteEditorSelectionHandler,
    ClipboardWritePlainTextHandler,
} from "./clipboardAction";

/**
 * The platform clipboard channel's own guards.
 *
 * Every one of them is about a renderer asking for something it may not have: the clipboard is
 * shared with every other application on the machine, so the format name comes out of a fixed table
 * and the payload has a ceiling. The read half exists to prove the ordinary case - a clipboard
 * holding text, or nothing - answers `null` rather than failing, because callers act on that
 * difference: null means "no editor selection here", and a failure would be reported to the author.
 */

const clipboardStore = new Map<string, Buffer>();

vi.mock("electron", () => ({
    clipboard: {
        writeBuffer: (format: string, buffer: Buffer) => {
            // The platform's own behaviour: a buffer write replaces the clipboard.
            clipboardStore.clear();
            clipboardStore.set(format, buffer);
        },
        readBuffer: (format: string) => clipboardStore.get(format) ?? Buffer.alloc(0),
        readText: () => clipboardStore.get("text/plain")?.toString("utf8") ?? "",
        writeText: (text: string) => {
            clipboardStore.clear();
            clipboardStore.set("text/plain", Buffer.from(text, "utf8"));
        },
    },
}));

const writeHandler = new ClipboardWriteEditorSelectionHandler();
const readHandler = new ClipboardReadEditorSelectionHandler();
const readTextHandler = new ClipboardReadPlainTextHandler();
const writeTextHandler = new ClipboardWritePlainTextHandler();

function makeWindow(windowType: WindowAppType = WindowAppType.Workspace): AppWindow {
    return {
        getWindowType: () => windowType,
        app: { logger: { warn: vi.fn() } },
    } as unknown as AppWindow;
}

beforeEach(() => {
    clipboardStore.clear();
});

describe("the editor selection clipboard channel", () => {
    it("hands back exactly what a workspace window wrote", async () => {
        const payload = JSON.stringify({ kind: "narraleaf.ui.elements", note: "ünïcødé ✓" });

        const written = await writeHandler.handle(makeWindow(), { kind: "ui-elements", payload });
        const read = await readHandler.handle(makeWindow(), { kind: "ui-elements" });

        expect(written).toEqual({ success: true, data: { stored: true } });
        expect(read).toEqual({ success: true, data: { payload } });
    });

    it("answers a clipboard holding nothing of ours with null rather than a failure", async () => {
        clipboardStore.set("text/plain", Buffer.from("something an author copied elsewhere", "utf8"));

        expect(await readHandler.handle(makeWindow(), { kind: "ui-elements" }))
            .toEqual({ success: true, data: { payload: null } });
    });

    it("refuses a kind that is not one of Studio's own formats", async () => {
        const written = await writeHandler.handle(makeWindow(), { kind: "elsewhere" as never, payload: "{}" });

        expect(written).toEqual({ success: true, data: { stored: false } });
        expect(clipboardStore.size).toBe(0);
    });

    it("refuses a payload over the ceiling, leaving the clipboard as it was", async () => {
        await writeHandler.handle(makeWindow(), { kind: "ui-elements", payload: "{\"kept\":true}" });

        const written = await writeHandler.handle(makeWindow(), {
            kind: "ui-elements",
            payload: "x".repeat(STUDIO_CLIPBOARD_MAX_BYTES + 1),
        });

        expect(written).toEqual({ success: true, data: { stored: false } });
        expect(clipboardStore.get(STUDIO_CLIPBOARD_FORMATS["ui-elements"])?.toString("utf8")).toBe("{\"kept\":true}");
    });

    it("takes no part from a window that runs a game rather than edits one", async () => {
        const written = await writeHandler.handle(makeWindow(WindowAppType.DevMode), { kind: "ui-elements", payload: "{}" });
        const read = await readHandler.handle(makeWindow(WindowAppType.DevMode), { kind: "ui-elements" });

        expect(written).toEqual({ success: true, data: { stored: false } });
        expect(read).toEqual({ success: true, data: { payload: null } });
    });
});

describe("the plain text clipboard channel", () => {
    it("hands a workspace window the clipboard's text, and null when there is none", async () => {
        expect(await readTextHandler.handle(makeWindow())).toEqual({ success: true, data: { text: null } });
        clipboardStore.set("text/plain", Buffer.from("boot: blueprint.event.head.appBoot", "utf8"));
        expect(await readTextHandler.handle(makeWindow()))
            .toEqual({ success: true, data: { text: "boot: blueprint.event.head.appBoot" } });
    });

    it("gives a window that is not a workspace nothing", async () => {
        clipboardStore.set("text/plain", Buffer.from("anything", "utf8"));
        expect(await readTextHandler.handle(makeWindow(WindowAppType.DevMode)))
            .toEqual({ success: true, data: { text: null } });
    });

    it("puts a workspace window's text on the clipboard, in place of what was there", async () => {
        await writeHandler.handle(makeWindow(), { kind: "ui-elements", payload: "{}" });
        const written = await writeTextHandler.handle(makeWindow(), { text: "log: blueprint.log" });

        expect(written).toEqual({ success: true, data: { stored: true } });
        expect(await readTextHandler.handle(makeWindow())).toEqual({ success: true, data: { text: "log: blueprint.log" } });
        expect(await readHandler.handle(makeWindow(), { kind: "ui-elements" })).toEqual({ success: true, data: { payload: null } });
    });

    it("declines empty or oversized text, and any window that is not a workspace", async () => {
        clipboardStore.set("text/plain", Buffer.from("kept", "utf8"));
        for (const [window, text] of [
            [makeWindow(), ""],
            [makeWindow(), "x".repeat(STUDIO_CLIPBOARD_MAX_BYTES + 1)],
            [makeWindow(WindowAppType.DevMode), "log: blueprint.log"],
        ] as const) {
            expect(await writeTextHandler.handle(window, { text })).toEqual({ success: true, data: { stored: false } });
        }
        expect(await readTextHandler.handle(makeWindow())).toEqual({ success: true, data: { text: "kept" } });
    });
});
