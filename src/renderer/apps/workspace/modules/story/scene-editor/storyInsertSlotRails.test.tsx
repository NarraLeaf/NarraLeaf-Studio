// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "./storySceneEditorTypes";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandResolution";
import { InsertRow } from "./StorySceneEditorRows";

/**
 * The open slot is a row that does not exist yet, so nothing in the list's lookahead
 * (`annotateNestingBranches`) can see it. Its rails have to be told separately where they end:
 * at the line being typed when nothing follows, and running on when something does.
 *
 * The bug this pins: the slot passed its own depth as the lookahead, so no level "ended here" and
 * every inherited rail ran straight to the bottom of the slot — a container's last line bent right,
 * and the blank line offered for the next one drew the rail past it into nothing.
 */

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null, isInitialized: false }),
    useOptionalWorkspace: () => null,
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                getGlobalState: async () => ({ success: true, data: { value: undefined } }),
                setGlobalState: async () => ({ success: true, data: undefined }),
                onGlobalStateChanged: () => ({ cancel: () => {} }),
            },
        },
    }),
}));

afterEach(cleanup);

type InsertMode = Extract<EditorMode, { kind: "insert" }>;

const mode: InsertMode = { kind: "insert", slot: { afterBlockId: "row-1", focusToken: 1 }, initialValue: "" };

function renderSlot(props: { depth?: number; nextDepth?: number; density?: "compact" | "standard" | "comfortable" }) {
    const noop = () => {};
    const view = render(
        <InsertRow
            mode={mode}
            depth={props.depth}
            nextDepth={props.nextDepth}
            density={props.density}
            characters={[]}
            tempSpeakers={[]}
            commandContext={EMPTY_STORY_COMMAND_CONTEXT}
            inputRef={createRef<HTMLTextAreaElement>()}
            draftRef={{ current: "" }}
            onValueChange={noop}
            onCommitNarration={noop}
            onDismissChooser={noop}
            onDiscardSlot={noop}
            onResolveLine={noop}
            onCommitInvalid={noop}
            onChooseCommand={noop}
            onChooseCharacter={noop}
            onChooseTempSpeaker={noop}
            onBackspaceEmpty={noop}
            slashAtAlias
        />,
    );
    const rails = [...view.container.querySelectorAll<HTMLElement>("[data-story-rail]")];
    return {
        rails,
        elbows: rails.filter(rail => rail.hasAttribute("data-story-rail-elbow")),
    };
}

/** `py-1` (4px) plus half the compact row box (28px) — the same centre a committed row stops at. */
const COMPACT_STOP = 4 + 28 / 2;

describe("the rails a slot inherits", () => {
    it("ends them at the line it will commit, turning the deepest one right", () => {
        const { rails, elbows } = renderSlot({ depth: 2, nextDepth: 0 });
        // One rail per ancestor level — the menu's and the option's.
        expect(rails).toHaveLength(2);
        // Only the deepest turns: its own turn is the one at the line being typed.
        expect(elbows).toHaveLength(1);
        expect(rails[1]).toBe(elbows[0]);
        // Ended, so a height rather than `bottom: 0`.
        for (const rail of rails) {
            expect(rail.style.height).toBe(`${COMPACT_STOP}px`);
            expect(rail.style.bottom).toBe("");
        }
    });

    it("runs them through when a row follows at the same depth", () => {
        const { rails, elbows } = renderSlot({ depth: 2, nextDepth: 2 });
        expect(rails).toHaveLength(2);
        expect(elbows).toHaveLength(0);
        for (const rail of rails) {
            expect(rail.style.height).toBe("");
            expect(rail.style.bottom).toBe("0px");
        }
    });

    it("ends a single level's rail when only the option's body is open", () => {
        const { rails, elbows } = renderSlot({ depth: 1, nextDepth: 0 });
        expect(rails).toHaveLength(1);
        expect(elbows).toHaveLength(1);
    });

    it("draws nothing at the scene's own level", () => {
        expect(renderSlot({ depth: 0, nextDepth: 0 }).rails).toHaveLength(0);
    });

    it("turns at the text centre of the density it is set in, not of the compact box", () => {
        const { rails } = renderSlot({ depth: 1, nextDepth: 0, density: "comfortable" });
        expect(rails[0].style.height).toBe(`${4 + 38 / 2}px`);
    });
});
