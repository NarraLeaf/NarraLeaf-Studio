import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { opClaimKeys, type LiveStoryOp } from "@shared/live/ops";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { applyStoryOpToDocument } from "@shared/story/applyStoryOp";
import { createEmptyStoryDocument } from "@shared/story/storyModel";
import type { TeamDocHandler } from "./teamDocWiring";
import { TeamDocSync, type TeamDocNotice, type TeamDocPorts, type TeamDocState } from "./teamDocSync";
import type { TeamFileContent } from "@shared/authority/project";
import type { TeamFilePorts } from "./teamFileSync";
import { KERNEL_VERSION } from "@shared/authority/kernel";

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
    lastFileContent: TeamFileContent | null = null;
    /** The kernel this server runs, and what its `doc.head` says (an older server says nothing). */
    kernel = KERNEL_VERSION;
    headSays: "agreement" | "nothing" = "agreement";
    /** The link sessions that agreed this server's kernel. Per connection, as on the real server. */
    readonly agreed = new Set<string>();
    /** Every method asked, with the session it came in on. */
    readonly asked: Array<{ method: string; link: string | undefined }> = [];

    /**
     * Answer one call. `link` is the connection it came in on; a test speaking as another author
     * straight to the server leaves it out and is not held to an agreement.
     */
    call(by: string, method: string, params: Record<string, unknown>, link?: string): { ok: true; value: unknown } | { ok: false; problem: { detail: string; code: string } } {
        this.asked.push({ method, link });
        if (link !== undefined && method !== "doc.head" && this.headSays === "agreement" && !this.agreed.has(link)) {
            return { ok: false, problem: { detail: "this connection has not agreed a kernel", code: "refused" } };
        }
        switch (method) {
            case "doc.head": {
                const head = { seq: this.log.length, mayEdit: true, prunedThrough: this.prunedThrough };
                if (this.headSays === "nothing") return { ok: true, value: head };
                if (link !== undefined) this.agreed.delete(link);
                if (params.kernel === undefined) return { ok: false, problem: { detail: `this server runs Studio kernel ${this.kernel}`, code: "refused" } };
                if (params.kernel !== this.kernel) return { ok: true, value: { ...head, kernel: this.kernel, compatible: false, session: link } };
                if (link !== undefined) this.agreed.add(link);
                return { ok: true, value: { ...head, kernel: this.kernel, compatible: true, session: link } };
            }
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
        this.lastFileContent = content;
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
    failStateWrites = false;
    failFlush = false;
    flushCalls = 0;
    loadState: (() => Promise<TeamDocState | null>) | null = null;
    failStateWhen: ((state: TeamDocState) => boolean) | null = null;
    beforeStateSave: ((state: TeamDocState) => Promise<void>) | null = null;
    readonly notices: TeamDocNotice[] = [];
    /** The link session this window's calls go out on now; a new one on every reconnect. */
    link: string;
    private links = 0;
    /** The project's local history: what each record held. */
    readonly kept: string[] = [];
    failKeep = false;
    failSettle = false;
    /** Runs while a record is being made, to edit or stop meanwhile. */
    duringKeep: (() => void | Promise<void>) | null = null;
    kernel = KERNEL_VERSION;
    /** What the window was handed to call with every event, to deliver one the server would not. */
    deliverRaw: ((payload: unknown) => void) | null = null;
    readonly connection = new Set<(online: boolean) => void>();
    readonly sync: TeamDocSync;
    /** This window's project folder, for files that travel whole: text by path. */
    readonly disk = new Map<string, string>();
    readonly binary = new Map<string, Uint8Array>();
    reloads = 0;
    private readonly writes = new Set<(path: string) => void>();

    constructor(readonly server: FakeServer, readonly name: string, withFiles = false) {
        this.link = `${name}-${++this.links}`;
        const encoder = new TextEncoder();
        const files: TeamFilePorts = {
            list: async () => [...new Set([...this.disk.keys(), ...this.binary.keys()])].sort(),
            read: async path => this.binary.get(path) ?? (this.disk.has(path) ? encoder.encode(this.disk.get(path)) : null),
            write: async (path, bytes) => {
                this.binary.delete(path);
                this.disk.set(path, new TextDecoder().decode(bytes));
            },
            remove: async path => {
                this.disk.delete(path);
                this.binary.delete(path);
            },
            flush: async () => {
                this.flushCalls += 1;
                if (this.failFlush) {
                    await settle();
                    throw new Error("save failed");
                }
            },
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
            kernel: this.kernel,
            link: () => (this.online ? this.link : null),
            local: {
                settle: async () => {
                    if (this.failSettle) throw new Error("save failed");
                },
                keep: async () => {
                    if (this.failKeep) throw new Error("local history could not record");
                    const held = JSON.stringify(this.document);
                    await this.duringKeep?.();
                    if (this.kept.at(-1) === held) return { revision: null };
                    this.kept.push(held);
                    return { revision: `local-${this.kept.length}` };
                },
            },
            call: async (method, params) => {
                if (!this.online) return { ok: false, problem: { detail: "offline" } };
                // A round trip: the server answers later, never inside the call - and on whichever
                // connection is current by then, as the real client sends a queued call.
                await Promise.resolve();
                if (!this.online) return { ok: false, problem: { detail: "offline" } };
                return server.call(name, method, params, this.link);
            },
            listen: onEvent => {
                this.deliverRaw = onEvent;
                const listener: Listener = payload => {
                    // The server withholds the topic from a connection that has not agreed.
                    if (this.online && (server.headSays === "nothing" || server.agreed.has(this.link))) onEvent(payload);
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
                load: async () => this.loadState === null ? this.state : this.loadState(),
                save: async state => {
                    await this.beforeStateSave?.(state);
                    if (this.failStateWrites || this.failStateWhen?.(state)) throw new Error("state storage failed");
                    this.state = JSON.parse(JSON.stringify(state)) as TeamDocState;
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
        this.binary.delete(path);
        this.disk.set(path, text);
        for (const listener of this.writes) listener(path);
    }

    /** An editing gesture: through the sink when there is one, otherwise straight into the copy. */
    edit(op: LiveStoryOp): void {
        if (this.sink?.({ doc: "story", storyId: STORY }, op) === true) return;
        applyStoryOpToDocument(this.document, structuredClone(op), { now: NOW });
    }

    setOnline(online: boolean): void {
        if (online && !this.online) this.link = `${this.name}-${++this.links}`;
        this.online = online;
        for (const listener of this.connection) listener(online);
    }

    /** The socket dropped and a new one opened before this window heard of either. */
    swapLinkSilently(): void {
        this.link = `${this.name}-${++this.links}`;
    }

    fileObserverCount(): number {
        return this.writes.size;
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
    describe("state-load cancellation", () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        function deferred<T>() {
            let resolve!: (value: T) => void;
            const promise = new Promise<T>(done => { resolve = done; });
            return { promise, resolve };
        }

        const stale: TeamDocState = {
            seq: -1,
            conflicts: [{ kind: "story", storyId: STORY, op: insert("stale"), mine: null, reason: "conflict" }],
        };

        it("leaves the project and subscriptions alone when stopped during state loading", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const load = deferred<TeamDocState | null>();
            ada.loadState = () => load.promise;
            ada.edit(insert("local", "local work"));

            const starting = ada.sync.start();
            ada.sync.stop();
            load.resolve(null);
            await starting;

            expect(server.listeners.size).toBe(0);
            expect(ada.connection.size).toBe(0);
            expect(ada.fileObserverCount()).toBe(0);
            expect(ada.sink).toBeNull();
            expect(ada.rows()).toEqual(["local"]);
            expect(ada.state).toBeNull();
        });

        it("ignores an old load that finishes while a restart is still loading", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const oldLoad = deferred<TeamDocState | null>();
            const newLoad = deferred<TeamDocState | null>();
            let loads = 0;
            ada.loadState = () => (++loads === 1 ? oldLoad.promise : newLoad.promise);

            const oldStart = ada.sync.start();
            ada.sync.stop();
            const newStart = ada.sync.start();
            oldLoad.resolve(stale);
            await oldStart;

            expect(server.listeners.size).toBe(0);
            expect(ada.connection.size).toBe(0);
            expect(ada.fileObserverCount()).toBe(0);
            expect(ada.sync.getView().conflicts).toEqual([]);

            newLoad.resolve({ seq: 0 });
            await newStart;
            expect(ada.sync.getView()).toMatchObject({ state: "online", seq: 0, conflicts: [] });
            expect(server.listeners.size).toBe(1);
            expect(ada.connection.size).toBe(1);
            expect(ada.fileObserverCount()).toBe(1);
        });

        it("keeps a restarted instance's state and subscriptions when an old load finishes last", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const oldLoad = deferred<TeamDocState | null>();
            const newLoad = deferred<TeamDocState | null>();
            let loads = 0;
            ada.loadState = () => (++loads === 1 ? oldLoad.promise : newLoad.promise);

            const oldStart = ada.sync.start();
            ada.sync.stop();
            const newStart = ada.sync.start();
            newLoad.resolve({ seq: 0 });
            await newStart;
            const sink = ada.sink;
            expect(sink).not.toBeNull();
            oldLoad.resolve(stale);
            await oldStart;

            expect(ada.sync.getView()).toMatchObject({ state: "online", seq: 0, conflicts: [] });
            expect(ada.sink).toBe(sink);
            expect(server.listeners.size).toBe(1);
            expect(ada.connection.size).toBe(1);
            expect(ada.fileObserverCount()).toBe(1);
            server.call("bob", "doc.intent", {
                clientId: "bob:after-restart", document: { doc: "story", storyId: STORY }, op: insert("after-restart"),
            });
            expect(ada.rows()).toEqual(["after-restart"]);
            expect(ada.sync.getView().seq).toBe(1);

            ada.sync.stop();
            expect(server.listeners.size).toBe(0);
            expect(ada.connection.size).toBe(0);
            expect(ada.fileObserverCount()).toBe(0);
        });
    });

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

    it("preserves unresolved story conflicts and the author's full story across reopening", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();
        ada.edit(insert("a", "original"));
        ada.edit(insert("b", "other row"));
        await settle();

        ada.setOnline(false);
        await settle();
        ada.edit(update("a", "author offline change"));
        const authorStory = structuredClone(ada.document);
        bob.edit(update("a", "server change"));
        await settle();
        ada.setOnline(true);
        for (let i = 0; i < 5; i += 1) await settle();
        expect(ada.text("a")).toBe("server change");
        expect(ada.sync.getView().conflicts).toHaveLength(1);

        ada.sync.stop();
        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = structuredClone(ada.state);
        await again.sync.start();
        expect(again.sync.getView().conflicts).toMatchObject([
            { kind: "story", storyId: STORY, op: { op: "update-block", blockId: "a" }, mine: authorStory },
        ]);
        expect(await again.sync.overrideConflict(0)).toBe(true);
        await settle();
        expect(server.document.scenes[SCENE].blocks.a.payload).toEqual(row("a", "author offline change").payload);
    });

    it("keeps the author's story in place when recovery storage fails", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        await ada.sync.start();
        ada.edit(insert("a", "original"));
        await settle();
        ada.setOnline(false);
        await settle();
        ada.edit(update("a", "author offline change"));
        const authorStory = structuredClone(ada.document);

        ada.failStateWrites = true;
        ada.online = true;
        await (ada.sync as unknown as { goOnline(): Promise<void> }).goOnline().catch(() => undefined);
        expect(ada.document).toEqual(authorStory);
    });

    it("recovers an interrupted story replay and its complete author snapshot", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();
        ada.edit(insert("a", "original"));
        await settle();
        ada.setOnline(false);
        await settle();
        ada.edit(update("a", "author offline change"));
        const authorStory = structuredClone(ada.document);
        bob.edit(update("a", "server change"));
        await settle();

        ada.failStateWhen = state => (state.conflicts?.length ?? 0) > 0;
        ada.online = true;
        await (ada.sync as unknown as { goOnline(): Promise<void> }).goOnline();
        expect(ada.state?.replay?.stories[STORY]).toEqual(authorStory);
        expect(ada.state?.replay?.operations).toHaveLength(1);
        ada.sync.stop();

        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = structuredClone(ada.state);
        await again.sync.start();
        expect(again.sync.getView().conflicts).toMatchObject([{ kind: "story", mine: authorStory }]);
        expect(await again.sync.overrideConflict(0)).toBe(true);
        await settle();
        expect(server.document.scenes[SCENE].blocks.a.payload).toEqual(row("a", "author offline change").payload);
    });

    it("keeps a full story when a refused move carries no row contents", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();
        ada.edit(insert("a", "author row a"));
        ada.edit(insert("b", "author row b"));
        await settle();
        ada.setOnline(false);
        await settle();
        ada.edit({ op: "move-block", sceneId: SCENE, blockId: "a", target: { parentId: null } });
        const authorStory = structuredClone(ada.document);
        bob.edit(update("a", "server row a"));
        bob.edit(update("b", "server row b"));
        await settle();
        ada.setOnline(true);
        for (let i = 0; i < 5; i += 1) await settle();
        expect(ada.sync.getView().conflicts).toMatchObject([{ kind: "story", op: { op: "move-block" }, mine: authorStory }]);
        ada.sync.stop();

        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = structuredClone(ada.state);
        await again.sync.start();
        expect(again.sync.getView().conflicts).toMatchObject([{ kind: "story", op: { op: "move-block" }, mine: authorStory }]);
    });

    it("keeps a conflict when saving its dismissal fails", async () => {
        const server = new FakeServer();
        const ada = new Window(server, "ada");
        const bob = new Window(server, "bob");
        await ada.sync.start();
        await bob.sync.start();
        ada.edit(insert("a", "original"));
        await settle();
        ada.setOnline(false);
        await settle();
        ada.edit(update("a", "author offline change"));
        bob.edit(update("a", "server change"));
        await settle();
        ada.setOnline(true);
        for (let i = 0; i < 5; i += 1) await settle();
        ada.failStateWrites = true;
        ada.sync.dismissConflicts();
        await settle();
        expect(ada.sync.getView().conflicts).toHaveLength(1);
        ada.sync.stop();

        const again = new Window(server, "ada");
        again.document = structuredClone(ada.document);
        again.state = structuredClone(ada.state);
        await again.sync.start();
        expect(again.sync.getView().conflicts).toHaveLength(1);
        again.sync.dismissConflicts();
        await settle();
        again.sync.stop();
        const afterDismissal = new Window(server, "ada");
        afterDismissal.document = structuredClone(again.document);
        afterDismissal.state = structuredClone(again.state);
        await afterDismissal.sync.start();
        expect(afterDismissal.sync.getView().conflicts).toEqual([]);
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
        // ...so it was not replayed, and not lost either: it is in the local history, and the author is told.
        expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["a"]);
        expect(JSON.parse(newcomer.kept.at(-1)!).scenes[SCENE].rootBlockIds).toEqual(["stale"]);
        expect(newcomer.notices).toContainEqual({ kind: "local-kept", revision: "local-1" });
    });

    describe("a first follow, which cannot prove what it shares with the server", () => {
        async function teamWithOneRow(): Promise<FakeServer> {
            const server = new FakeServer();
            const ada = new Window(server, "ada");
            await ada.sync.start();
            ada.edit(insert("a"));
            await settle();
            return server;
        }

        it("takes a fresh clone that holds nothing of its own without recording anything", async () => {
            const server = await teamWithOneRow();
            const clone = new Window(server, "bob");
            // A clone's tree is a revision already: the local history has nothing new to record.
            clone.kept.push(JSON.stringify(clone.document));
            await clone.sync.start();
            expect(clone.rows()).toEqual(["a"]);
            expect(clone.kept).toHaveLength(1);
            expect(clone.notices.filter(notice => notice.kind === "local-kept")).toEqual([]);
            expect(clone.sync.getView().state).toBe("online");
        });

        it("records edits made while the record was being made, and takes over only the copy it kept", async () => {
            const server = await teamWithOneRow();
            const bob = new Window(server, "bob");
            bob.document.scenes[SCENE].rootBlockIds.push("before");
            let once = true;
            bob.duringKeep = () => {
                if (!once) return;
                once = false;
                bob.edit(insert("late"));
            };
            await bob.sync.start();
            expect(bob.rows()).toEqual(["a"]);
            expect(JSON.parse(bob.kept.at(-1)!).scenes[SCENE].rootBlockIds).toEqual(["before", "late"]);
            expect(bob.sync.getView().state).toBe("online");
        });

        it.each([
            ["a save fails", (bob: Window) => { bob.failSettle = true; }, (bob: Window) => { bob.failSettle = false; }],
            ["the local history cannot record", (bob: Window) => { bob.failKeep = true; }, (bob: Window) => { bob.failKeep = false; }],
        ])("takes nothing when %s, works offline, and takes the version once it can", async (_label, breakIt, mendIt) => {
            const server = await teamWithOneRow();
            const bob = new Window(server, "bob");
            bob.document.scenes[SCENE].rootBlockIds.push("mine");
            breakIt(bob);
            await bob.sync.start();
            expect(bob.rows()).toEqual(["mine"]);
            expect(bob.sync.getView().state).toBe("offline");
            expect(bob.sink).toBeNull();
            expect(bob.notices.map(notice => notice.kind)).toContain("local-keep-failed");
            // Editing on is editing the author's own copy.
            bob.edit(insert("more"));
            expect(bob.rows()).toEqual(["mine", "more"]);
            expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["a"]);

            mendIt(bob);
            bob.setOnline(false);
            bob.setOnline(true);
            await settle();
            await settle();
            expect(bob.rows()).toEqual(["a"]);
            expect(JSON.parse(bob.kept.at(-1)!).scenes[SCENE].rootBlockIds).toEqual(["mine", "more"]);
        });

        it("takes nothing when the project is closed while its copy is being recorded", async () => {
            const server = await teamWithOneRow();
            const bob = new Window(server, "bob");
            bob.document.scenes[SCENE].rootBlockIds.push("mine");
            bob.duringKeep = () => bob.sync.stop();
            await bob.sync.start();
            await settle();
            expect(bob.rows()).toEqual(["mine"]);
            expect(bob.sink).toBeNull();
            expect(bob.state).toBeNull();
            expect(bob.notices.map(notice => notice.kind)).not.toContain("local-keep-failed");
        });

        it("takes nothing when the connection is switched during the adoption, and agrees again on the new one", async () => {
            const server = await teamWithOneRow();
            const bob = new Window(server, "bob");
            bob.document.scenes[SCENE].rootBlockIds.push("mine");
            let once = true;
            bob.duringKeep = () => {
                if (once) bob.swapLinkSilently();
                once = false;
            };
            await bob.sync.start();
            expect(bob.rows()).toEqual(["mine"]);
            expect(bob.sync.getView().state).not.toBe("online");

            bob.setOnline(false);
            bob.setOnline(true);
            await settle();
            await settle();
            expect(bob.rows()).toEqual(["a"]);
            expect(bob.sync.getView().state).toBe("online");
        });
    });

    describe("the kernel, agreed per connection before anything is synced", () => {
        it("syncs nothing with a server on another kernel, keeps every edit, and replays them once both match", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada");
            await ada.sync.start();
            ada.edit(insert("a"));
            await settle();
            ada.setOnline(false);
            ada.edit(insert("offline"));

            // The server is upgraded while ada is away.
            server.kernel = KERNEL_VERSION + 1;
            server.call("bob", "doc.intent", { clientId: "bob:1", document: { doc: "story", storyId: STORY }, op: insert("bobs") });
            const askedBefore = server.asked.length;
            ada.setOnline(true);
            await settle();
            expect(ada.sync.getView().state).toBe("offline");
            expect(ada.notices).toContainEqual({ kind: "kernel-mismatch", ours: KERNEL_VERSION, theirs: KERNEL_VERSION + 1 });
            expect(server.asked.slice(askedBefore).filter(call => call.method !== "doc.head")).toEqual([]);
            // Not bob's edit, and ada's edits stay in her copy.
            expect(ada.rows()).toEqual(["a", "offline"]);
            ada.edit(insert("still"));
            expect(ada.sink).toBeNull();
            expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["a", "bobs"]);

            // A reconnect on the same mismatch does not say it again.
            ada.setOnline(false);
            ada.setOnline(true);
            await settle();
            expect(ada.notices.filter(notice => notice.kind === "kernel-mismatch")).toHaveLength(1);

            server.kernel = KERNEL_VERSION;
            ada.setOnline(false);
            ada.setOnline(true);
            await settle();
            await settle();
            expect(ada.sync.getView().state).toBe("online");
            expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["a", "bobs", "offline", "still"]);
            expect(ada.rows()).toEqual(["a", "bobs", "offline", "still"]);
        });

        it("syncs nothing with a server that does not say which kernel it runs, and adopts nothing over the copy", async () => {
            const server = new FakeServer();
            server.headSays = "nothing";
            server.call("bob", "doc.intent", { clientId: "bob:1", document: { doc: "story", storyId: STORY }, op: insert("bobs") });
            const ada = new Window(server, "ada");
            ada.document.scenes[SCENE].rootBlockIds.push("mine");
            await ada.sync.start();
            expect(ada.sync.getView().state).toBe("offline");
            expect(ada.notices).toContainEqual({ kind: "kernel-mismatch", ours: KERNEL_VERSION });
            expect(server.asked.filter(call => call.link !== undefined).map(call => call.method)).toEqual(["doc.head"]);
            expect(ada.rows()).toEqual(["mine"]);
            expect(ada.kept).toEqual([]);
            // An effect the old server still publishes is not applied.
            server.call("bob", "doc.intent", { clientId: "bob:2", document: { doc: "story", storyId: STORY }, op: insert("bobs2") });
            expect(ada.rows()).toEqual(["mine"]);
        });

        it("ignores an event that arrives before the kernel is agreed, and reads it from the log after", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada");
            ada.state = { seq: 0 };
            server.kernel = KERNEL_VERSION + 1;
            await ada.sync.start();
            const effect = server.call("bob", "doc.intent", { clientId: "bob:1", document: { doc: "story", storyId: STORY }, op: insert("bobs") });
            ada.deliverRaw?.({ kind: "doc-effect", effect: (effect as { value: { effect: unknown } }).value.effect });
            expect(ada.rows()).toEqual([]);
            expect(ada.sync.getView().seq).toBe(0);

            server.kernel = KERNEL_VERSION;
            ada.setOnline(false);
            ada.setOnline(true);
            await settle();
            expect(ada.rows()).toEqual(["bobs"]);
            expect(ada.sync.getView()).toMatchObject({ state: "online", seq: 1 });
        });

        it("keeps an edit queued across a reconnect it was not told of, and lands it once the new connection agrees", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada");
            await ada.sync.start();
            ada.edit(insert("a"));
            await settle();
            // The edit is handed to the server, and the socket is replaced before it goes out.
            ada.edit(insert("queued"));
            ada.swapLinkSilently();
            await settle();
            await settle();
            await settle();
            // The new connection refused it (nothing agreed there); the window agreed again and replayed it.
            expect(server.asked.some(call => call.method === "doc.intent" && call.link === "ada-2")).toBe(true);
            expect(server.agreed.has("ada-2")).toBe(true);
            expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["a", "queued"]);
            expect(ada.rows()).toEqual(["a", "queued"]);
            expect(ada.sync.getView().state).toBe("online");
            expect(ada.notices.filter(notice => notice.kind === "refused")).toEqual([]);
        });

        it("does not send an edit made after the connection changed but before it was told", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada");
            await ada.sync.start();
            ada.swapLinkSilently();
            ada.edit(insert("mine"));
            // Into her copy at once, not to a connection nothing was agreed on.
            expect(ada.rows()).toEqual(["mine"]);
            expect(server.asked.filter(call => call.method === "doc.intent")).toEqual([]);
            await settle();
            await settle();
            expect(server.document.scenes[SCENE].rootBlockIds).toEqual(["mine"]);
            expect(ada.sync.getView().state).toBe("online");
        });
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

        it("holds incoming files when pending edits fail to save", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            ada.disk.set(SCHEMA, "author edit");
            ada.failFlush = true;
            const callsBefore = ada.flushCalls;
            server.call("bob", "doc.intent", {
                clientId: "bob:save-failure",
                document: { doc: "file", path: SCHEMA },
                op: { op: "put-file", content: { encoding: "utf8", data: "server change" } },
            });
            for (let i = 0; i < 4; i += 1) await settle();
            const calls = ada.flushCalls - callsBefore;
            const state = ada.sync.getView();
            const text = ada.disk.get(SCHEMA);
            ada.failFlush = false;

            expect(text).toBe("author edit");
            expect(calls).toBe(1);
            expect(state).toMatchObject({ state: "offline", seq: 0 });

            ada.setOnline(false);
            await settle();
            ada.setOnline(true);
            for (let i = 0; i < 5; i += 1) await settle();
            expect(ada.sync.getView().conflicts).toHaveLength(1);
            expect(new TextDecoder().decode((ada.sync.getView().conflicts[0] as { mine: Uint8Array }).mine)).toBe("author edit");
        });
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

        it("preserves unresolved file conflicts and the author's bytes across reopening", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            ada.disk.set(SCHEMA, "author offline change");
            server.call("bob", "doc.intent", {
                clientId: "bob:1",
                document: { doc: "file", path: SCHEMA },
                op: { op: "put-file", content: { encoding: "utf8", data: "server change" } },
            });
            for (let i = 0; i < 5; i += 1) await settle();
            expect(ada.disk.get(SCHEMA)).toBe("server change");
            expect(ada.sync.getView().conflicts).toHaveLength(1);

            ada.sync.stop();
            const again = new Window(server, "ada", true);
            again.document = structuredClone(ada.document);
            again.disk.set(SCHEMA, ada.disk.get(SCHEMA)!);
            again.state = structuredClone(ada.state);
            await again.sync.start();
            const conflicts = again.sync.getView().conflicts;
            expect(conflicts).toHaveLength(1);
            expect(new TextDecoder().decode((conflicts[0] as { mine: Uint8Array }).mine)).toBe("author offline change");
            expect(await again.sync.overrideConflict(0)).toBe(true);
            for (let i = 0; i < 5; i += 1) await settle();
            expect(server.files.get(SCHEMA)).toBe("author offline change");
        });

        it("keeps the author's file in place when recovery storage fails", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            ada.disk.set(SCHEMA, "author change");
            ada.failStateWrites = true;
            await (ada.sync as unknown as { applyFile(effect: unknown): Promise<boolean> }).applyFile({
                seq: 1,
                clientId: "bob:1",
                by: "bob",
                document: { doc: "file", path: SCHEMA },
                op: { op: "put-file", content: { encoding: "utf8", data: "server change" } },
                at: NOW,
            }).catch(() => false);
            expect(ada.disk.get(SCHEMA)).toBe("author change");
        });

        it("waits for conflict storage before replacing a file", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            ada.disk.set(SCHEMA, "author change");
            let release!: () => void;
            let entered!: () => void;
            const saving = new Promise<void>(resolve => { entered = resolve; });
            const gate = new Promise<void>(resolve => { release = resolve; });
            ada.beforeStateSave = async state => {
                if ((state.conflicts?.length ?? 0) > 0) {
                    entered();
                    await gate;
                }
            };
            server.call("bob", "doc.intent", {
                clientId: "bob:1",
                document: { doc: "file", path: SCHEMA },
                op: { op: "put-file", content: { encoding: "utf8", data: "server change" } },
            });
            await saving;
            expect(ada.disk.get(SCHEMA)).toBe("author change");
            release();
            for (let i = 0; i < 5; i += 1) await settle();
            expect(ada.disk.get(SCHEMA)).toBe("server change");
        });

        it("keeps an incoming file effect pending when conflict storage fails, then recovers on reopening", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            ada.disk.set(SCHEMA, "author change");
            ada.failStateWrites = true;
            server.call("bob", "doc.intent", {
                clientId: "bob:1",
                document: { doc: "file", path: SCHEMA },
                op: { op: "put-file", content: { encoding: "utf8", data: "server change" } },
            });
            for (let i = 0; i < 5; i += 1) await settle();
            expect(ada.disk.get(SCHEMA)).toBe("author change");
            expect(ada.sync.getView()).toMatchObject({ state: "offline", seq: 0 });
            expect(ada.state?.seq).toBe(0);
            ada.sync.stop();

            const again = new Window(server, "ada", true);
            again.document = structuredClone(ada.document);
            again.disk.set(SCHEMA, ada.disk.get(SCHEMA)!);
            again.state = structuredClone(ada.state);
            await again.sync.start();
            expect(again.disk.get(SCHEMA)).toBe("server change");
            const conflict = again.sync.getView().conflicts[0] as { mine: Uint8Array };
            expect(new TextDecoder().decode(conflict.mine)).toBe("author change");
        });

        it("round-trips binary author bytes and sends them after reopening", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            await ada.sync.start();
            const authorBytes = Uint8Array.from([0, 255, 128, 13, 10, 65]);
            ada.binary.set(SCHEMA, authorBytes);
            server.call("bob", "doc.intent", {
                clientId: "bob:1",
                document: { doc: "file", path: SCHEMA },
                op: { op: "put-file", content: { encoding: "utf8", data: "server change" } },
            });
            for (let i = 0; i < 5; i += 1) await settle();
            ada.sync.stop();

            const again = new Window(server, "ada", true);
            again.document = structuredClone(ada.document);
            again.disk.set(SCHEMA, ada.disk.get(SCHEMA)!);
            again.state = structuredClone(ada.state);
            await again.sync.start();
            expect((again.sync.getView().conflicts[0] as { mine: Uint8Array }).mine).toEqual(authorBytes);
            expect(await again.sync.overrideConflict(0)).toBe(true);
            expect(server.lastFileContent).toEqual({ encoding: "base64", data: "AP+ADQpB" });
        });

        it("keeps multiple file conflicts separately through selection and reopening", async () => {
            const server = new FakeServer();
            const ada = new Window(server, "ada", true);
            const motion = "editor/story/animations/a.json";
            await ada.sync.start();
            ada.disk.set(SCHEMA, "author schema");
            ada.disk.set(motion, "author motion");
            for (const [path, text] of [[SCHEMA, "server schema"], [motion, "server motion"]]) {
                server.call("bob", "doc.intent", {
                    clientId: `bob:${path}`,
                    document: { doc: "file", path },
                    op: { op: "put-file", content: { encoding: "utf8", data: text } },
                });
            }
            for (let i = 0; i < 5; i += 1) await settle();
            expect(ada.sync.getView().conflicts).toHaveLength(2);
            ada.sync.stop();

            const again = new Window(server, "ada", true);
            again.document = structuredClone(ada.document);
            for (const [path, text] of ada.disk) again.disk.set(path, text);
            again.state = structuredClone(ada.state);
            await again.sync.start();
            expect(again.sync.getView().conflicts.map(conflict => conflict.kind === "file" && conflict.path)).toEqual([SCHEMA, motion]);
            expect(await again.sync.overrideConflict(0)).toBe(true);
            for (let i = 0; i < 5; i += 1) await settle();
            again.sync.stop();

            const last = new Window(server, "ada", true);
            last.document = structuredClone(again.document);
            for (const [path, text] of again.disk) last.disk.set(path, text);
            last.state = structuredClone(again.state);
            await last.sync.start();
            expect(last.sync.getView().conflicts).toHaveLength(1);
            expect(last.sync.getView().conflicts[0]).toMatchObject({ kind: "file", path: motion });
            expect(new TextDecoder().decode((last.sync.getView().conflicts[0] as { mine: Uint8Array }).mine)).toBe("author motion");
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
