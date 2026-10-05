// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument, StoryLayerRef } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { StoryLayerField } from "./StoryLayerField";

/**
 * The layer list as the keyboard meets it, inside the thing it is always inside: the story action
 * inspector, whose own Escape leaves the inspector.
 *
 * The list used to answer no key at all, so an Escape pressed in it travelled up to the inspector
 * and closed that instead - the list, the field and the inspector gone in one press.
 */

afterEach(cleanup);

const SCENE_ID = "scene-1";

const DOCUMENT: StoryDocument = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Story",
    chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE_ID] }],
    scenes: {
        [SCENE_ID]: {
            id: SCENE_ID,
            name: "Scene",
            runtimeName: "scene",
            rootBlockIds: ["b_img"],
            blocks: {
                b_img: {
                    id: "b_img",
                    kind: "action",
                    parentId: null,
                    childrenIds: [],
                    payload: { action: "image", operation: "create", objectName: "hero", assetId: "i1" },
                },
            },
        },
    },
};

function renderInInspector() {
    const onCloseInspector = vi.fn();
    const onChange = vi.fn<(ref: StoryLayerRef) => void>();
    render(
        // The inspector's root, reduced to the one handler that matters here.
        <div
            onKeyDown={event => {
                if (event.key === "Escape") {
                    onCloseInspector();
                }
            }}
        >
            <StoryLayerField
                document={DOCUMENT}
                sceneId={SCENE_ID}
                blockId="b_img"
                value={undefined}
                onChange={onChange}
                onCreateLayer={() => null}
            />
        </div>,
    );
    const trigger = screen.getAllByRole("button")[0];
    return { trigger, onCloseInspector, onChange };
}

async function open(trigger: HTMLElement) {
    trigger.focus();
    fireEvent.click(trigger);
    // The layer places the focus in a layout effect, retrying on the next frame.
    await act(async () => {
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    });
}

describe("StoryLayerField's list", () => {
    it("opens with the focus on a row, and Escape closes the list but not the inspector", async () => {
        const { trigger, onCloseInspector } = renderInInspector();
        await open(trigger);
        const focused = document.activeElement as HTMLElement;
        expect(focused.getAttribute("role")).toBe("option");

        fireEvent.keyDown(focused, { key: "Escape" });
        expect(screen.queryAllByRole("option")).toHaveLength(0);
        expect(onCloseInspector).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);
    });

    it("walks its rows with the arrow keys", async () => {
        const { trigger } = renderInInspector();
        await open(trigger);
        const options = screen.getAllByRole("option");
        const start = options.indexOf(document.activeElement as HTMLElement);
        expect(start).toBeGreaterThanOrEqual(0);

        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
        expect(document.activeElement).toBe(options[(start + 1) % options.length]);
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
        expect(document.activeElement).toBe(options[options.length - 1]);
    });

    it("gives the focus back to the field after a pick", async () => {
        const { trigger, onChange } = renderInInspector();
        await open(trigger);
        fireEvent.click(screen.getAllByRole("option")[0]);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(screen.queryAllByRole("option")).toHaveLength(0);
        expect(document.activeElement).toBe(trigger);
    });
});
