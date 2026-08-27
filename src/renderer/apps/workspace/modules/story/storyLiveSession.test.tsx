// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story as en } from "@shared/i18n/catalog/en/story";
import { makeFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import { storyEditGuard, useStoryLiveSessionGuard } from "./storyLiveSession";

/**
 * The question every story surface that writes outside a session's vocabulary has to ask.
 *
 * Asked of the session service rather than worked out from the freeze, so the fake below is the
 * session and nothing else: a session arms a freeze that deliberately leaves this document
 * writable, and reading the freeze would therefore answer "you may write" at exactly the moment
 * this guard has to answer "and nobody else will hear about it".
 */

const THIS_STORY = "chapter-one";
const ANOTHER_STORY = "chapter-two";

const IN_A_SESSION = en.live.editUnavailable;

/** Which story a session owns, if any, and who is listening for that to change. */
let ownedStoryId: string | null = null;
const listeners = new Set<() => void>();

const liveSessionService = {
    ownsStory: (storyId: string) => ownedStoryId !== null && ownedStoryId === storyId,
    onChanged: (handler: () => void) => {
        listeners.add(handler);
        return () => {
            listeners.delete(handler);
        };
    },
};

// One object for the life of the file: the hook memoizes on the context's identity, and a fresh one
// per render would rebuild the subscription on every keystroke in a real workspace.
const workspace = {
    context: {
        services: {
            get: (id: unknown) => (id === Services.Live ? liveSessionService : null),
        },
    },
    isInitialized: true,
};

vi.mock("../../context", () => ({
    useWorkspace: () => workspace,
}));

/** A session opening, ending, or moving to another story, as the service reports it. */
function sessionNow(storyId: string | null): void {
    act(() => {
        ownedStoryId = storyId;
        for (const listener of [...listeners]) {
            listener();
        }
    });
}

function Probe({ storyId }: { storyId?: string }) {
    const guard = useStoryLiveSessionGuard(storyId);
    return <button type="button" {...guard.writes()}>edit</button>;
}

const control = () => screen.getByRole("button");

beforeEach(() => {
    ownedStoryId = null;
    listeners.clear();
});

afterEach(cleanup);

describe("a control that asks whether a session owns this story", () => {
    it("stays live when no session is open", () => {
        render(<Probe storyId={THIS_STORY} />);

        expect(control().matches(":disabled")).toBe(false);
        expect(control().getAttribute("data-tip")).toBeNull();
    });

    it("comes off with a reason while a session owns this story", () => {
        ownedStoryId = THIS_STORY;
        render(<Probe storyId={THIS_STORY} />);

        expect(control().matches(":disabled")).toBe(true);
        expect(control().getAttribute("data-tip")).toBe(IN_A_SESSION);
        // Disabled, not hidden: the control is still where the author left it.
        expect(control().textContent).toBe("edit");
    });

    it("is left alone by a session on a different story", () => {
        ownedStoryId = ANOTHER_STORY;
        render(<Probe storyId={THIS_STORY} />);

        expect(control().matches(":disabled")).toBe(false);
    });

    it("follows a session that opens and ends while the panel stays mounted", () => {
        render(<Probe storyId={THIS_STORY} />);
        expect(control().matches(":disabled")).toBe(false);

        sessionNow(THIS_STORY);
        expect(control().matches(":disabled")).toBe(true);

        sessionNow(null);
        expect(control().matches(":disabled")).toBe(false);
    });

    it("answers 'not owned' for a surface with no story selected", () => {
        ownedStoryId = THIS_STORY;
        render(<Probe />);

        expect(control().matches(":disabled")).toBe(false);
    });
});

describe("the two guards a story surface keeps straight", () => {
    const FROZEN = "the workspace's own sentence";
    const session = makeFreezeGuard(true, IN_A_SESSION);
    const openSession = makeFreezeGuard(false, IN_A_SESSION);

    it("shows the workspace's sentence when the freeze covers this document", () => {
        // Every other control in the editor is already showing it, so a second wording here would
        // make one greyed control look like a different kind of trouble from the rest.
        const guard = storyEditGuard(makeFreezeGuard(true, FROZEN), session);

        expect(guard.frozen).toBe(true);
        expect(guard.reason).toBe(FROZEN);
    });

    it("shows the session's sentence when the freeze spares this document", () => {
        const guard = storyEditGuard(makeFreezeGuard(false, FROZEN), session);

        expect(guard.frozen).toBe(true);
        expect(guard.reason).toBe(IN_A_SESSION);
    });

    it("holds nothing back when neither applies", () => {
        expect(storyEditGuard(makeFreezeGuard(false, FROZEN), openSession).frozen).toBe(false);
    });
});
