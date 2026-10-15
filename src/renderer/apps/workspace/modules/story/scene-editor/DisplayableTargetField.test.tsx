// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryDisplayableTargetRef, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { DisplayableTargetField } from "./DisplayableTargetField";

/**
 * What the picker STORES when an author chooses a target.
 *
 * The list it offers is `listSceneDisplayableTargets` and is tested there; the seam here is the one
 * line that turns a chosen option into a stored reference, and the thing it kept dropping is `label`.
 * Without it, a reference whose declaring row is later deleted falls back to `name` - which is the
 * stage KEY, and a character that never got a stage name keys on its id, so the row would read as a
 * UUID. The two paths that write a reference (this one and the command line) must agree, so both are
 * pinned on the same three fields.
 */

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
}));

afterEach(cleanup);

const SCENE_ID = "scene-1";

/** A scene with one image an earlier row created, plus the row doing the picking. */
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
            rootBlockIds: ["b_img", "b_fx"],
            blocks: {
                b_img: {
                    id: "b_img",
                    kind: "action",
                    parentId: null,
                    childrenIds: [],
                    payload: { action: "image", operation: "create", objectName: "hero", assetId: "i1" },
                },
                b_fx: {
                    id: "b_fx",
                    kind: "action",
                    parentId: null,
                    childrenIds: [],
                    payload: { action: "displayable", operation: "transform", target: { name: "" } },
                },
            },
        },
    },
};

function renderField() {
    const onChange = vi.fn<(target: StoryDisplayableTargetRef) => void>();
    render(
        <DisplayableTargetField
            document={DOCUMENT}
            sceneId={SCENE_ID}
            blockId="b_fx"
            target={{ name: "" }}
            onChange={onChange}
        />,
    );
    return onChange;
}

describe("DisplayableTargetField", () => {
    it("stores the stage key, the author-facing label and the declaring row - all three", () => {
        const onChange = renderField();
        fireEvent.click(screen.getAllByRole("button")[0]);
        fireEvent.click(screen.getByRole("option", { name: /hero/ }));
        expect(onChange).toHaveBeenCalledWith({
            name: "hero",
            label: "hero",
            kind: "image",
            sourceBlockId: "b_img",
        });
    });

    it("labels a built-in singleton too, so it reads without being resolved", () => {
        const onChange = renderField();
        fireEvent.click(screen.getAllByRole("button")[0]);
        fireEvent.click(screen.getByRole("option", { name: /Scene background/ }));
        expect(onChange).toHaveBeenCalledWith({
            builtin: "background",
            kind: "image",
            name: "Scene background",
            label: "Scene background",
        });
    });
});

describe("a character walked on without a stage name", () => {
    /**
     * Her reference is labelled with the placeholder "Character", so the field read 「Character 角色」
     * on `@变换 Narra 位置=左` while the row's line and the inspector's header named her Narra.
     */
    const withNarra: StoryDocument = {
        ...DOCUMENT,
        scenes: {
            [SCENE_ID]: {
                ...DOCUMENT.scenes[SCENE_ID],
                rootBlockIds: ["b_enter", "b_move"],
                blocks: {
                    b_enter: {
                        id: "b_enter",
                        kind: "action",
                        parentId: null,
                        childrenIds: [],
                        payload: { action: "character", operation: "enter", characterId: "narra" },
                    },
                    b_move: {
                        id: "b_move",
                        kind: "action",
                        parentId: null,
                        childrenIds: [],
                        payload: {
                            action: "displayable",
                            operation: "transform",
                            target: { name: "narra", label: "Character", kind: "character", sourceBlockId: "b_enter" },
                        },
                    },
                },
            },
        },
    } as StoryDocument;

    it("is named by her cast name, in the field and in its list", () => {
        const narra = Character.fromJSON({ profile: CharacterProfile.create("narra", "Narra", "preset").toJSON() });
        render(
            <DisplayableTargetField
                document={withNarra}
                sceneId={SCENE_ID}
                blockId="b_move"
                target={{ name: "narra", label: "Character", kind: "character", sourceBlockId: "b_enter" }}
                characters={[narra]}
                onChange={() => undefined}
            />,
        );
        const trigger = screen.getAllByRole("button")[0];
        // The name, then the kind word (Character in English, 角色 in Chinese), not the placeholder.
        expect(trigger.querySelector(".truncate")?.textContent).toBe("Narra");
        fireEvent.click(trigger);
        expect(screen.getByRole("option", { name: /Narra/ })).toBeTruthy();
    });
});
