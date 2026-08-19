// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import type { StoryCommandLineEdit, StoryCommandLineRef } from "./storyCommandLine";
import { StoryLineRefToken } from "./StoryLineRefToken";
import { StoryLineValueToken } from "./StoryLineValueToken";
import { StoryRefNavigationContext, useStoryRefLink, type StoryRefNavigation } from "./storyRefNavigation";

/**
 * The gesture that decides between the two things a word on a row can mean.
 *
 * Most names a row prints are both a value a click can change and a reference to what they name, so
 * ONE token has to serve two intentions. Getting the split wrong is not a visible bug: a modifier
 * click that opened the picker instead of the reference just looks like the modifier did nothing, and
 * the author stops trying.
 *
 * Two of these tests exist for failures that were measured rather than imagined:
 *
 *  - **`mouseDown` as well as `click`.** Modifier+click on a row already means "add this row to the
 *    selection", and the row acts on the DOWN. A token that stopped only the click would follow the
 *    reference AND silently rewrite the author's selection on the way through.
 *  - **The modifier resets on window `blur`.** Hold Ctrl, switch windows, come back: the `keyup`
 *    happened somewhere this window never heard, and without the reset the whole scene stays lit up
 *    as links with nothing the author can connect that state back to.
 */

afterEach(cleanup);

const CHARACTER: StoryCommandLineRef = { kind: "character", characterId: "c1" };

/** A boolean edit — the one control that acts in place, so a plain click needs no popover mounted. */
function booleanEdit(apply: (next: string) => StoryBlock["payload"]): StoryCommandLineEdit {
    return { span: { start: 0, end: 4 }, control: { kind: "boolean" }, value: "true", apply };
}

/** A closed list — the shape of every name a row offers a picker for (a character, a scene). */
function choiceEdit(): StoryCommandLineEdit {
    return {
        span: { start: 0, end: 5 },
        control: { kind: "choice", options: [{ value: "c1", label: "Alice" }, { value: "c2", label: "Bo" }] },
        value: "c1",
        apply: () => ({} as StoryBlock["payload"]),
    };
}

function withNavigation(navigation: StoryRefNavigation | null, children: ReactNode) {
    return render(
        <StoryRefNavigationContext.Provider value={navigation}>{children}</StoryRefNavigationContext.Provider>,
    );
}

/** A resolver that can reach everything — the ordinary case, a project with the references intact. */
function reachable(): StoryRefNavigation & { open: ReturnType<typeof vi.fn> } {
    return { canOpen: () => true, open: vi.fn() };
}

describe("a word that is both a value and a reference", () => {
    it("follows the reference on modifier+click, and edits nothing", () => {
        const navigation = reachable();
        const apply = vi.fn(() => ({}) as StoryBlock["payload"]);
        const onApply = vi.fn();
        withNavigation(navigation, (
            <StoryLineValueToken edit={booleanEdit(apply)} target={CHARACTER} onApply={onApply}>Alice</StoryLineValueToken>
        ));
        fireEvent.click(screen.getByText("Alice"), { ctrlKey: true });
        expect(navigation.open).toHaveBeenCalledWith(CHARACTER);
        expect(onApply).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
    });

    it("keeps doing what it always did on a plain click", () => {
        const navigation = reachable();
        const onApply = vi.fn();
        withNavigation(navigation, (
            <StoryLineValueToken edit={booleanEdit(next => ({ flag: next }) as unknown as StoryBlock["payload"])} target={CHARACTER} onApply={onApply}>
                loop
            </StoryLineValueToken>
        ));
        fireEvent.click(screen.getByText("loop"));
        expect(navigation.open).not.toHaveBeenCalled();
        // The boolean flipped in place, which is the original behaviour of this control exactly.
        expect(onApply).toHaveBeenCalledWith({ flag: "false" });
    });

    it("still opens the picker on a plain click when the reference is right there", () => {
        const navigation = reachable();
        withNavigation(navigation, (
            <StoryLineValueToken edit={choiceEdit()} target={CHARACTER} onApply={vi.fn()}>Alice</StoryLineValueToken>
        ));
        fireEvent.click(screen.getByText("Alice"));
        expect(screen.getByText("Bo")).toBeTruthy();
        expect(navigation.open).not.toHaveBeenCalled();
    });

    it("navigates from a row whose writes are dead, because reading is not a write", () => {
        // What a frozen workspace hands a row: `onUpdatePayload` replaced by a no-op. Following a
        // reference is the one thing that must survive it - a frozen project is exactly the one you
        // are reading rather than editing.
        const navigation = reachable();
        withNavigation(navigation, (
            <StoryLineValueToken edit={booleanEdit(() => ({}) as StoryBlock["payload"])} target={CHARACTER} onApply={() => undefined}>
                Alice
            </StoryLineValueToken>
        ));
        fireEvent.click(screen.getByText("Alice"), { metaKey: true });
        expect(navigation.open).toHaveBeenCalledWith(CHARACTER);
    });

    it("swaps its quick-edit underline for the link one while the modifier is down", () => {
        // The two decorations are set by different classes on the SAME element, so the swap only
        // happens if `cn()` resolves them - and a token that kept its dotted grey underline would say
        // "a click edits this" at the exact moment a click would navigate instead.
        const { container } = withNavigation(reachable(), (
            <StoryLineValueToken edit={booleanEdit(() => ({}) as StoryBlock["payload"])} target={CHARACTER} onApply={vi.fn()}>Alice</StoryLineValueToken>
        ));
        const token = () => container.querySelector("button")!;
        expect(token().className).toContain("decoration-dotted");
        fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
        expect(token().className).toContain("decoration-solid");
        expect(token().className).toContain("decoration-primary");
        expect(token().className).not.toContain("decoration-dotted");
        fireEvent.blur(window);
    });

    it("edits as usual when the reference no longer resolves", () => {
        // A deleted character, a scene that was renamed away: the value is still editable, and the
        // modifier must fall through to the editor rather than swallow the click.
        const onApply = vi.fn();
        withNavigation({ canOpen: () => false, open: vi.fn() }, (
            <StoryLineValueToken edit={booleanEdit(next => ({ flag: next }) as unknown as StoryBlock["payload"])} target={CHARACTER} onApply={onApply}>
                loop
            </StoryLineValueToken>
        ));
        fireEvent.click(screen.getByText("loop"), { ctrlKey: true });
        expect(onApply).toHaveBeenCalledWith({ flag: "false" });
    });
});

describe("a word that is only a reference", () => {
    it("does nothing at all on a plain click", () => {
        const navigation = reachable();
        withNavigation(navigation, <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>);
        fireEvent.click(screen.getByText("overlay"));
        expect(navigation.open).not.toHaveBeenCalled();
    });

    it("follows the reference on modifier+click", () => {
        const navigation = reachable();
        withNavigation(navigation, <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>);
        fireEvent.click(screen.getByText("overlay"), { ctrlKey: true });
        expect(navigation.open).toHaveBeenCalledWith(CHARACTER);
    });

    it("stops the PRESS of a jump, because that is when the row would change its selection", () => {
        // Modifier+click on a row means "add this row to the selection", and the row acts on the mouse
        // down. Stopping only the click would follow the reference and rewrite the selection on the
        // way through - a state the author would find afterwards with nothing to connect it to.
        const navigation = reachable();
        const rowMouseDown = vi.fn();
        withNavigation(navigation, (
            <div onMouseDown={rowMouseDown}>
                <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>
            </div>
        ));
        fireEvent.mouseDown(screen.getByText("overlay"), { ctrlKey: true });
        expect(rowMouseDown).not.toHaveBeenCalled();
        // A plain press is left alone, so the row keeps press-to-select and drag-select over the word.
        fireEvent.mouseDown(screen.getByText("overlay"));
        expect(rowMouseDown).toHaveBeenCalledTimes(1);
    });

    it("prints the word untouched when there is no navigation and when nothing resolves", () => {
        // Three surfaces reach this: a preview with no project, a reference whose row was deleted, and
        // a temporary speaker - a name with no character record behind it, so no `target` at all.
        const { container: bare } = withNavigation(null, <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>);
        expect(bare.querySelector("span")).toBeNull();
        cleanup();
        const { container: gone } = withNavigation({ canOpen: () => false, open: vi.fn() }, (
            <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>
        ));
        expect(gone.querySelector("span")).toBeNull();
        expect(gone.textContent).toBe("overlay");
    });
});

describe("a word that names nothing", () => {
    /** What a dialogue row's nametag asks: the character it speaks as, or nothing for a typed name. */
    function Nametag({ characterId }: { characterId?: string }) {
        const link = useStoryRefLink(characterId ? { kind: "character", characterId } : undefined);
        return <span data-testid="nametag">{link ? "link" : "plain"}</span>;
    }

    it("offers nothing for a temporary speaker, who has no record to open", () => {
        // A name typed straight into the nametag is a speaker and not a cast member: there is no
        // character behind it, so the modifier must leave the word alone rather than light up a way
        // through to nowhere.
        withNavigation(reachable(), <Nametag />);
        expect(screen.getByTestId("nametag").textContent).toBe("plain");
        cleanup();
        withNavigation(reachable(), <Nametag characterId="c1" />);
        expect(screen.getByTestId("nametag").textContent).toBe("link");
    });
});

describe("the modifier state itself", () => {
    it("marks the word while the key is down and gives the decoration back on release", () => {
        const navigation = reachable();
        const { container } = withNavigation(navigation, <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>);
        const word = () => container.querySelector("span")!;
        expect(word().className).not.toContain("underline");
        fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
        expect(word().className).toContain("underline");
        expect(word().className).toContain("cursor-pointer");
        fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
        expect(word().className).not.toContain("underline");
    });

    it("resets when the window loses focus, so a scene never stays stuck as one screen of links", () => {
        const navigation = reachable();
        const { container } = withNavigation(navigation, <StoryLineRefToken target={CHARACTER}>overlay</StoryLineRefToken>);
        fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
        expect(container.querySelector("span")!.className).toContain("underline");
        // Alt+Tab away: the release happens where this window will never hear it.
        fireEvent.blur(window);
        expect(container.querySelector("span")!.className).not.toContain("underline");
    });
});
