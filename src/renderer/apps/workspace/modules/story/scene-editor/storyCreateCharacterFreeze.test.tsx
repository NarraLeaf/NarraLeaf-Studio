// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { StoryDocumentScopeProvider, storyDocumentFreezeScope } from "./storySceneReadOnly";
import { CharacterSelectTrigger } from "./StorySceneEditorRows";

/**
 * The speaker nametag under a freeze that leaves this story document writable.
 *
 * The picker is one control with two different writes behind it. Picking a cast member who already
 * exists rewrites a dialogue payload and nothing else, so a live session on this story - which is
 * the whole reason the author has the scene open - must leave it working. The rung underneath it
 * creates a character first and rebinds afterwards, and only story operations travel between the
 * people in a session, so the character would exist on one machine and the rows naming it would
 * point at nothing on every other.
 *
 * Rendered rather than reasoned about, and every assertion asks `matches(":disabled")`: the rung is
 * a real `<button>`, and the property would answer for its own attribute rather than for whatever an
 * ancestor did to it.
 */

const THIS_STORY = "chapter-one";
const ANOTHER_STORY = "chapter-two";

/** The reason a control shows when the freeze it hit spares this story document. */
const IN_A_SESSION = "Unavailable in a live session. Choose an existing character.";
/** The workspace's own one string, for the freezes that switch the whole editor off. */
const FROZEN = "Unavailable while the project is frozen. Unfreeze the project to use it.";
/** The same string for the one freeze that is left rather than unfrozen. */
const FROZEN_LIVE = "Unavailable during a live session. Leave the session to use it.";

const liveSession = (storyId: string): WorkspaceFreezeReason => ({
    kind: "live-session",
    session: "room-1",
    writable: [storyDocumentFreezeScope(storyId)!],
});

let freeze: WorkspaceFreezeReason | null = null;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => freeze,
}));

// The candidate's avatar reads the workspace's own services, which no test has. It is a picture
// beside a name and nothing under test here depends on it.
vi.mock("./storyCandidateMark", () => ({
    StoryCandidateSpeakerMark: () => null,
}));

/** A cast member whose name the typed one is a prefix of, so both are offered at once. */
const KAEDE = Character.fromJSON({ profile: CharacterProfile.create("char-kaede", "Kaede Mori").toJSON() });

beforeEach(() => {
    freeze = null;
});

afterEach(cleanup);

function renderNametag() {
    const onChoose = vi.fn();
    const onCreateCharacter = vi.fn();
    render(
        <StoryDocumentScopeProvider value={storyDocumentFreezeScope(THIS_STORY)}>
            <CharacterSelectTrigger
                characters={[KAEDE]}
                tempSpeakers={[]}
                characterId={undefined}
                speakerName="Kaede"
                onChoose={onChoose}
                onCreateCharacter={onCreateCharacter}
            />
        </StoryDocumentScopeProvider>,
    );
    return { onChoose, onCreateCharacter };
}

/** The name as the row shows it, before the picker is open. */
const nametag = () => screen.getByRole("button");

/** Open the picker the way the author does: press the name. */
function openPicker(): void {
    fireEvent.click(nametag());
}

/** The portalled picker panel, which is the last thing appended to the body. */
function pickerPanel(): HTMLElement | null {
    const panels = document.body.querySelectorAll<HTMLElement>(":scope > div");
    const last = panels[panels.length - 1] ?? null;
    return last?.querySelector("[data-character-id]") ? last : null;
}

/** The trailing "Create character …" rung: the only row in the panel that is not a candidate. */
function createRung(): HTMLButtonElement {
    const panel = pickerPanel();
    expect(panel, "the picker is open").not.toBeNull();
    const rung = [...panel!.querySelectorAll("button")].find(button => !button.hasAttribute("data-character-id"));
    expect(rung, "the create rung is rendered").toBeDefined();
    return rung as HTMLButtonElement;
}

describe("the speaker nametag inside a live session on this very story", () => {
    it("still binds a name to a character that already exists", () => {
        // The gesture the session exists for: this writes one dialogue payload in the document every
        // participant is already being sent.
        freeze = liveSession(THIS_STORY);
        const { onChoose } = renderNametag();

        openPicker();
        const candidate = pickerPanel()!.querySelector<HTMLButtonElement>("[data-character-id=\"char-kaede\"]")!;

        expect(candidate.matches(":disabled")).toBe(false);
        fireEvent.mouseDown(candidate);
        expect(onChoose).toHaveBeenCalledWith({ characterId: "char-kaede" });
    });

    it("shows the create rung, switched off, with a reason on it", () => {
        freeze = liveSession(THIS_STORY);
        const { onCreateCharacter } = renderNametag();

        openPicker();
        const rung = createRung();

        expect(rung.matches(":disabled")).toBe(true);
        expect(rung.getAttribute("data-tip")).toBe(IN_A_SESSION);
        // Disabled, not hidden: an author who cannot find it concludes the feature broke.
        expect(rung.textContent).toContain("Kaede");
        fireEvent.mouseDown(rung);
        expect(onCreateCharacter).not.toHaveBeenCalled();
    });

    it("leaves the create rung live when nothing is frozen", () => {
        const { onCreateCharacter } = renderNametag();

        openPicker();
        const rung = createRung();

        expect(rung.matches(":disabled")).toBe(false);
        expect(rung.getAttribute("data-tip")).toBeNull();
        fireEvent.mouseDown(rung);
        expect(onCreateCharacter).toHaveBeenCalledWith("Kaede");
    });
});

describe("the speaker nametag under a freeze that covers this story too", () => {
    it("does not open the picker at all under a manual freeze", () => {
        // Unchanged from before the session freeze existed: a total freeze takes the whole control,
        // and the name stays readable with the workspace's own sentence on it.
        freeze = { kind: "manual" };
        renderNametag();

        openPicker();

        expect(pickerPanel()).toBeNull();
        expect(nametag().getAttribute("aria-disabled")).toBe("true");
        expect(nametag().getAttribute("data-tip")).toBe(FROZEN);
    });

    it("does not open the picker when the session is on some other story", () => {
        // A scope is a claim about which document is writable, not a way out of a freeze - and the
        // sentence still names the freeze that is standing in the way, which is the session.
        freeze = liveSession(ANOTHER_STORY);
        renderNametag();

        openPicker();

        expect(pickerPanel()).toBeNull();
        expect(nametag().getAttribute("data-tip")).toBe(FROZEN_LIVE);
    });
});
