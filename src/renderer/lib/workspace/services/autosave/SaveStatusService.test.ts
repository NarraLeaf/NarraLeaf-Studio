import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { freezeProjectWrites, refuseFrozenWrite, thawProjectWrites } from "@/lib/app/writeFreeze";
import type { FsWriteOutcome } from "../core/FileSystem";
import { Services, type WorkspaceContext } from "../services";
import { DebouncedSaver } from "./DebouncedSaver";
import { describeSaveFailureDetail, SaveStatusService } from "./SaveStatusService";

type Harness = {
    service: SaveStatusService;
    emitWrite: (outcome: FsWriteOutcome) => void;
    showSticky: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
};

async function makeHarness(): Promise<Harness> {
    let observer: ((outcome: FsWriteOutcome) => void) | null = null;
    const showSticky = vi.fn(() => "toast-1");
    const close = vi.fn();
    const log = vi.fn();

    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            observeWrites: (handler: (outcome: FsWriteOutcome) => void) => {
                observer = handler;
                return () => { observer = null; };
            },
        },
        [Services.UI]: { notifications: { showSticky, close } },
        [Services.Console]: { log },
    };

    const ctx = {
        project: {},
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = new SaveStatusService();
    service.setContext(ctx);
    await service.initialize(ctx, async () => undefined);

    return {
        service,
        emitWrite: outcome => observer?.(outcome),
        showSticky,
        close,
        log,
    };
}

const PROJECT = "D:/projects/my-game";

const failure = (path: string, code = FsRejectErrorCode.IO_ERROR): FsWriteOutcome => ({
    path,
    ok: false,
    error: { code, message: "no space left on device" },
});

describe("SaveStatusService", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const makeSaver = (save: () => Promise<void>) =>
        new DebouncedSaver({ delayMs: 800, maxWaitMs: 5_000, save });

    it("reports the worst state across every registered saver", async () => {
        const { service } = await makeHarness();
        const idle = makeSaver(async () => undefined);
        const busy = makeSaver(async () => undefined);
        service.register("idle", "workspace.shell.save.stores.story", idle);
        service.register("busy", "workspace.shell.save.stores.voice", busy);

        expect(service.getStatus()).toBe("clean");

        busy.schedule();
        expect(service.getStatus()).toBe("dirty");

        await vi.advanceTimersByTimeAsync(800);
        expect(service.getStatus()).toBe("clean");
    });

    it("surfaces a failing write and clears it when the same path succeeds", async () => {
        const { service, emitWrite, showSticky, close, log } = await makeHarness();

        emitWrite(failure("/project/editor/uidoc.json"));
        expect(service.getStatus()).toBe("failed");
        expect(service.getFailures()).toHaveLength(1);
        expect(service.getFailures()[0]).toMatchObject({ attempts: 1, transient: true });
        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("storage", "error", expect.any(String), expect.anything());

        emitWrite({ path: "/project/editor/uidoc.json", ok: true });
        expect(service.getStatus()).toBe("clean");
        expect(service.getFailures()).toHaveLength(0);
        expect(close).toHaveBeenCalledWith("toast-1");
    });

    it("raises one toast per failing path, not one per retry", async () => {
        const { service, emitWrite, showSticky } = await makeHarness();

        emitWrite(failure("/project/editor/uidoc.json"));
        emitWrite(failure("/project/editor/uidoc.json"));
        emitWrite(failure("/project/editor/uidoc.json"));

        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(service.getFailures()[0].attempts).toBe(3);
    });

    it("marks a path-level rejection as needing the user, not as transient", async () => {
        const { service, emitWrite } = await makeHarness();

        emitWrite(failure("/project/editor/uidoc.json", FsRejectErrorCode.INVALID_PATH));

        expect(service.getFailures()[0].transient).toBe(false);
    });

    it("flushAll never short-circuits on the first rejection", async () => {
        const { service } = await makeHarness();
        const failing = vi.fn(async () => { throw new Error("read-only volume"); });
        const working = vi.fn(async () => undefined);
        const first = makeSaver(failing);
        const second = makeSaver(working);
        service.register("first", "workspace.shell.save.stores.story", first);
        service.register("second", "workspace.shell.save.stores.voice", second);

        first.schedule();
        second.schedule();
        await service.flushAll();

        // The point of the test: one service whose disk is refusing must not keep the other five
        // out of their own writes.
        expect(failing).toHaveBeenCalledTimes(1);
        expect(working).toHaveBeenCalledTimes(1);
    });

    it("retryNow re-reports what is still broken and drops what is not", async () => {
        const { service, emitWrite } = await makeHarness();
        // A write nobody owns a saver for: only a later successful write to the same path could
        // ever clear it, so without this escape hatch it would pin the status bar red for the rest
        // of the session.
        emitWrite(failure("/project/export/one-off.zip"));
        expect(service.getStatus()).toBe("failed");

        await service.retryNow();

        expect(service.getFailures()).toHaveLength(0);
        expect(service.getStatus()).toBe("clean");
    });

    it("re-registering the same id does not accumulate subscriptions", async () => {
        const { service } = await makeHarness();
        const saver = makeSaver(async () => undefined);
        const changed = vi.fn();
        service.onChanged(changed);

        service.register("story", "workspace.shell.save.stores.story", saver);
        service.register("story", "workspace.shell.save.stores.story", saver);
        changed.mockClear();

        saver.schedule();
        expect(changed).toHaveBeenCalledTimes(1);
    });
});

/**
 * The reporting half of the freeze gate. A refused write is a no-op by design, so this service is
 * the only thing standing between the author and a workspace that silently discards their typing.
 */
describe("SaveStatusService while the workspace is frozen", () => {
    afterEach(() => {
        thawProjectWrites();
    });

    it("raises one notice for the frozen stretch, and a console line per refusal", async () => {
        const { showSticky, log } = await makeHarness();
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        refuseFrozenWrite(`${PROJECT}/editor/story/index.json`);
        refuseFrozenWrite(`${PROJECT}/project.json`);

        // One refused save is often several refusals (the parent directory, then the file), and an
        // import of fifty assets would otherwise bury the workspace in identical toasts.
        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(2);
    });

    it("does not treat a refusal as a failed save", async () => {
        const { service } = await makeHarness();
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        refuseFrozenWrite(`${PROJECT}/project.json`);

        // `failures` is the set of writes still OWED - it turns the status bar red and retryNow
        // replays it. Replaying a frozen-out write later is the accident the gate exists to prevent.
        expect(service.getFailures()).toHaveLength(0);
        expect(service.getStatus()).toBe("clean");
    });

    it("does not tell a live session that nothing is being saved", async () => {
        // The one partial freeze. The story it is about goes on saving, so the usual title is false
        // about the file the author is most likely typing into - and telling somebody their work is
        // being discarded while it is not is the kind of wrong that stops them working.
        const { showSticky } = await makeHarness();
        freezeProjectWrites({
            projectPath: PROJECT,
            reason: { kind: "live-session", session: "room-1", writable: ["editor/story/stories/s1/storydoc.json"] },
        });

        refuseFrozenWrite(`${PROJECT}/editor/characters/index.json`);

        expect(showSticky).toHaveBeenCalledTimes(1);
        const shown = showSticky.mock.calls[0][0] as { message: string; detail: string };
        expect(shown.message).toBe("That file is not being saved");
        // Says which file, and that the session is saving what it carries - never that nothing is.
        expect(shown.detail).toContain("only the documents it carries are saved");
        // "Unfreeze the workspace" names a control a session does not have; the way out is leaving it.
        expect(shown.detail).not.toContain("Unfreeze");
        expect(shown.detail).toContain("Leave the session");
    });

    it("goes on saving the session's own document rather than refusing it", async () => {
        const { showSticky } = await makeHarness();
        freezeProjectWrites({
            projectPath: PROJECT,
            reason: { kind: "live-session", session: "room-1", writable: ["editor/story/stories/s1/storydoc.json"] },
        });

        expect(refuseFrozenWrite(`${PROJECT}/editor/story/stories/s1/storydoc.json`)).toBeNull();
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("takes the notice down when the workspace thaws", async () => {
        const { close } = await makeHarness();
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });
        refuseFrozenWrite(`${PROJECT}/project.json`);

        thawProjectWrites();

        expect(close).toHaveBeenCalledWith("toast-1");
    });

    // An editor with a field open is the one holder of project data no saver knows about: the words
    // are in the field, and the document they belong to has not been told. Everything that writes
    // the workspace out - a window close, a quit, a Dev Mode launch - has to ask the editors first,
    // or it writes every document except the line somebody is in the middle of typing.
    describe("edits an open editor is still holding", () => {
        it("settles them, and stops when the editor deregisters", async () => {
            const { service } = await makeHarness();
            const settle = vi.fn();

            const deregister = service.registerPendingEdit(settle);
            service.settlePendingEdits();
            expect(settle).toHaveBeenCalledTimes(1);

            deregister();
            service.settlePendingEdits();
            expect(settle).toHaveBeenCalledTimes(1);
        });

        it("does not let one editor's failure keep the others from settling", async () => {
            const { service, log } = await makeHarness();
            const broken = vi.fn(() => { throw new Error("scene is gone"); });
            const working = vi.fn();
            service.registerPendingEdit(broken);
            service.registerPendingEdit(working);

            // Never throws: the callers block a window close on this, and a window that will not
            // close is a worse answer than a line that did not settle.
            expect(() => service.settlePendingEdits()).not.toThrow();
            expect(working).toHaveBeenCalledTimes(1);
            expect(log).toHaveBeenCalled();
        });
    });
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("what the save-failure notice says", () => {
    const PROJECT_FILE = "D:/projects/my-game/My Game.nlproj";

    it("leaves a file whose writer reports it to that writer: no notice, nothing owed, one console line", async () => {
        const { service, emitWrite, showSticky, log } = await makeHarness();
        service.registerCallerReportedFile(PROJECT_FILE);

        emitWrite(failure(PROJECT_FILE, FsRejectErrorCode.PERMISSION_DENIED));

        // Nothing retries this file, so a notice saying it is being retried - or a status bar
        // saying a save is owed - would be false. Its writer tells the author instead.
        expect(showSticky).not.toHaveBeenCalled();
        expect(service.getStatus()).toBe("clean");
        expect(service.getFailures()).toHaveLength(0);
        expect(log).toHaveBeenCalledWith("storage", "error", expect.stringContaining("not retried"), expect.anything());
    });

    it("reports that file like any other once its writer lets go of it", async () => {
        const { service, emitWrite, showSticky } = await makeHarness();
        const release = service.registerCallerReportedFile(PROJECT_FILE);
        release();

        emitWrite(failure(PROJECT_FILE, FsRejectErrorCode.PERMISSION_DENIED));

        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(service.getStatus()).toBe("failed");
    });

    it("forgets every registration on a project switch", async () => {
        const { service, emitWrite, showSticky } = await makeHarness();
        service.registerCallerReportedFile(PROJECT_FILE);
        // A new context is what a project switch hands the same singleton.
        await service.initialize({ ...service.getContext() } as WorkspaceContext, async () => undefined);

        emitWrite(failure(PROJECT_FILE));

        expect(showSticky).toHaveBeenCalledTimes(1);
    });

    it("names what the disk said and never prints the system's message", async () => {
        const { emitWrite, showSticky } = await makeHarness();

        emitWrite({
            path: "D:/projects/my-game/editor/uidoc.json",
            ok: false,
            error: {
                code: FsRejectErrorCode.PERMISSION_DENIED,
                message: "EPERM: operation not permitted, rename 'D:/projects/my-game/assets/content/51/43/dcd8e1f24b6c4a2f9e0d7b3a1c5e8f90.nltmp'",
            },
        });
        emitWrite({
            path: "D:/projects/my-game/editor/story.json",
            ok: false,
            error: { code: FsRejectErrorCode.IPC_ERROR, message: "Failed to write file to app://fs/3f2a9c: Internal Server Error" },
        });

        const [readOnly, transport] = showSticky.mock.calls.map(call => (call[0] as { detail: string }).detail);
        expect(readOnly).toBe("The file is read-only, or Studio is not allowed to write to it. Retrying fails until this is fixed.");
        expect(transport).toBe("Still retrying in the background.");
    });

    it.each(SUPPORTED_LOCALES)("carries no URL, no id and no unfilled placeholder in any wording (%s)", locale => {
        const t = createTranslator(locale).t;
        const details = Object.values(FsRejectErrorCode).flatMap(code => [
            describeSaveFailureDetail({ code, transient: true }, t),
            describeSaveFailureDetail({ code, transient: false }, t),
        ]);
        expect(describeSaveFailureDetail({ code: FsRejectErrorCode.NO_SPACE, transient: true }, t))
            .toContain(t("workspace.shell.save.reason.diskFull"));
        for (const detail of details) {
            expect(detail).not.toMatch(/app:\/\//);
            expect(detail).not.toMatch(UUID);
            expect(detail).not.toMatch(/\{\w+\}/);
        }
    });
});
