import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveCharacterOp } from "@shared/live/ops";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { CharacterService, type CharacterOpSink } from "./CharacterService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The cast as a live session sees it: edits leave as operations, and the store moves only when one
 * comes back.
 *
 * What these are really about is the difference between this seam and the story's. `StoryService`
 * asks its sink *before* mutating, because every gesture reaches one of eleven mutators. A
 * character's fields are changed by around eighty setters on objects the panels hold, and the
 * service hears about them only after the fact - so the record is read out of the mutated object,
 * handed over, and put straight back before anything has been told. The tests below are the proof
 * that "put straight back" holds, because if it does not, a guest is applying its own edits
 * optimistically and every one of them is a document nobody else agreed to.
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
                    case Services.Story: return { listStories: () => [] };
                    case Services.ServiceAssets: return {
                        deleteFile: vi.fn(async () => ({ ok: true as const, data: undefined })),
                        readRaw: vi.fn(async () => ({ ok: false as const, error: "missing" })),
                        restoreFile: vi.fn(async () => ({ ok: true as const, data: undefined })),
                    };
                    case Services.Assets: return { lockAsset: vi.fn(), unlockAsset: vi.fn() };
                    case Services.Uuid: return { generate: () => `id-${++nextId}` };
                    case Services.UI: return { showError: vi.fn() };
                    case Services.FileSystem: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    };
    history.setContext(context);
    service.setContext(context);

    /** A sink that takes everything, and remembers what it was given. */
    const taken: LiveCharacterOp[] = [];
    const sink: CharacterOpSink = {
        handle: op => {
            taken.push(structuredClone(op) as LiveCharacterOp);
            return true;
        },
    };
    /** A sink that wants none of it, which is what every window outside a session has. */
    const declining: CharacterOpSink = { handle: () => false };

    const names = () => service.listCharacter().map(character => character.profile.getName());
    return { service, history, sink, declining, taken, names };
}

describe("the cast's live-session seam", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    describe("what a gesture does with a sink installed", () => {
        it("hands a creation over and adds nothing to the cast", () => {
            const { service, sink, taken, names } = createHarness();
            service.setOperationSink(sink);

            service.createCharacter("Ada");

            expect(taken).toEqual([{ op: "create-character", character: expect.objectContaining({}) }]);
            // The panel does not move. A guest's character appears when the effect answering it
            // arrives, exactly as a story row appears on Enter.
            expect(names()).toEqual([]);
        });

        it("puts the colour and the group inside the creation, because they are one gesture", () => {
            const { service, sink, taken } = createHarness();
            service.setOperationSink(sink);

            service.createCharacter("Ada", "preset", { color: "#40a8c4", groupId: "g1" });

            const created = taken[0];
            expect(created.op).toBe("create-character");
            expect(created.op === "create-character" && created.character.profile.color).toBe("#40a8c4");
            expect(created.op === "create-character" && created.character.profile.groupId).toBe("g1");
        });

        it("turns a field written on a live record into one operation carrying the whole record", () => {
            const { service, sink, taken, declining } = createHarness();
            // Created outside the session, so there is a record in the cast to edit.
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            service.setOperationSink(sink);

            ada.profile.setDescription("The one who arrives late.");

            expect(taken).toHaveLength(1);
            const op = taken[0];
            expect(op.op).toBe("update-character");
            expect(op.op === "update-character" && op.character.profile.description)
                .toBe("The one who arrives late.");
        });

        it("puts the record back before anything is told, so nothing is applied optimistically", () => {
            const { service, sink, declining } = createHarness();
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            service.setOperationSink(sink);

            const seen: string[] = [];
            service.subscribe(() => seen.push(ada.profile.getDescription()));
            ada.profile.setDescription("The one who arrives late.");

            // The object the panel holds is back to what the room agreed, and every subscriber that
            // ran saw that value rather than the one this window typed.
            expect(ada.profile.getDescription()).toBe("");
            expect(seen.every(description => description === "")).toBe(true);
        });

        it("schedules no save, so nothing a session took is written behind its back", () => {
            const { service, sink, declining } = createHarness();
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            // Let the save that creation asked for come due, so the only timer that can exist after
            // this is one the edit below asked for.
            vi.runOnlyPendingTimers();
            const before = vi.getTimerCount();
            service.setOperationSink(sink);

            ada.profile.setName("Ada Lovelace");

            // Marking the store dirty is what puts a save on the clock, and a save here would write
            // an edit to this machine's disk that reached nobody else's.
            expect(vi.getTimerCount()).toBe(before);
        });

        it("hands a group over whole, with the timestamps this machine minted", () => {
            const { service, sink, taken } = createHarness();
            service.setOperationSink(sink);

            service.createGroup("Cast");

            const op = taken[0];
            expect(op.op).toBe("set-character-group");
            // Minted here and carried, rather than stamped by each applier: the cast digest hashes
            // them, so every machine has to write the numbers this one chose.
            expect(op.op === "set-character-group" && typeof op.group.createdAt).toBe("number");
            expect(service.listGroups()).toEqual([]);
        });

        it("hands a group deletion over as one operation, and names no members", async () => {
            const { service, sink, taken, declining } = createHarness();
            service.setOperationSink(declining);
            const group = service.createGroup("Cast");
            const ada = service.createCharacter("Ada");
            service.assignCharacterToGroup(ada.profile.getId(), group.id);
            service.setOperationSink(sink);

            expect(await service.deleteGroup(group.id)).toBe(true);

            // One gesture, one operation. Every machine works out who was in the group from the store
            // it already holds, so naming them would be a second statement of the same fact - and
            // sending them as their own updates would make one gesture into several.
            expect(taken).toEqual([{ op: "delete-character-group", groupId: group.id }]);
            expect(service.listGroups()).toHaveLength(1);
        });

        it("hands a deletion over, and sweeps nothing here", async () => {
            const { service, sink, declining, taken, names } = createHarness();
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            service.setOperationSink(sink);

            expect(await service.deleteCharacter(ada.profile.getId())).toBe(true);

            // One operation, and the rows the character spoke are not in it: every machine finds them
            // for itself from a cast and a set of stories the room already agrees on. Running the
            // sweep here as well would write the same rows twice on this machine and once elsewhere.
            expect(taken).toEqual([{ op: "delete-character", characterId: ada.profile.getId() }]);
            expect(names()).toEqual(["Ada"]);
        });

        it("pushes no history entry for a deletion it handed over", async () => {
            const { service, history, sink, declining } = createHarness();
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            service.setOperationSink(sink);

            await service.deleteCharacter(ada.profile.getId());

            // Inside a session undo is sending the inverse of one's own operation. An entry here would
            // offer a second undo that writes straight to this machine's store - a local edit no
            // effect carries, which is the divergence the whole design is built to make impossible.
            expect(history.canUndo(projectHistoryScope())).toBe(false);
        });
    });

    describe("what an arriving effect does", () => {
        it("adds the record and leaves the sink out of it", () => {
            const { service, sink, taken, names } = createHarness();
            service.setOperationSink(sink);

            service.applyLiveOp({
                op: "create-character",
                character: {
                    profile: {
                        id: "char-1",
                        name: "Ada",
                        description: "",
                        tags: [],
                        attributes: {},
                        thumbnail: null,
                        nicknames: [],
                        appearance: { kind: "preset", poses: [], defaultPoseId: null },
                    },
                },
            });

            expect(names()).toEqual(["Ada"]);
            // The applier writes through the same setters an author does, so without the re-entrancy
            // guard every effect would be handed straight back as a second operation - a loop that
            // sends the room a second copy of its own edit.
            expect(taken).toEqual([]);
            expect(service.isDirty()).toBe(true);
        });

        it("writes an update onto the object the panels are holding", () => {
            const { service, sink, declining } = createHarness();
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            service.setOperationSink(sink);

            const record = ada.toJSON();
            record.profile.name = "Ada Lovelace";
            service.applyLiveOp({ op: "update-character", characterId: ada.profile.getId(), character: record });

            // The same instance, not a replacement: the properties panel is holding it and its
            // subscribers are on it.
            expect(service.getCharacter(ada.profile.getId())).toBe(ada);
            expect(ada.profile.getName()).toBe("Ada Lovelace");
        });

        it("moves the members out of a group it removes, without being told who they are", () => {
            const { service, sink, declining } = createHarness();
            service.setOperationSink(declining);
            const group = service.createGroup("Cast");
            const ada = service.createCharacter("Ada");
            service.assignCharacterToGroup(ada.profile.getId(), group.id);
            service.setOperationSink(sink);

            service.applyLiveOp({ op: "delete-character-group", groupId: group.id });

            expect(service.getGroup(group.id)).toBeUndefined();
            expect(ada.profile.getGroupId()).toBeUndefined();
        });

        it("puts a group back with the membership the operation carries", () => {
            const { service, sink, declining } = createHarness();
            service.setOperationSink(declining);
            const ada = service.createCharacter("Ada");
            service.setOperationSink(sink);

            service.applyLiveOp({
                op: "set-character-group",
                groupId: "g1",
                group: { id: "g1", name: "Cast", createdAt: 1, updatedAt: 2 },
                members: [ada.profile.getId(), "somebody-who-has-gone"],
            });

            expect(service.getGroup("g1")?.name).toBe("Cast");
            expect(ada.profile.getGroupId()).toBe("g1");
            // A named member that has gone since is dropped rather than refused: the group is still
            // the group it was, minus somebody nobody has.
            expect(service.listCharactersByGroup("g1").map(c => c.profile.getName())).toEqual(["Ada"]);
        });

        it("leaves an update for a record it never received alone, so a gap is caught and not hidden", () => {
            const { service, sink, names } = createHarness();
            service.setOperationSink(sink);

            service.applyLiveOp({
                op: "update-character",
                characterId: "never-arrived",
                character: {
                    profile: {
                        id: "never-arrived",
                        name: "Ghost",
                        description: "",
                        tags: [],
                        attributes: {},
                        thumbnail: null,
                        nicknames: [],
                        appearance: { kind: "preset", poses: [], defaultPoseId: null },
                    },
                },
            });

            // Creating it here would hide the fact that this machine missed the creation. The digest
            // on the next effect is what reports it.
            expect(names()).toEqual([]);
        });
    });

    describe("with the sink taken away", () => {
        it("does exactly what it always did", () => {
            const { service, sink, names } = createHarness();
            service.setOperationSink(sink);
            service.setOperationSink(null);

            const ada = service.createCharacter("Ada");
            ada.profile.setDescription("Back to normal.");

            expect(names()).toEqual(["Ada"]);
            expect(ada.profile.getDescription()).toBe("Back to normal.");
            expect(service.isDirty()).toBe(true);
        });
    });
});
