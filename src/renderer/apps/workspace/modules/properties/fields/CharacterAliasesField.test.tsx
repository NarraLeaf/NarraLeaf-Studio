// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import type { StoredCharacter } from "@shared/types/character/model";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * The aliases field writes through `commitCharacterRecord`, one call per edit, and warns about an
 * alias the rest of the cast makes useless.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(":")}` : key),
        tn: (key: string) => key,
        has: () => false,
        formatList: (items: string[]) => items.join(", "),
        locale: "en",
    }),
}));

const cast: Character[] = [];
const commitCharacterRecord = vi.fn((record: StoredCharacter) => {
    const live = cast.find(member => member.profile.getId() === record.profile.id);
    live?.adopt(record);
    return true;
});
const service = {
    listCharacter: () => cast,
    subscribe: () => () => undefined,
    commitCharacterRecord,
};

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({
        context: { services: { get: () => service } },
        isInitialized: true,
    }),
}));

const { CharacterAliasesField } = await import("./CharacterAliasesField");

function character(id: string, name: string, nicknames: string[] = []): Character {
    const profile = CharacterProfile.create(id, name, "preset");
    nicknames.forEach(nickname => profile.addNickname(nickname));
    return Character.fromJSON({ profile: profile.toJSON() });
}

function context(target: Character): CharacterEditorContext {
    return { character: target, thumbnailUrl: null, poses: [] };
}

const settle = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 20)));

afterEach(() => {
    cleanup();
    cast.length = 0;
    commitCharacterRecord.mockClear();
});

describe("CharacterAliasesField", () => {
    it("adds a trimmed alias as one committed record", async () => {
        const editor = character("editor", "责编");
        cast.push(editor);
        const view = render(<CharacterAliasesField data={context(editor)} onChange={() => undefined} />);

        const input = view.getByPlaceholderText("characters.properties.addAliasPlaceholder");
        fireEvent.change(input, { target: { value: "  饼姐 " } });
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();

        expect(commitCharacterRecord).toHaveBeenCalledTimes(1);
        const [record, label] = commitCharacterRecord.mock.calls[0] as unknown as [StoredCharacter, { key: string }];
        expect(record.profile.nicknames).toEqual(["饼姐"]);
        expect(label.key).toBe("characters.history.editCharacter");
        expect(editor.profile.getNicknames()).toEqual(["饼姐"]);
    });

    it("drops the character's own name instead of adding it", async () => {
        const editor = character("editor", "责编");
        cast.push(editor);
        const view = render(<CharacterAliasesField data={context(editor)} onChange={() => undefined} />);

        const input = view.getByPlaceholderText("characters.properties.addAliasPlaceholder");
        fireEvent.change(input, { target: { value: "责编" } });
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();

        expect(commitCharacterRecord).not.toHaveBeenCalled();
    });

    it("removes an alias as one committed record", async () => {
        const editor = character("editor", "责编", ["饼姐", "编辑"]);
        cast.push(editor);
        const view = render(<CharacterAliasesField data={context(editor)} onChange={() => undefined} />);

        fireEvent.click(view.getByRole("button", { name: "properties.tags.removeAria:饼姐" }));
        await settle();

        expect(commitCharacterRecord).toHaveBeenCalledTimes(1);
        expect(editor.profile.getNicknames()).toEqual(["编辑"]);
    });

    it("warns about an alias another character is named or shares", () => {
        const editor = character("editor", "责编", ["Aoi", "小美"]);
        cast.push(editor, character("aoi", "Aoi"), character("mio", "美绪", ["小美"]));
        const view = render(<CharacterAliasesField data={context(editor)} onChange={() => undefined} />);

        expect(view.queryByText("characters.properties.aliasTakenByName:Aoi:Aoi")).not.toBeNull();
        expect(view.queryByText("characters.properties.aliasShared:小美:美绪")).not.toBeNull();
    });
});
