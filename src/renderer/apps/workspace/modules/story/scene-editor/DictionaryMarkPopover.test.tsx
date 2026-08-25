// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { DictionaryMarkPopover } from "./DictionaryMarkPopover";
import type { DictionaryClickInfo } from "./RichTextInput";
import { StoryDocumentScopeProvider, storyDocumentFreezeScope } from "./storySceneReadOnly";

/**
 * Which freezes leave the dictionary popover's one action working.
 *
 * What it writes is the text of the row underneath it - the term over a variant, the reading over a
 * word - through the field's own edit path, so it belongs to the story document and to nothing else.
 * The point of this file is that it says so: before the scope, a live session left the row editable
 * and switched off the panel that corrects the very word being typed.
 *
 * The scope reaches the panel through the scene editor's context, which is why every case below
 * mounts it inside a `StoryDocumentScopeProvider` - and why the last one mounts it outside any.
 */

const THIS_STORY = "chapter-one";
const ANOTHER_STORY = "chapter-two";

const liveSession = (storyId: string): WorkspaceFreezeReason => ({
    kind: "live-session",
    session: "room-1",
    writable: [storyDocumentFreezeScope(storyId)!],
});

let freeze: WorkspaceFreezeReason | null = null;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => freeze,
}));

vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null, isInitialized: false }),
}));

vi.mock("@/lib/components/layout", () => ({
    useDismissWhenHidden: () => undefined,
}));

vi.mock("@/apps/workspace/modules/dictionary/openDictionaryPanel", () => ({
    openDictionaryPanel: () => undefined,
}));

beforeEach(() => {
    freeze = null;
});

afterEach(cleanup);

/** A variant mark, whose one action writes the project's own term over the word the author typed. */
const TARGET: DictionaryClickInfo = {
    mark: {
        kind: "variant",
        term: "colour",
        replacement: "colour",
        text: "color",
        start: 0,
        end: 5,
        unitStart: 0,
        unitEnd: 5,
    },
    anchor: { top: 100, left: 100, bottom: 120 },
};

function renderPopover(scope: string | undefined) {
    render(
        <StoryDocumentScopeProvider value={scope}>
            <DictionaryMarkPopover
                target={TARGET}
                onReplace={() => undefined}
                onApplyReading={() => undefined}
                onClose={() => undefined}
            />
        </StoryDocumentScopeProvider>,
    );
    return screen.getByText("story.dictionary.replaceWith").closest("button")!;
}

describe("the dictionary mark popover", () => {
    it("offers the correction while the project is writable", () => {
        expect(renderPopover(storyDocumentFreezeScope(THIS_STORY)).matches(":disabled")).toBe(false);
    });

    it("keeps the correction live inside a live session on this story", () => {
        freeze = liveSession(THIS_STORY);
        expect(renderPopover(storyDocumentFreezeScope(THIS_STORY)).matches(":disabled")).toBe(false);
    });

    it("switches it off when the session names a different story", () => {
        freeze = liveSession(ANOTHER_STORY);
        expect(renderPopover(storyDocumentFreezeScope(THIS_STORY)).matches(":disabled")).toBe(true);
    });

    it("switches it off under every total freeze", () => {
        const total: [string, WorkspaceFreezeReason][] = [
            ["revision", { kind: "revision", revision: "abc" }],
            ["manual", { kind: "manual" }],
            ["merge", { kind: "merge" }],
            ["recovery", { kind: "recovery" }],
        ];
        for (const [name, reason] of total) {
            freeze = reason;
            expect(renderPopover(storyDocumentFreezeScope(THIS_STORY)).matches(":disabled"), name).toBe(true);
            cleanup();
        }
    });

    it("names no document outside a scene editor, and is frozen by any freeze at all", () => {
        // The default that keeps every surface that has not opted in correct.
        freeze = liveSession(THIS_STORY);
        expect(renderPopover(undefined).matches(":disabled")).toBe(true);
    });
});
