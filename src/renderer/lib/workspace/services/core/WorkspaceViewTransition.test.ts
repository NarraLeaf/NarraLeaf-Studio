import { afterEach, expect, it, vi } from "vitest";
import type { DocumentSource } from "@shared/documents/documentSource";
import {
    clearProjectDocumentSource,
    getProjectDocumentSource,
    readProjectDataFromSource,
} from "@/lib/app/documentSource";
import { clearMergeConflictReads, mergeConflictReadPath } from "@/lib/app/mergeConflictReads";
import { getProjectWriteFreeze, isProjectWriteReloadHeld, thawProjectWrites } from "@/lib/app/writeFreeze";
import { Services, type WorkspaceContext } from "../services";
import { WorkspaceFreezeService } from "./WorkspaceFreezeService";
import { WorkspaceReloadService } from "./WorkspaceReloadService";

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ workspace: { reportWriteFreeze: async () => ({ success: true }) } }),
}));

const PATH = "/project/editor/story/index.json";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function revision(id: string): DocumentSource {
    return { origin: { kind: "revision", revision: id }, read: async () => id, prewarm: async () => undefined };
}

async function harness(storyReload: () => Promise<void>, flushAll: () => Promise<void> = async () => undefined) {
    const reload = new WorkspaceReloadService();
    const freeze = new WorkspaceFreezeService();
    const fallback = {
        reloadProjectConfig: async () => undefined,
        reloadFromDisk: async () => undefined,
        load: async () => undefined,
        clearAll: () => undefined,
        log: () => undefined,
        flushAll,
        prepareForReload: async () => undefined,
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: "/project" }) },
        services: { get: (id: string) => {
            if (id === Services.WorkspaceReload) return reload;
            if (id === Services.Story) return { reloadFromDisk: storyReload };
            return fallback;
        } },
    } as unknown as WorkspaceContext;
    await reload.initialize(ctx, async () => undefined);
    await freeze.initialize(ctx, async () => undefined);
    return { ctx, reload, freeze };
}

afterEach(() => {
    thawProjectWrites();
    clearProjectDocumentSource();
    clearMergeConflictReads();
});

it("keeps each revision source stable until its own reload finishes", async () => {
    const gate = deferred();
    const entered = deferred();
    const reads: unknown[] = [];
    let passes = 0;
    const h = await harness(async () => {
        passes += 1;
        if (passes !== 1) return;
        reads.push(await readProjectDataFromSource(PATH));
        entered.resolve();
        await gate.promise;
        reads.push(await readProjectDataFromSource(PATH));
    });
    const old = revision("old");
    const next = revision("next");
    const first = h.freeze.showRevision(old);
    await entered.promise;
    const second = h.freeze.showRevision(next);
    await Promise.resolve();
    await Promise.resolve();
    const sourceBeforeRelease = getProjectDocumentSource();
    const reasonBeforeRelease = getProjectWriteFreeze()?.reason;
    gate.resolve();
    const results = await Promise.all([first, second]);

    expect(sourceBeforeRelease).toBe(old);
    expect(reasonBeforeRelease).toMatchObject({ kind: "revision", revision: "old" });
    expect(reads).toEqual([{ text: "old" }, { text: "old" }]);
    expect(results.map(result => result.origin)).toEqual([old.origin, next.origin]);
    expect(getProjectDocumentSource()).toBe(next);
    expect(h.freeze.getReason()).toMatchObject({ kind: "revision", revision: "next" });
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("keeps writes held when a revision view is requested during a working-tree reload", async () => {
    const gate = deferred();
    const entered = deferred();
    let pass = 0;
    const h = await harness(async () => {
        pass += 1;
        if (pass === 1) {
            entered.resolve();
            await gate.promise;
        }
    });
    const seen: boolean[] = [];
    h.reload.onReloaded(() => seen.push(isProjectWriteReloadHeld() || Boolean(getProjectWriteFreeze())));
    const working = h.reload.reload("external");
    await entered.promise;
    const showing = h.freeze.showRevision(revision("next"));
    gate.resolve();
    await Promise.all([working, showing]);

    expect(seen).toEqual([true, true]);
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("keeps the revision source until a queued thaw starts its working-tree reload", async () => {
    const gate = deferred();
    const entered = deferred();
    const reads: unknown[] = [];
    let passes = 0;
    const h = await harness(async () => {
        passes += 1;
        reads.push(await readProjectDataFromSource(PATH));
        if (passes === 1) {
            entered.resolve();
            await gate.promise;
            reads.push(await readProjectDataFromSource(PATH));
        }
    });
    const source = revision("old");
    const first = h.freeze.showRevision(source);
    await entered.promise;
    const thawed = new Promise<void>(resolve => {
        h.reload.onReloaded(result => { if (result.cause === "thaw") resolve(); });
    });
    h.freeze.thaw();
    const sourceBeforeRelease = getProjectDocumentSource();
    const frozenBeforeRelease = h.freeze.isFrozen();
    gate.resolve();
    await Promise.all([first, thawed]);

    expect(sourceBeforeRelease).toBe(source);
    expect(frozenBeforeRelease).toBe(true);
    expect(reads).toEqual([{ text: "old" }, { text: "old" }, null]);
    expect(getProjectDocumentSource()).toBeNull();
    expect(h.freeze.isFrozen()).toBe(false);
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("honours thaw requested while the first revision is still flushing", async () => {
    const flush = deferred();
    const h = await harness(async () => undefined, () => flush.promise);
    const entering = h.freeze.showRevision(revision("old"));
    const thawed = new Promise<void>(resolve => {
        h.reload.onReloaded(result => { if (result.cause === "thaw") resolve(); });
    });
    h.freeze.thaw();
    flush.resolve();
    await Promise.all([entering, thawed]);

    expect(getProjectDocumentSource()).toBeNull();
    expect(h.freeze.isFrozen()).toBe(false);
    expect(h.reload.getGeneration()).toBe(2);
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("lets the initial save flush finish before queued revision requests hold writes", async () => {
    const flush = deferred();
    const h = await harness(async () => undefined, () => flush.promise);
    const first = h.freeze.showRevision(revision("a"));
    const second = h.freeze.showRevision(revision("b"));
    const third = h.freeze.showRevision(revision("c"));
    await Promise.resolve();
    const heldDuringFlush = isProjectWriteReloadHeld();
    flush.resolve();
    await Promise.all([first, second, third]);

    expect(heldDuringFlush).toBe(false);
    expect(h.freeze.getReason()).toMatchObject({ kind: "revision", revision: "c" });
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("keeps a queued pass holding writes until an asynchronous preparation failure settles", async () => {
    const flush = deferred();
    const secondStarted = deferred();
    const gate = deferred();
    const h = await harness(async () => { secondStarted.resolve(); await gate.promise; }, async () => {
        await flush.promise;
        throw new Error("flush failed");
    });
    const first = h.freeze.showRevision(revision("a"));
    const failure = expect(first).rejects.toThrow("flush failed");
    const second = h.freeze.showRevision(revision("b"));
    flush.resolve();
    await Promise.all([failure, secondStarted.promise]);
    const held = isProjectWriteReloadHeld();
    const frozen = h.freeze.isFrozen();
    gate.resolve();
    await second;

    expect(held || frozen).toBe(true);
    expect(h.freeze.getReason()).toMatchObject({ kind: "revision", revision: "b" });
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("keeps a revision owned until an active reload finishes during teardown", async () => {
    const gate = deferred();
    const entered = deferred();
    const reads: unknown[] = [];
    const h = await harness(async () => {
        reads.push(await readProjectDataFromSource(PATH));
        entered.resolve();
        await gate.promise;
        reads.push(await readProjectDataFromSource(PATH));
    });
    const source = revision("old");
    const showing = h.freeze.showRevision(source);
    await entered.promise;
    let closed = false;
    const closing = h.freeze.teardown(h.ctx).then(() => { closed = true; });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const sourceDuringClose = getProjectDocumentSource();
    const closedDuringReload = closed;
    gate.resolve();
    await Promise.all([showing, closing]);

    expect(sourceDuringClose).toBe(source);
    expect(closedDuringReload).toBe(false);
    expect(reads).toEqual([{ text: "old" }, { text: "old" }]);
    expect(getProjectDocumentSource()).toBeNull();
    await h.reload.teardown(h.ctx);
});

it("installs merge substitutions only when their queued reload starts", async () => {
    const gate = deferred();
    const entered = deferred();
    const reads: unknown[] = [];
    let passes = 0;
    const h = await harness(async () => {
        passes += 1;
        reads.push(await readProjectDataFromSource(PATH));
        if (passes === 1) {
            entered.resolve();
            await gate.promise;
            reads.push(await readProjectDataFromSource(PATH));
        } else {
            reads.push(mergeConflictReadPath(PATH));
        }
    });
    const source = revision("old");
    const first = h.freeze.showRevision(source);
    await entered.promise;
    const merge = h.freeze.showMergeConflicts(["editor/story/index.json"]);
    const sourceBeforeRelease = getProjectDocumentSource();
    gate.resolve();
    await Promise.all([first, merge]);

    expect(sourceBeforeRelease).toBe(source);
    expect(reads).toEqual([{ text: "old" }, { text: "old" }, null, `${PATH}~mine`]);
    expect(h.freeze.getReason()).toEqual({ kind: "merge" });
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});

it("keeps later reloads queued when an earlier queued pass starts", async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started = [deferred(), deferred(), deferred(), deferred()];
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    let pass = 0;
    const h = await harness(async () => {
        const index = pass++;
        const origin = getProjectDocumentSource()?.origin;
        order.push(origin?.kind === "revision" ? origin.revision : "working");
        active += 1;
        maxActive = Math.max(maxActive, active);
        started[index].resolve();
        await gates[index].promise;
        active -= 1;
    });
    const first = h.reload.reload("revision", revision("a"));
    await started[0].promise;
    const second = h.reload.reload("revision", revision("b"));
    const third = h.reload.reload("revision", revision("c"));
    gates[0].resolve();
    await started[1].promise;
    const fourth = h.reload.reload("revision", revision("d"));
    gates[1].resolve();
    await started[2].promise;
    await Promise.resolve();
    const startsWhileThirdPending = [...order];
    gates[2].resolve();
    await started[3].promise;
    gates[3].resolve();
    await Promise.all([first, second, third, fourth]);

    expect(startsWhileThirdPending).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["a", "b", "c", "d"]);
    expect(maxActive).toBe(1);
    await h.freeze.teardown(h.ctx);
    await h.reload.teardown(h.ctx);
});
