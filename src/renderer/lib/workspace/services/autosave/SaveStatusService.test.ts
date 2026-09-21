import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { freezeProjectWrites, refuseFrozenWrite, thawProjectWrites } from "@/lib/app/writeFreeze";
import type { FsWriteOutcome } from "../core/FileSystem";
import { Services, type WorkspaceContext } from "../services";
import { DebouncedSaver } from "./DebouncedSaver";
import {
    describeSaveFailureDetail,
    describeSaveFailureTitle,
    describeUnreadableDocumentTitle,
    SaveStatusService,
} from "./SaveStatusService";
import { itemWrite, storeWrite, type FsWriteReport } from "./writeReport";
import { DocumentCorruptError } from "@shared/documents/types";

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

/** How an auto-saved document reports its writes - the interface document, here. */
const RETRIED = storeWrite("workspace.shell.save.stores.uiDocument", "retried");

const failure = (path: string, code = FsRejectErrorCode.IO_ERROR, report: FsWriteReport | undefined = RETRIED): FsWriteOutcome => ({
    path,
    ok: false,
    error: { code, message: "no space left on device" },
    report,
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
        // No saver is registered here, so nothing re-reports this path during the flush: only a
        // later successful write to it could otherwise clear it.
        emitWrite(failure("/project/editor/uidoc.json"));
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
/** The tail of an asset id as its content path ends: 28 hex digits, after two folders of two. */
const HEX_ID_TAIL = /[0-9a-f]{16,}/i;

const ASSET_CONTENT = "D:/projects/my-game/assets/content/51/43/dcd8e1f24b6c4a2f9e0d7b3a1c5e8f90";
const GROUPS_SHARD = "D:/projects/my-game/assets/assets.groups.image.json";
const ORDER_SHARD = "D:/projects/my-game/assets/assets.order.image.json";
const ASSET_LIBRARY = storeWrite("workspace.shell.save.stores.assets", "notRetried");

type Shown = { message: string; detail: string; actions?: unknown[] };
const shown = (showSticky: ReturnType<typeof vi.fn>, index = 0) => showSticky.mock.calls[index][0] as Shown;

describe("what the save-failure notice says", () => {
    const PROJECT_FILE = "D:/projects/my-game/My Game.nlproj";

    it("leaves a file its writer reports to that writer: no notice, nothing owed, one console line", async () => {
        const { service, emitWrite, showSticky, log } = await makeHarness();

        emitWrite(failure(
            PROJECT_FILE,
            FsRejectErrorCode.PERMISSION_DENIED,
            storeWrite("workspace.shell.save.stores.project", "handledByWriter"),
        ));

        // Nothing retries this file, so a notice saying it is being retried - or a status bar
        // saying a save is owed - would be false. Its writer tells the author instead.
        expect(showSticky).not.toHaveBeenCalled();
        expect(service.getStatus()).toBe("clean");
        expect(service.getFailures()).toHaveLength(0);
        expect(log).toHaveBeenCalledWith("storage", "error", expect.stringContaining("not retried"), expect.anything());
    });

    it("says a write nothing retries was not saved, offers no retry, and owes nothing", async () => {
        const { service, emitWrite, showSticky, log } = await makeHarness();

        emitWrite(failure(GROUPS_SHARD, FsRejectErrorCode.PERMISSION_DENIED, ASSET_LIBRARY));

        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(shown(showSticky)).toMatchObject({
            message: "Could not save the asset library",
            detail: "The file is read-only, or Studio is not allowed to write to it. The change was not saved.",
        });
        // "Retry now" flushes the savers, and none of them writes this file.
        expect(shown(showSticky).actions).toBeUndefined();
        // Nothing is owed: the status bar has no save to wait for.
        expect(service.getStatus()).toBe("clean");
        expect(service.getFailures()).toHaveLength(0);
        expect(log).toHaveBeenCalledWith("storage", "error", expect.stringContaining("not retried"), expect.anything());
    });

    it("keeps the retry sentence and the button for a file a saver still owes", async () => {
        const { service, emitWrite, showSticky } = await makeHarness();

        emitWrite(failure("D:/projects/my-game/editor/ui/uidoc.json", FsRejectErrorCode.PERMISSION_DENIED));

        expect(shown(showSticky)).toMatchObject({
            message: "Could not save the interface document",
            detail: "The file is read-only, or Studio is not allowed to write to it. Retrying fails until this is fixed.",
        });
        expect(shown(showSticky).actions).toHaveLength(1);
        expect(service.getStatus()).toBe("failed");
    });

    it("says one thing once when two files the author knows as one both fail", async () => {
        const { emitWrite, showSticky, close } = await makeHarness();

        // One new folder writes the folder list and the row order beside it.
        emitWrite(failure(GROUPS_SHARD, FsRejectErrorCode.PERMISSION_DENIED, ASSET_LIBRARY));
        emitWrite(failure(ORDER_SHARD, FsRejectErrorCode.PERMISSION_DENIED, ASSET_LIBRARY));
        expect(showSticky).toHaveBeenCalledTimes(1);

        // The notice stays while any file it speaks for is still failing.
        emitWrite({ path: GROUPS_SHARD, ok: true });
        expect(close).not.toHaveBeenCalled();
        emitWrite({ path: ORDER_SHARD, ok: true });
        expect(close).toHaveBeenCalledWith("toast-1");
    });

    it("titles an asset's content by the asset's name, never by the tail of its id", async () => {
        const { emitWrite, showSticky } = await makeHarness();

        emitWrite(failure(
            ASSET_CONTENT,
            FsRejectErrorCode.PERMISSION_DENIED,
            itemWrite("room-warm.png", "workspace.shell.save.stores.assets", "notRetried"),
        ));

        expect(shown(showSticky).message).toBe("Could not save “room-warm.png”");
        expect(shown(showSticky).message).not.toMatch(HEX_ID_TAIL);
    });

    it("names no file for a write whose writer did not say what it was, and promises no retry", async () => {
        const { service, emitWrite, showSticky } = await makeHarness();

        emitWrite({ path: ASSET_CONTENT, ok: false, error: { code: FsRejectErrorCode.IO_ERROR, message: "EIO" } });

        // Before, this was "Could not save dcd8e1f24b6c4a2f9e0d7b3a1c5e8f90" and "Still retrying in
        // the background" - the id's tail, and a retry nothing was running.
        expect(shown(showSticky)).toMatchObject({ message: "Could not save a file", detail: "The change was not saved." });
        expect(service.getStatus()).toBe("clean");
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
            report: RETRIED,
        });
        emitWrite({
            path: "D:/projects/my-game/editor/story.json",
            ok: false,
            error: { code: FsRejectErrorCode.IPC_ERROR, message: "Failed to write file to app://fs/3f2a9c: Internal Server Error" },
            report: storeWrite("workspace.shell.save.stores.story", "retried"),
        });

        const [readOnly, transport] = showSticky.mock.calls.map(call => (call[0] as Shown).detail);
        expect(readOnly).toBe("The file is read-only, or Studio is not allowed to write to it. Retrying fails until this is fixed.");
        expect(transport).toBe("Still retrying in the background.");
    });

    it("titles an unreadable document by its store, never by its file name", () => {
        const t = createTranslator("en").t;
        expect(describeUnreadableDocumentTitle("assets-metadata", t)).toBe("Could not read the asset library");
        expect(describeUnreadableDocumentTitle("app-tags", t)).toBe("Could not read the build variants");
    });

    it("puts the store's name on the notice for a document that could not be read", async () => {
        const { service, showSticky } = await makeHarness();

        service.reportUnreadableDocument(new DocumentCorruptError({
            kind: "brand",
            path: "editor/brand.json",
            reason: "not valid JSON: Unexpected token",
            text: "{",
        }), null);

        expect(shown(showSticky).message).toBe("Could not read the brand palette");
        expect(shown(showSticky).message).not.toContain("brand.json");
    });

    it.each(SUPPORTED_LOCALES)("carries no URL, no id and no unfilled placeholder in any wording (%s)", locale => {
        const t = createTranslator(locale).t;
        const details = Object.values(FsRejectErrorCode).flatMap(code => [
            describeSaveFailureDetail({ code, transient: true, retried: true }, t),
            describeSaveFailureDetail({ code, transient: false, retried: true }, t),
            describeSaveFailureDetail({ code, transient: true, retried: false }, t),
        ]);
        expect(describeSaveFailureDetail({ code: FsRejectErrorCode.NO_SPACE, transient: true, retried: true }, t))
            .toContain(t("workspace.shell.save.reason.diskFull"));
        const titles = [
            describeSaveFailureTitle(undefined, t),
            describeSaveFailureTitle({ store: "workspace.shell.save.stores.assets" }, t),
            describeSaveFailureTitle({ item: "room-warm.png" }, t),
            describeUnreadableDocumentTitle("characters", t),
        ];
        for (const line of [...details, ...titles]) {
            expect(line).not.toMatch(/app:\/\//);
            expect(line).not.toMatch(UUID);
            expect(line).not.toMatch(HEX_ID_TAIL);
            expect(line).not.toMatch(/\{\w+\}/);
        }
    });

    it.each(SUPPORTED_LOCALES.filter(locale => locale !== "en"))("says it in %s, with no English but the names it was given", locale => {
        const t = createTranslator(locale).t;
        const lines = [
            ...Object.values(FsRejectErrorCode).flatMap(code => [
                describeSaveFailureDetail({ code, transient: true, retried: true }, t),
                describeSaveFailureDetail({ code, transient: false, retried: true }, t),
                describeSaveFailureDetail({ code, transient: false, retried: false }, t),
            ]),
            describeSaveFailureTitle(undefined, t),
            describeSaveFailureTitle({ store: "workspace.shell.save.stores.assets" }, t),
            describeSaveFailureTitle({ store: "workspace.shell.save.stores.panelLayout" }, t),
            describeSaveFailureTitle({ item: "room-warm.png" }, t),
            describeUnreadableDocumentTitle("assets-groups", t),
        ];
        for (const line of lines) {
            // "Studio" and "DLC" are names; "room-warm.png" is the asset's.
            const stripped = line.replace(/room-warm\.png|Studio|DLC/g, "");
            expect(stripped).not.toMatch(/[A-Za-z]{3,}/);
        }
    });
});
