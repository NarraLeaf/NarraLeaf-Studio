import { afterEach, describe, expect, it } from "vitest";
import { opClaimKeys, type LiveStoryOp } from "@shared/live/ops";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { applyStoryOpToDocument } from "@shared/story/applyStoryOp";
import { createEmptyStoryDocument } from "@shared/story/storyModel";
import type { TeamDocHandler } from "./teamDocWiring";
import { TeamDocSync, type TeamDocNotice, type TeamDocPorts, type TeamDocState } from "./teamDocSync";
import type { TeamFileContent } from "@shared/authority/project";
import type { TeamFilePorts } from "./teamFileSync";

const STORY = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-14T00:00:00.000Z";
const BASE_PATH = `editor/story/stories/${STORY}/storydoc.json`;

function fresh(): StoryDocument {
    let next = 100;
    return createEmptyStoryDocument({
        id: STORY,
        name: "Story",
        now: NOW,
        generateId: () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`,
    });
}
const SCENE = fresh().chapters[0].sceneIds[0];

function row(id: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `t-${id}`, role: "narration", value } },
    } as StoryBlock;
}

type Listener = (payload: unknown) => void;

/** A Team server in miniature: one story, a log, row claims for offline conflicts, a topic. */
class FakeServer {
    document = fresh();
    readonly log: Array<{ seq: number; clientId: string; by: string; document: unknown; op: LiveStoryOp; at: string }> = [];
    readonly written = new Map<string, number>();
    readonly listeners = new Set<Listener>();
    /** Drop topic deliveries, to make a window find a gap. */
    deaf = false;
    prunedThrough = 0;
    /** Whole files, as text, and the seq that last wrote each. */
    readonly files = new Map<string, string>();
    readonly fileWritten = new Map<string, number>();

    call(by: string, method: string, params: Record<string, unknown>): { ok: true; value: unknown } {
        switch (method) {
            case "doc.head":
                return { ok: true, value: { seq: this.log.length, mayEdit: true, prunedThrough: this.prunedThrough } };
            case "doc.base": {
                // This server never saves a version, so the base is the story it started with, at 0.
                const text = JSON.stringify(fresh(), null, 2);
                if (params.path === undefined) {
                    return { ok: true, value: { seq: 0, revision: "r0", files: [{ path: BASE_PATH, size: text.length }] } };
                }
                const bytes = new TextEncoder().encode(text);
                const offset = (params.offset as number) ?? 0;
                // Small chunks, so a file comes in several.
                const chunk = bytes.subarray(offset, offset + 64);
                return {
                    ok: true,
                    value: { seq: 0, revision: "r0", path: BASE_PATH, size: bytes.length, offset, chunk: btoa(String.fromCharCode(...chunk)) },
                };
            }
            case "doc.effects": {
                const after = params.after as number;
                return { ok: true, value: { effects: this.log.filter(effect => effect.seq > after), more: false } };
            }
            case "doc.file": {
                const path = params.path as string;
                const text = this.files.get(path);
                if (text === undefined) return { ok: true, value: { seq: this.log.length, path, absent: true } };
                const bytes = new TextEncoder().encode(text);
                return { ok: true, value: { seq: this.log.length, path, size: bytes.length, offset: 0, chunk: btoa(String.fromCharCode(...bytes)) } };
            }
            case "doc.intent": {
                if ((params.document as { doc: string }).doc === "file") return this.putFile(by, params);
                const op = params.op as LiveStoryOp;
                const keys = opClaimKeys(op);
                const basedOn = params.basedOn as number | undefined;
                if (basedOn !== undefined) {
                    const conflicts = keys.filter(key => (this.written.get(key) ?? 0) > basedOn);
                    if (conflicts.length > 0) {
                        return { ok: true, value: { kind: "refusal", clientId: params.clientId, reason: "conflict", conflicts } };
                    }
                }
                const next = structuredClone(this.document);
                applyStoryOpToDocument(next, structuredClone(op), { now: NOW });
                this.document = next;
                const effect = { seq: this.log.length + 1, clientId: params.clientId as string, by, document: params.document, op, at: NOW };
                this.log.push(effect);
                for (const key of keys) this.written.set(key, effect.seq);
                if (!this.deaf) {
                    for (const listener of this.listeners) listener({ kind: "doc-effect", effect });
                }
                return { ok: true, value: { kind: "effect", effect } };
            }
            default:
                throw new Error(`unexpected ${method}`);
        }
    }

    private putFile(by: string, params: Record<string, unknown>): { ok: true; value: unknown } {
        const path = (params.document as { path: string }).path;
        const content = (params.op as { content: TeamFileContent | null }).content;
        const basedOn = params.basedOn as number | undefined;
        if (basedOn !== undefined && (this.fileWritten.get(path) ?? 0) > basedOn) {
            return { ok: true, value: { kind: "refusal", clientId: params.clientId, reason: "conflict", conflicts: [`file:${path}`] } };
        }
        const text = content === null ? undefined : (content as { data: string }).data;
        if (text === this.files.get(path)) {
            return { ok: true, value: { kind: "refusal", clientId: params.clientId, reason: "nothing-there" } };
        }
        if (text === undefined) this.files.delete(path);
        else this.files.set(path, text);
        const effect = { seq: this.log.length + 1, clientId: params.clientId as string, by, document: params.document, op: params.op as LiveStoryOp, at: NOW };
        this.log.push(effect);
        this.fileWritten.set(path, effect.seq);
        if (!this.deaf) {
            for (const listener of this.listeners) listener({ kind: "doc-effect", effect });
        }
        return { ok: true, value: { kind: "effect", effect } };
    }
}

const opened: TeamDocSync[] = [];
afterEach(() => {
    while (opened.length > 0) opened.pop()?.stop();
});

/** One window: its own copy of the story, its own sink slot, its own saved state. */
class Window {
    document = fresh();
    sink: TeamDocHandler | null = null;
    online = true;
    state: TeamDocState | null = null;
    readonly notices: TeamDocNotice[] = [];
    readonly connection = new Set<(online: boolean) => void>();
    readonly sync: TeamDocSync;
    /** This window's project folder, for files that travel whole: text by path. */
    readonly disk = new Map<string, string>();
    reloads = 0;
    private readonly writes = new Set<(path: string) => void>();

    constructor(readonly server: FakeServer, readonly name: string, withFiles = false) {
        const encoder = new TextEncoder();
        const files: TeamFilePorts = {
            list: async () => [...this.disk.keys()].sort(),
            read: async path => (this.disk.has(path) ? encoder.encode(this.disk.get(path)) : null),
            write: async (path, bytes) => {
                this.disk.set(path, new TextDecoder().decode(bytes));
            },
            remove: async path => {
                this.disk.delete(path);
            },
            flush: async () => undefined,
            reload: async () => {
                this.reloads += 1;
            },
            digest: async bytes => `d:${new TextDecoder().decode(bytes)}`,
            offer: async () => null,
            collect: async () => null,
            observe: listener => {
                this.writes.add(listener);
                return () => this.writes.delete(listener);
            },
        };
        const ports: TeamDocPorts = {
            instance: name,
            call: async (method, params) => {
                if (!this.online) return { ok: false, problem: { detail: "offline" } };
                // A round trip: the server answers later, never inside the call.
                await Promise.resolve();
                return server.call(name, method, params);
            },
            listen: onEvent => {
                const listener: Listener = payload => {
                    if (this.online) onEvent(payload);
                };
                server.listeners.add(listener);
                return () => server.listeners.delete(listener);
            },
            isOnline: () => this.online,
            onConnection: listener => {
                this.connection.add(listener);
                return () => this.connection.delete(listener);
            },
            documents: {
                install: handler => {
                    this.sink = handler;
                },
                apply: (_document, op) => {
                    applyStoryOpToDocument(this.document, structuredClone(op) as LiveStoryOp, { now: NOW });
                },
            },
            story: {
                snapshot: () => ({ [STORY]: structuredClone(this.document) }),
                restore: stories => {
                    this.document = structuredClone(stories[STORY]);
                },
                adoptFiles: async files => {
                    this.document = JSON.parse(files.get(BASE_PATH) as string) as StoryDocument;
                },
            },

            state: {
                load: async () => this.state,
                save: async state => {
                    this.state = structuredClone(state);
                },
            },
            notify: notice => {
                this.notices.push(notice);
            },
            ...(withFiles ? { files } : {}),
        };
        this.sync = new TeamDocSync(ports);
        opened.push(this.sync);
    }

    /** The author's editor writes a file, as it would in a personal project. */
    writeFile(path: string, text: string): void {
        this.disk.set(path, text);
        for (const listener of this.writes) listener(path);
    }

    /** An editing gesture: through the sink when there is one, otherwise straight into the copy. */
    edit(op: LiveStoryOp): void {
        if (this.sink?.({ doc: "story", storyId: STORY }, op) === true) return;
        applyStoryOpToDocument(this.document, structuredClone(op), { now: NOW });
    }

    setOnline(online: boolean): void {
        this.online = online;
        for (const listener of this.connection) listener(online);
    }

    rows(): string[] {
        return this.document.scenes[SCENE].rootBlockIds;
    }

    text(id: string): string {
        return (this.document.scenes[SCENE].blocks[id].payload as { text: { value: string } }).text.value;
    }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const insert = (id: string, value = id): LiveStoryOp => ({ op: "insert-block", sceneId: SCENE, block: row(id, value), target: { parentId: null } });
const update = (id: string, value: string): LiveStoryOp => ({ op: "update-block", sceneId: SCENE, blockId: id, payload: row(id, value).payload });

describe("following a team project", () => {
    it("sends every edit to the server and applies only what comes back, in the server's order", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();

        ada.edit(insert("a"));
        // Not applied here yet: nothing is applied before the server has done it.
        expect(ada.rows()).toEqual([]);
        await settle();
        bob.edit(insert("b"));
        await settle();

        expect(ada.rows()).toEqual(["a", "b"]);
        expect(bob.rows()).toEqual(["a", "b"]);
        expect(ada.sync.getView()).toMatchObject({ state: "online", seq: 2 });
        expect(ada.state?.seq).toBe(2);
    });

    it("fetches what it missed when an effect arrives out of turn", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();

        server.deaf = true;
        bob.edit(insert("a"));
        await settle();
        server.deaf = false;
        bob.edit(insert("b"));
        await settle();
        await settle();

        expect(ada.rows()).toEqual(["a", "b"]);
    });

    it("picks up from its own seq when it opens again", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        await ada.sync.start();
        ada.edit(insert("a"));
        await settle();
        ada.sync.stop();

        const bob = new Window(server, "bob");
        await bob.sync.start();
        bob.edit(insert("b"));
        await settle();

        // Ada's window comes back with its saved seq and its saved copy.
        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = ada.state;
        await again.sync.start();
        expect(again.rows()).toEqual(["a", "b"]);
    });

    it("keeps editing offline, then lands what nobody else touched and reports what somebody did", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();
        ada.edit(insert("a", "one"));
        await settle();
        ada.edit(insert("b", "two"));
        await settle();

        ada.setOnline(false);
        await settle();
        expect(ada.sync.getView().state).toBe("offline");

        // Offline, Ada edits both rows and adds one; meanwhile Bob changes row a.
        ada.edit(update("a", "ada offline"));
        ada.edit(update("b", "ada offline"));
        ada.edit(insert("c", "ada new"));
        expect(ada.text("a")).toBe("ada offline");
        bob.edit(update("a", "bob online"));
        await settle();

        ada.setOnline(true);
        for (let i = 0; i < 5; i += 1) await settle();

        expect(ada.sync.getView().state).toBe("online");
        // Bob's edit to row a stands; Ada's edit to b and her new row landed.
        expect(server.document.scenes[SCENE].blocks.a.payload).toEqual(row("a", "bob online").payload);
        expect(server.document.scenes[SCENE].blocks.b.payload).toEqual(row("b", "ada offline").payload);
        expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["a", "b", "c"]);
        // Both windows hold what the server holds.
        expect(ada.document.scenes[SCENE].rootBlockIds).toEqual(["a", "b", "c"]);
        expect(ada.text("a")).toBe("bob online");
        expect(bob.text("b")).toBe("ada offline");
        // And Ada is told about row a, with what she had written.
        const conflicts = ada.sync.getView().conflicts;
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({ reason: "conflict", op: { op: "update-block", blockId: "a" } });
    });

    it("survives closing while offline, and replays when it opens again online", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        await ada.sync.start();
        ada.edit(insert("a", "one"));
        await settle();
        ada.setOnline(false);
        await settle();
        ada.edit(update("a", "offline"));
        ada.sync.stop();

        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = structuredClone(ada.state);
        expect(again.state?.offline).toBeDefined();
        await again.sync.start();
        for (let i = 0; i < 5; i += 1) await settle();
        expect(server.document.scenes[SCENE].blocks.a.payload).toEqual(row("a", "offline").payload);
        expect(again.sync.getView().conflicts).toEqual([]);
    });

    it("starts a window that never opened the project from the last saved version, then follows the log", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        await ada.sync.start();
        ada.edit(insert("a"));
        await settle();

        const newcomer = new Window(server, "bob");
        // Whatever its copy held, it does not know which seq that is.
        newcomer.document.scenes[SCENE].rootBlockIds.push("stale");
        await newcomer.sync.start();
        expect(newcomer.rows()).toEqual(["a"]);
        expect(newcomer.sync.getView()).toMatchObject({ state: "online", seq: 1 });
    });

    it("holds arriving effects while a past version is on screen and applies them after", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();
        ada.sync.holdEffects(true);
        bob.edit(insert("a"));
        await settle();
        expect(ada.rows()).toEqual([]);
        ada.sync.holdEffects(false);
        expect(ada.rows()).toEqual(["a"]);
    });

    it("starts again from the last saved version when the log no longer reaches back to it", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        await ada.sync.start();
        ada.edit(insert("a"));
        await settle();
        // The server cleared its log past this window's seq while it was away.
        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = { seq: 0 };
        server.prunedThrough = 1;
        await again.sync.start();
        expect(again.sync.getView().state).toBe("online");
        // The fake's base is the empty story at seq 0; with the log still holding seq 1 it reads on to it.
        expect(again.rows()).toEqual(["a"]);
    });

    describe("files that travel whole", () => {
        const SCHEMA = "editor/save-schema.json";
        const VARIABLES = "editor/variables.json";
        /** Long enough for the look after a write to have run and its answer to have landed. */
        const afterScan = async () => {
            await new Promise(resolve => setTimeout(resolve, 450));
            for (let i = 0; i < 10; i += 1) await settle();
        };

        it("sends a file its editor wrote, and writes it in every other window", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const bob = new Window(server, "bob", true);
            await ada.sync.start();
            await bob.sync.start();

            ada.writeFile(SCHEMA, "{\"slots\":3}");
            await afterScan();
            expect(server.files.get(SCHEMA)).toBe("{\"slots\":3}");
            expect(bob.disk.get(SCHEMA)).toBe("{\"slots\":3}");
            expect(bob.reloads).toBeGreaterThan(0);
            // Ada's own file came back as an effect: nothing to write, nothing to re-read.
            expect(ada.reloads).toBe(0);
            expect(ada.state?.files?.[SCHEMA]).toBe("d:{\"slots\":3}");
        });

        it("keeps the author's bytes when somebody else's version of the same file arrives first", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const bob = new Window(server, "bob", true);
            await ada.sync.start();
            await bob.sync.start();

            // Bob writes and has not sent yet when Ada's version lands.
            bob.disk.set(SCHEMA, "bob");
            ada.writeFile(SCHEMA, "ada");
            await afterScan();
            expect(bob.disk.get(SCHEMA)).toBe("ada");
            const conflicts = bob.sync.getView().conflicts;
            expect(conflicts).toHaveLength(1);
            expect(conflicts[0]).toMatchObject({ kind: "file", path: SCHEMA });

            // "Use mine": Bob's version goes in over Ada's, everywhere.
            expect(await bob.sync.overrideConflict(0)).toBe(true);
            await afterScan();
            expect(server.files.get(SCHEMA)).toBe("bob");
            expect(ada.disk.get(SCHEMA)).toBe("bob");
            expect(bob.sync.getView().conflicts).toEqual([]);
        });

        it("sends every file changed offline whole on reconnecting, and puts back the one somebody else changed", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const bob = new Window(server, "bob", true);
            await ada.sync.start();
            await bob.sync.start();
            ada.writeFile(SCHEMA, "v1");
            await afterScan();

            ada.setOnline(false);
            await settle();
            // Offline, Ada changes the schema and a document; Bob changes the schema too.
            ada.writeFile(SCHEMA, "ada offline");
            ada.writeFile(VARIABLES, "{\"variables\":[]}");
            bob.writeFile(SCHEMA, "bob online");
            await afterScan();

            ada.setOnline(true);
            await afterScan();
            expect(ada.sync.getView().state).toBe("online");
            // The document nobody else touched landed; the schema is Bob's, everywhere.
            expect(server.files.get(VARIABLES)).toBe("{\"variables\":[]}");
            expect(bob.disk.get(VARIABLES)).toBe("{\"variables\":[]}");
            expect(server.files.get(SCHEMA)).toBe("bob online");
            expect(ada.disk.get(SCHEMA)).toBe("bob online");
            // And Ada is told, with what she had written.
            const conflicts = ada.sync.getView().conflicts;
            expect(conflicts).toHaveLength(1);
            expect(conflicts[0]).toMatchObject({ kind: "file", path: SCHEMA });
            expect(new TextDecoder().decode((conflicts[0] as { mine: Uint8Array }).mine)).toBe("ada offline");
        });

        it("keeps what it agreed with the server when it is made a personal copy, so going back sends what changed", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            ada.writeFile(SCHEMA, "team");
            await afterScan();
            const kept = await ada.sync.detachedState();
            ada.sync.stop();
            expect(kept.offline?.files?.[SCHEMA]).toBe("d:team");

            // Edited as a personal project for a while, then reconnected.
            const again = new Window(server, "ada", true);
            again.document = structuredClone(ada.document);
            again.disk.set(SCHEMA, "personal");
            again.state = kept;
            await again.sync.start();
            await afterScan();
            expect(server.files.get(SCHEMA)).toBe("personal");
            expect(again.sync.getView().conflicts).toEqual([]);
        });
    });
});
