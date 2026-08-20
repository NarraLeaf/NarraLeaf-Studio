import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { readUiEditorClipboardPayload, type UIEditorClipboardPayload } from "./uiEditorClipboard";

/**
 * Reading a payload back off the machine's clipboard.
 *
 * Everything here is about a payload written by *another process* - another project's window, or
 * another Studio of another version. Two things have to hold at once: nothing shaped wrongly may
 * reach the paste, which indexes into `elements` and walks `childrenIds`; and every id has to
 * survive untouched, because keeping them is what lets an imported asset make its widget resolve
 * without a single prop being rewritten.
 */

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
    return { parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 10, height: 10 }, ...input };
}

function written(overrides: Partial<UIEditorClipboardPayload> = {}): string {
    const payload: UIEditorClipboardPayload = {
        v: 1,
        kind: "narraleaf.ui.elements",
        copyId: "copy-1",
        source: { path: "D:\\games\\one", identifier: "com.example.one", name: "One" },
        sourceSurfaceId: "surface",
        topLevelElementIds: ["card"],
        elements: {
            card: element({
                id: "card",
                type: "nl.container",
                childrenIds: ["art"],
                props: { imageFill: { assetId: "asset-a" } },
            }),
            art: element({ id: "art", type: "nl.image", parentId: "card", props: { assetId: "asset-b" } }),
        },
        widgetMainBlueprints: {},
        widgetValueBlueprints: {},
        ...overrides,
    };
    return JSON.stringify(payload);
}

describe("reading an interface selection off the clipboard", () => {
    it("comes back with every id it was written with", () => {
        const payload = readUiEditorClipboardPayload(written());

        expect(payload?.copyId).toBe("copy-1");
        expect(payload?.source?.path).toBe("D:\\games\\one");
        expect(payload?.topLevelElementIds).toEqual(["card"]);
        expect(payload?.elements.card.props).toEqual({ imageFill: { assetId: "asset-a" } });
        expect(payload?.elements.art.props).toEqual({ assetId: "asset-b" });
    });

    it("carries props this Studio has never heard of", () => {
        // A widget contributed by a plugin the pasting project also has must survive the trip whole;
        // dropping what the reader does not recognise would quietly empty it.
        const json = written({
            elements: {
                card: element({ id: "card", type: "acme.gauge", props: { needle: { colour: "red" }, ticks: [1, 2, 3] } }),
            },
            topLevelElementIds: ["card"],
        });

        expect(readUiEditorClipboardPayload(json)?.elements.card.props)
            .toEqual({ needle: { colour: "red" }, ticks: [1, 2, 3] });
    });

    it("refuses anything that is not one of ours", () => {
        expect(readUiEditorClipboardPayload("not json")).toBeNull();
        expect(readUiEditorClipboardPayload(JSON.stringify({ kind: "narraleaf.story.actions", roots: [] }))).toBeNull();
        expect(readUiEditorClipboardPayload(written({ kind: undefined }))).toBeNull();
    });

    it("refuses a payload whose roots name nothing it carries", () => {
        expect(readUiEditorClipboardPayload(written({ topLevelElementIds: ["absent"] }))).toBeNull();
        expect(readUiEditorClipboardPayload(written({ elements: {} }))).toBeNull();
    });

    it("drops an entry that is not shaped like an element, keeping the rest", () => {
        const json = JSON.stringify({
            ...JSON.parse(written()),
            elements: {
                card: element({ id: "card", type: "nl.container" }),
                broken: { id: "broken", type: "nl.text" },
            },
        });

        const payload = readUiEditorClipboardPayload(json);

        expect(Object.keys(payload?.elements ?? {})).toEqual(["card"]);
    });

    it("keeps a manifest's ids and drops the entries that name no file", () => {
        const json = written({
            assets: {
                token: "token-1",
                entries: [
                    { assetId: "asset-a", fileName: "sky.png", type: "image" },
                    { fileName: "nameless.png", type: "image" } as never,
                ],
            },
        });

        expect(readUiEditorClipboardPayload(json)?.assets)
            .toEqual({ token: "token-1", entries: [{ assetId: "asset-a", fileName: "sky.png", type: "image" }] });
    });

    it("reads a manifest with no token as no manifest at all", () => {
        // The field means "these files can be fetched"; without a token nothing can be.
        const json = written({ assets: { entries: [{ assetId: "asset-a", fileName: "sky.png", type: "image" }] } as never });

        expect(readUiEditorClipboardPayload(json)?.assets).toBeUndefined();
    });
});
