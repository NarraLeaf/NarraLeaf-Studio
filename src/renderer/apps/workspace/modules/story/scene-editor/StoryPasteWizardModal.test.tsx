// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { PastePlan, SpeakerMappingTarget, StoryPasteMemory } from "@/lib/story/paste/storyPasteTypes";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { StoryDocumentScopeProvider, storyDocumentFreezeScope } from "./storySceneReadOnly";
import { StoryPasteWizardModal } from "./StoryPasteWizardModal";

/** The story the wizard is pasting into, and the one a session below may leave writable. */
const THIS_STORY = "chapter-one";

/** The reason a control shows when the freeze it hit spares this story document. */
const IN_A_SESSION = "Unavailable in a live session. Choose an existing character.";

let freeze: WorkspaceFreezeReason | null = null;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => freeze,
}));

beforeEach(() => {
    freeze = null;
});

afterEach(cleanup);

const EMPTY_MEMORY: StoryPasteMemory = { version: 1, speakers: {}, separators: [] };

/** Two speakers, so one can be touched and the other left exactly as the wizard computed it. */
const SCRIPT = ["林：走吧。", "早苗：等一下。", "外面还在下雨。", "林：快点。"].join("\n");

function character(id: string, name: string, nicknames: string[] = []): Character {
    return {
        profile: {
            getId: () => id,
            getName: () => name,
            getNicknames: () => nicknames,
        },
    } as unknown as Character;
}

function renderWizard(overrides: Partial<React.ComponentProps<typeof StoryPasteWizardModal>> = {}) {
    const onConfirm = vi.fn<(plan: PastePlan, mappings: Record<string, SpeakerMappingTarget>) => void>();
    const onCancel = vi.fn();
    // Built fresh on every call rather than held: `rerender` with the very same element lets React
    // bail out of the subtree, and the freeze below changes underneath the wizard rather than in it.
    const tree = () => (
        // The scope the scene editor puts around it: which document the rows this paste makes land
        // in, which is what tells a freeze that spares it from one that does not.
        <StoryDocumentScopeProvider value={storyDocumentFreezeScope(THIS_STORY)}>
            <StoryPasteWizardModal
                open
                text={SCRIPT}
                inferred={{ kind: "fullwidthColon" }}
                characters={[]}
                memory={EMPTY_MEMORY}
                onSaveSeparator={() => undefined}
                onForgetSeparator={() => undefined}
                onCancel={onCancel}
                onConfirm={onConfirm}
                {...overrides}
            />
        </StoryDocumentScopeProvider>
    );
    const view = render(tree());
    return { view, onConfirm, onCancel, rerender: () => view.rerender(tree()) };
}

/**
 * Pick a target for one speaker row, through the same menu the author uses.
 *
 * The option is looked up inside the menu itself: the `Select` menu is portalled onto `<body>` (so it
 * is the last element there), and every trigger already renders the label of whatever it is showing -
 * so "Name only" appears three times on screen and only one of them is a thing to click.
 */
function chooseTarget(label: string, optionText: string): void {
    fireEvent.click(within(openTargetMenu(label)).getByText(optionText));
}

/** The same menu, left open, for the assertions that are about an option rather than about picking it. */
function openTargetMenu(label: string): HTMLElement {
    const row = document.querySelector(`[data-story-paste-speaker="${label}"]`);
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getAllByRole("button")[0]!);
    const panels = document.body.querySelectorAll(":scope > div");
    return panels[panels.length - 1] as HTMLElement;
}

/** One option row of an open target menu, as the control the author would press. */
function targetOption(menu: HTMLElement, optionText: string): HTMLButtonElement {
    const option = within(menu).getByText(optionText).closest("button");
    expect(option, optionText).not.toBeNull();
    return option as HTMLButtonElement;
}

function confirm(): void {
    fireEvent.click(screen.getByText("Paste"));
}

/** The wizard's confirm, as a control rather than as a gesture. */
function pasteButton(): HTMLButtonElement {
    return screen.getByText("Paste").closest("button") as HTMLButtonElement;
}

const liveSession = (storyId: string): WorkspaceFreezeReason => ({
    kind: "live-session",
    session: "room-1",
    writable: [storyDocumentFreezeScope(storyId)!],
});

/**
 * The wizard's second way to make a cast member, under a freeze that leaves this story writable.
 *
 * The rows a paste produces are this story document, and a live session on it is being sent them; the
 * characters the plan names are not, and they would exist on this machine and on no other, leaving
 * every pasted row pointing at nothing on everybody else's. So the target comes off and the rest of
 * the wizard keeps working - the same bargain the row's own picker makes.
 *
 * `matches(":disabled")` throughout: `Select` renders its rows as real buttons, and the property
 * would answer for the option's own attribute rather than for anything above it.
 */
describe("StoryPasteWizardModal speaker targets under a freeze", () => {
    it("offers the New character target while the project is writable", () => {
        renderWizard();

        const option = targetOption(openTargetMenu("林"), "New character");

        expect(option.matches(":disabled")).toBe(false);
    });

    it("shows the New character target switched off, with a reason, inside a live session", () => {
        freeze = liveSession(THIS_STORY);
        renderWizard();

        const option = targetOption(openTargetMenu("林"), "New character");

        expect(option.matches(":disabled")).toBe(true);
        // Shown, not dropped: a target that vanished reads as the wizard having lost the ability.
        expect(option.textContent).toContain("New character");
        expect(option.textContent).toContain(IN_A_SESSION);
    });

    it("leaves every other target pickable inside that same session", () => {
        // Binding to a character that exists, or keeping a bare name, writes the rows and nothing
        // else - which is exactly what the session is carrying.
        freeze = liveSession(THIS_STORY);
        const { onConfirm } = renderWizard();

        chooseTarget("早苗", "Not a speaker");
        expect(pasteButton().matches(":disabled")).toBe(false);
        confirm();

        expect(onConfirm.mock.calls[0]![1]).toEqual({ 早苗: { kind: "notASpeaker" } });
    });

    it("says the workspace's own sentence when the freeze covers this story too", () => {
        // No panel invents a live-session claim under a freeze that is not one: the editor around it
        // is already off, and the reason it is showing everywhere else is the right one here.
        freeze = { kind: "manual" };
        renderWizard();

        const option = targetOption(openTargetMenu("林"), "New character");

        expect(option.matches(":disabled")).toBe(true);
        expect(option.textContent).toContain("Unavailable while the project is frozen.");
    });

    it("refuses the confirm when a session starts under the open dialog", () => {
        // The one way a plan can still carry a character to create: the author chose the target and
        // the workspace changed underneath them. Saying so on the button is what keeps it from
        // looking like it would work - the controller refuses this plan either way.
        const { rerender } = renderWizard();
        chooseTarget("林", "New character");
        expect(pasteButton().matches(":disabled")).toBe(false);

        freeze = liveSession(THIS_STORY);
        rerender();

        expect(pasteButton().matches(":disabled")).toBe(true);
        expect(pasteButton().getAttribute("data-tip")).toBe(IN_A_SESSION);
    });
});

/**
 * What the wizard hands back to be REMEMBERED.
 *
 * Every tally used to be handed over, computed defaults included, and the controller wrote all of them
 * to the per-project memory. Two things followed: a label the author never looked at (including one the
 * inference invented) was recorded forever, and because memory is consulted ahead of the name match, a
 * character created later was permanently shadowed by the "Name only" that had been guessed for it -
 * with no UI anywhere to clear it.
 */
describe("StoryPasteWizardModal mapping memory", () => {
    it("hands back nothing to remember when the author touched nothing", () => {
        const { onConfirm } = renderWizard();

        confirm();

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm.mock.calls[0]![1]).toEqual({});
    });

    it("hands back only the decision the author actually made", () => {
        const { onConfirm } = renderWizard();

        chooseTarget("早苗", "Not a speaker");
        confirm();

        expect(onConfirm.mock.calls[0]![1]).toEqual({ 早苗: { kind: "notASpeaker" } });
    });

    /**
     * A default is not a decision even when the author opens the menu and picks the same thing back:
     * re-selecting the value already shown says nothing the wizard did not already know.
     */
    it("does not count re-picking the computed default as a decision", () => {
        const { onConfirm } = renderWizard();

        // 早苗 matches no character, so "Name only" is exactly what the row already showed.
        chooseTarget("早苗", "Name only");
        confirm();

        expect(onConfirm.mock.calls[0]![1]).toEqual({});
    });

    /** The plan is unaffected: an untouched label still gets its computed default in the rows. */
    it("still applies the computed default to the rows themselves", () => {
        const { onConfirm } = renderWizard({ characters: [character("cccccccc-cccc-4ccc-8ccc-ccccccccccc1", "林")] });

        confirm();

        const plan = onConfirm.mock.calls[0]![0];
        expect(plan.rows[0]).toEqual({ kind: "dialogue", text: "走吧。", characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1" });
        expect(plan.rows[1]).toEqual({ kind: "dialogue", text: "等一下。", speakerName: "早苗" });
    });
});

/**
 * The wizard takes focus, which is what keeps Escape from reaching the surface underneath.
 *
 * `Modal`'s Escape listener is on `document` and bubbles, so whatever holds the caret answers the key
 * first: an insert slot discards its draft, a row being edited *commits* it - a `recordHistory` plus an
 * `updateBlock`, i.e. Escape-to-cancel writing to the document. Moving focus into the dialog is both
 * the a11y-correct behaviour and the fix, and it is scoped to this wizard rather than to `Modal`.
 */
describe("StoryPasteWizardModal focus", () => {
    function Surface(props: { wizard: boolean; onSurfaceKeyDown: () => void; onCancel: () => void }) {
        const caretRef = useRef<HTMLTextAreaElement | null>(null);
        return (
            <div>
                <textarea ref={caretRef} data-testid="caret" onKeyDown={props.onSurfaceKeyDown} />
                {props.wizard ? (
                    <StoryPasteWizardModal
                        open
                        text={SCRIPT}
                        inferred={{ kind: "fullwidthColon" }}
                        characters={[]}
                        memory={EMPTY_MEMORY}
                        onSaveSeparator={() => undefined}
                        onForgetSeparator={() => undefined}
                        onCancel={props.onCancel}
                        onConfirm={() => undefined}
                    />
                ) : null}
            </div>
        );
    }

    it("takes the caret off the surface underneath, so Escape never reaches it", () => {
        const onSurfaceKeyDown = vi.fn();
        const onCancel = vi.fn();
        const view = render(<Surface wizard={false} onSurfaceKeyDown={onSurfaceKeyDown} onCancel={onCancel} />);
        const caret = view.getByTestId("caret");
        caret.focus();
        expect(document.activeElement).toBe(caret);

        view.rerender(<Surface wizard onSurfaceKeyDown={onSurfaceKeyDown} onCancel={onCancel} />);

        const active = document.activeElement as HTMLElement;
        expect(active).not.toBe(caret);
        expect(screen.getByText("Paste as Rows").closest("div[class*='bg-surface-raised']")?.contains(active)).toBe(true);

        fireEvent.keyDown(active, { key: "Escape" });

        expect(onSurfaceKeyDown).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
