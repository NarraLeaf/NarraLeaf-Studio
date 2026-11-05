// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { CharacterColorField } from "./CharacterColorField";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * The colour field of the character the inspector is on.
 *
 * The inspector keeps this field mounted when it moves from one character to the next, and the field
 * held its first character's colour: after 美绪, Aoi and a newly made character - neither with a
 * colour of her own - showed 美绪's #B85164 and offered to clear it.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, locale: "en" }),
}));

// The picker's own panel is not what is asserted; the value it is handed is.
vi.mock("../framework/fields/ColorPickerField", () => ({
    ColorPickerTrigger: (props: { value: { hex: string } }) => <span data-testid="swatch">{props.value.hex}</span>,
}));

function character(id: string, name: string, color?: string): Character {
    const profile = CharacterProfile.create(id, name, "layered");
    if (color) {
        profile.setColor(color);
    }
    return Character.fromJSON({ profile: profile.toJSON() });
}

function context(target: Character): CharacterEditorContext {
    return { character: target, thumbnailUrl: null, poses: [] };
}

afterEach(cleanup);

describe("CharacterColorField", () => {
    it("shows the colour of the character it is on, after another one", () => {
        const view = render(<CharacterColorField data={context(character("mio", "美绪", "#B85164"))} onChange={() => undefined} />);
        expect(view.getByTestId("swatch").textContent?.toUpperCase()).toBe("#B85164");
        expect(view.queryByText("common.clear")).not.toBeNull();

        // Aoi has no colour: the field opens on the starting colour and has nothing to clear.
        view.rerender(<CharacterColorField data={context(character("aoi", "Aoi"))} onChange={() => undefined} />);
        expect(view.getByTestId("swatch").textContent?.toUpperCase()).toBe("#40A8C4");
        expect(view.queryByText("common.clear")).toBeNull();

        // And back to 美绪, whose colour is still hers.
        view.rerender(<CharacterColorField data={context(character("mio", "美绪", "#B85164"))} onChange={() => undefined} />);
        expect(view.getByTestId("swatch").textContent?.toUpperCase()).toBe("#B85164");
    });
});
