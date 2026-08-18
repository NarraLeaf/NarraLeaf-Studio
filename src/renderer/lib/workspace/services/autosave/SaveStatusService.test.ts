import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { freezeProjectWrites, refuseFrozenWrite, thawProjectWrites } from "@/lib/app/writeFreeze";
import type { FsWriteOutcome } from "../core/FileSystem";
import { Services, type WorkspaceContext } from "../services";
import { DebouncedSaver } from "./DebouncedSaver";
import { SaveStatusService } from "./SaveStatusService";

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
        return () => {
          observer = null;
        };
      }
    },
    [Services.UI]: { notifications: { showSticky, close } },
    [Services.Console]: { log }
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
      }
    }
  } as unknown as WorkspaceContext;

  const service = new SaveStatusService();
  service.setContext(ctx);
  await service.initialize(ctx, async () => undefined);

  return {
    service,
    emitWrite: (outcome) => observer?.(outcome),
    showSticky,
    close,
    log
  };
}

const PROJECT = "D:/projects/my-game";

const failure = (path: string, code = FsRejectErrorCode.IO_ERROR): FsWriteOutcome => ({
  path,
  ok: false,
  error: { code, message: "no space left on device" }
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
    const failing = vi.fn(async () => {
      throw new Error("read-only volume");
    });
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

  it("takes the notice down when the workspace thaws", async () => {
    const { close } = await makeHarness();
    freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });
    refuseFrozenWrite(`${PROJECT}/project.json`);

    thawProjectWrites();

    expect(close).toHaveBeenCalledWith("toast-1");
  });
});
