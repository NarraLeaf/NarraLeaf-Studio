import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { Character } from "../character/Character";
import type { StoredCharacter } from "../character/types";
import { CharacterService } from "./CharacterService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A whole-record write lands as ONE step of undo: the step puts the previous record back exactly,
 * redo puts the new one back, and the live object the editor holds is the same object throughout
 * (and is told it changed). Creating a character this way is undone by removing it.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new CharacterService();
    let nextId = 0;
    const context = {
        project: {} as never,
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.Uuid: return { generate: () => `id-${++nextId}` };
                    case Services.UI: return { showError: vi.fn() };
                    case Services.ServiceAssets: return { deleteFile: vi.fn(async () => ({ ok: true })) };
                    case Services.FileSystem: return {};
                    case Services.Story: return { listStories: () => [] };
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
        commandLineRun: false,
    };
    history.setContext(context);
    service.setContext(context);
    return { service, history };
}

const LABEL = { key: "characters.history.editCharacter" as TranslationKey, params: { name: "Mei" } };

function layeredRecord(character: Character): StoredCharacter {
    const draft = Character.fromJSON(character.toJSON());
    draft.profile.setColor("#ff8800");
    draft.profile.appearance.setKind("layered");
    const appearance = draft.profile.appearance;
    const axis = appearance.createAxis("expression")!;
    const smile = appearance.createTag(axis.id, "smile")!;
    appearance.createTag(axis.id, "angry");
    const layer = appearance.createLayer("mouth", axis.id)!;
    appearance.setLayerOption(layer.id, smile.id, "asset-smile");
    return draft.toJSON() as StoredCharacter;
}

describe("CharacterService.commitCharacterRecord", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("replaces a record as one step, and undo restores the previous record exactly", async () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        mei.profile.appearance.createPose("normal");
        const before = mei.toJSON();
        const told = vi.fn();
        mei.subscribe(told);

        expect(service.commitCharacterRecord(layeredRecord(mei), LABEL)).toBe(true);
        const live = service.getCharacter(mei.profile.getId())!;
        expect(live).toBe(mei);
        expect(live.profile.appearance.getKind()).toBe("layered");
        expect(live.profile.getColor()).toBe("#ff8800");
        expect(told).toHaveBeenCalledTimes(1);
        expect(history.describe().find(entry => entry.scopeId === projectHistoryScope())?.undo).toBe(1);
        expect(history.peekUndo(projectHistoryScope())).toEqual(LABEL);

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(mei.toJSON()).toEqual(before);
        expect(told).toHaveBeenCalledTimes(2);

        expect(history.redo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(mei.profile.appearance.getKind()).toBe("layered");
        expect(mei.profile.appearance.getLayers().map(layer => layer.name)).toEqual(["mouth"]);
    });

    it("pushes nothing for a record that changes nothing", () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        expect(service.commitCharacterRecord(mei.toJSON() as StoredCharacter, LABEL)).toBe(false);
        expect(history.canUndo(projectHistoryScope())).toBe(false);
    });

    it("adds a drafted character as one step that undo removes and redo puts back in its place", async () => {
        const { service, history } = createHarness();
        service.createCharacter("Ada");
        const draft = service.draftCharacter("Mei", "layered");
        expect(service.getCharacter(draft.profile.getId())).toBeUndefined();

        service.commitCharacterRecord(draft.toJSON() as StoredCharacter, LABEL);
        service.createCharacter("Cy");
        expect(service.listCharacter().map(c => c.profile.getName())).toEqual(["Ada", "Mei", "Cy"]);

        history.undo(projectHistoryScope());
        await history.settled();
        expect(service.listCharacter().map(c => c.profile.getName())).toEqual(["Ada", "Cy"]);

        history.redo(projectHistoryScope());
        await history.settled();
        expect(service.listCharacter().map(c => c.profile.getName())).toEqual(["Ada", "Mei", "Cy"]);
        expect(service.getCharacter(draft.profile.getId())?.profile.appearance.getKind()).toBe("layered");
    });
});
