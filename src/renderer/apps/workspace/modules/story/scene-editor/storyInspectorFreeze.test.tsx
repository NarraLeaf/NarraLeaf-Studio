// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { BeyondStoryDocumentClamp, StoryDocumentClamp } from "./storyInspectorFreeze";

/**
 * The action inspector's two clamps, asserted on real controls inside a real `<fieldset disabled>`.
 *
 * Rendered rather than reasoned about because the whole mechanism is the browser's: nothing sets
 * `disabled` on the buttons below, HTML's fieldset rule does. That is also why every assertion asks
 * `matches(":disabled")` and never the `disabled` property - the property reflects the control's own
 * attribute, which stays `false` for a control that a fieldset has switched off.
 *
 * The freeze is supplied through `useWorkspaceFreeze`, the one input `useFreezeGuard` reads, so
 * everything under test here - `isFreezeBlocking`, `freezeAllowsWrite`, `storyDocumentFreezeScope` -
 * is the code the workspace runs.
 */

const THIS_STORY = "chapter-one";
const ANOTHER_STORY = "chapter-two";

const scopeOf = (storyId: string) => `editor/story/stories/${storyId}/storydoc.json`;

const liveSession = (storyId: string): WorkspaceFreezeReason => ({
    kind: "live-session",
    session: "room-1",
    writable: [scopeOf(storyId)],
});

/** Every total freeze, in the shape each of them arrives in. */
const TOTAL_FREEZES: [string, WorkspaceFreezeReason][] = [
    ["revision", { kind: "revision", revision: "abc" }],
    ["manual", { kind: "manual" }],
    ["merge", { kind: "merge" }],
    ["recovery", { kind: "recovery" }],
];

let freeze: WorkspaceFreezeReason | null = null;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => freeze,
}));

vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
    freeze = null;
});

afterEach(cleanup);

/**
 * The inspector's shape: the whole field body under the story-document clamp, with the one subtree
 * that writes past it (the motion picker) clamped again inside.
 */
function renderInspectorBody() {
    render(
        <StoryDocumentClamp storyId={THIS_STORY}>
            <button type="button" data-testid="field">a per-action field</button>
            <BeyondStoryDocumentClamp>
                <button type="button" data-testid="motion">the motion picker</button>
            </BeyondStoryDocumentClamp>
        </StoryDocumentClamp>,
    );
    return {
        field: () => screen.getByTestId("field"),
        motion: () => screen.getByTestId("motion"),
    };
}

describe("the story-document clamp", () => {
    it("leaves every field alone while the project is writable", () => {
        const body = renderInspectorBody();
        expect(body.field().matches(":disabled")).toBe(false);
        expect(body.motion().matches(":disabled")).toBe(false);
    });

    it("keeps the fields live inside a live session on this story", () => {
        // The whole point of the pass: the rows of this document are editable during a session, and
        // the inspector edits those same rows. A greyed inspector would be the editor and the panel
        // saying two different things about one file.
        freeze = liveSession(THIS_STORY);
        expect(renderInspectorBody().field().matches(":disabled")).toBe(false);
    });

    it("switches the fields off when the session names a different story", () => {
        // A scope is a claim about which document is writable, not a way out of a freeze.
        freeze = liveSession(ANOTHER_STORY);
        expect(renderInspectorBody().field().matches(":disabled")).toBe(true);
    });

    it("switches the fields off under every total freeze", () => {
        for (const [name, reason] of TOTAL_FREEZES) {
            freeze = reason;
            const body = renderInspectorBody();
            expect(body.field().matches(":disabled"), name).toBe(true);
            cleanup();
        }
    });
});

describe("the clamp for what writes past the story document", () => {
    it("switches its subtree off inside a live session on this very story", () => {
        // The inner clamp is the reason the outer one may be scoped at all. Minting a motion writes a
        // story animation of its own, which no partial freeze allows, so it stays off while the
        // fields around it are live.
        freeze = liveSession(THIS_STORY);
        const body = renderInspectorBody();
        expect(body.field().matches(":disabled")).toBe(false);
        expect(body.motion().matches(":disabled")).toBe(true);
    });

    it("switches its subtree off under every other freeze too", () => {
        for (const [name, reason] of [...TOTAL_FREEZES, ["other session", liveSession(ANOTHER_STORY)] as const]) {
            freeze = reason;
            expect(renderInspectorBody().motion().matches(":disabled"), name).toBe(true);
            cleanup();
        }
    });
});
