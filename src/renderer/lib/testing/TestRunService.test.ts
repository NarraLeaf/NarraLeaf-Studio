import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameTestEventPayload } from "@shared/types/gameTest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { testRegistry } from "./registry";
import { TestRunService } from "./TestRunService";
import type { TestDefinition, TestGameEvent, TestRunContext } from "./types";

const bridgeMock = vi.hoisted(() => ({
  onEvent: vi.fn((_handler: (payload: GameTestEventPayload) => void) => ({
    cancel: () => undefined
  })),
  launch: vi.fn(),
  stop: vi.fn()
}));

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({ gameTest: bridgeMock }),
  getPrivilegedInterface: () => ({})
}));

/** The pushed-event handler the service installed at init, so a test can play main. */
let pushEvent: (payload: GameTestEventPayload) => void = () => {
  throw new Error("The gameTest event handler was not registered");
};

const disposers: (() => void)[] = [];
let idCounter = 0;

function registerTest(patch: Partial<TestDefinition> = {}): string {
  const id = `unit:test-${(idCounter += 1)}`;
  const definition: TestDefinition = {
    id,
    title: { text: id },
    presentation: "headless",
    run: () => ({ status: "passed" }),
    ...patch
  };
  disposers.push(testRegistry.register(definition));
  return id;
}

function createContext(options: { frozen?: boolean } = {}): WorkspaceContext {
  const consoleStub = {
    registerChannel: vi.fn(() => () => undefined),
    log: vi.fn(),
    setProgress: vi.fn(),
    getProgress: vi.fn(() => null)
  };
  return {
    project: { getConfig: () => ({ projectPath: "D:/project" }) },
    services: {
      get: (serviceId: Services) => {
        if (serviceId === Services.Console) {
          return consoleStub;
        }
        if (serviceId === Services.WorkspaceFreeze) {
          return { isFrozen: () => Boolean(options.frozen) };
        }
        throw new Error(`Unexpected service lookup: ${serviceId}`);
      }
    }
  } as unknown as WorkspaceContext;
}

async function createService(options: { frozen?: boolean } = {}): Promise<TestRunService> {
  const service = new TestRunService();
  await service.initialize(createContext(options), async () => undefined);
  return service;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Wait for the run slot to come free. Bounded so a wedged run fails the test instead of hanging it. */
async function whenSettled(service: TestRunService): Promise<void> {
  for (let attempt = 0; attempt < 400 && service.getActiveRun(); attempt += 1) {
    await tick();
  }
  expect(service.getActiveRun()).toBeNull();
}

beforeEach(() => {
  bridgeMock.onEvent.mockReset();
  bridgeMock.onEvent.mockImplementation((handler) => {
    pushEvent = handler;
    return { cancel: () => undefined };
  });
  bridgeMock.launch.mockReset();
  bridgeMock.stop.mockReset();
  bridgeMock.stop.mockResolvedValue({ success: true, data: undefined });
});

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

describe("TestRunService verdicts", () => {
  it("records the verdict a test returns", async () => {
    const service = await createService();
    const testId = registerTest({
      run: () => ({ status: "failed", summary: { text: "two dead ends" } })
    });

    const runId = await service.start(testId);
    await whenSettled(service);

    const record = service.getRun(runId);
    expect(record?.status).toBe("failed");
    expect(record?.summary).toEqual({ text: "two dead ends" });
    expect(record?.finishedAt).toBeGreaterThanOrEqual(record!.startedAt);
  });

  it("turns a thrown value into `errored` and keeps it on the record", async () => {
    const service = await createService();
    const testId = registerTest({
      run: () => {
        throw new Error("the walker fell over");
      }
    });

    const runId = await service.start(testId);
    await whenSettled(service);

    const record = service.getRun(runId);
    expect(record?.status).toBe("errored");
    expect(record?.error).toContain("the walker fell over");
  });

  it("turns an abort that surfaces as a rejection into `cancelled`, keeping the findings", async () => {
    const service = await createService();
    const testId = registerTest({
      run: (ctx) => {
        ctx.report({ severity: "warning", message: { text: "found before the stop" } });
        return new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
    });

    const runId = await service.start(testId);
    await tick();
    service.cancel(runId);
    await whenSettled(service);

    const record = service.getRun(runId);
    expect(record?.status).toBe("cancelled");
    // A cancelled run is still evidence.
    expect(record?.findings).toEqual([
      { severity: "warning", message: { text: "found before the stop" } }
    ]);
  });

  it("honours a verdict a test returns after catching its own abort", async () => {
    // Ruling R4's shape for "close the window when satisfied": the test, not the host, decides
    // what author-termination means to it.
    const service = await createService();
    const testId = registerTest({
      run: async (ctx) => {
        await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve()));
        return { status: "failed", summary: { text: "the author stopped it" } };
      }
    });

    const runId = await service.start(testId);
    await tick();
    service.cancel(runId);
    await whenSettled(service);

    expect(service.getRun(runId)?.status).toBe("failed");
  });

  it("keeps this session's history, newest first", async () => {
    const service = await createService();
    const first = await service.start(registerTest());
    await whenSettled(service);
    const second = await service.start(registerTest());
    await whenSettled(service);

    expect(service.listRuns().map((run) => run.runId)).toEqual([second, first]);
  });
});

describe("TestRunService capabilities", () => {
  it("omits an undeclared capability rather than handing over a throwing stub", async () => {
    const service = await createService();
    const seen: TestRunContext[] = [];
    const testId = registerTest({
      requires: [],
      run: (ctx) => {
        seen.push(ctx);
        return { status: "passed" };
      }
    });

    await service.start(testId);
    await whenSettled(service);

    // Ruling R5: `requires` is the whole truth, and `"game" in ctx` is how a test feature-detects.
    expect("game" in seen[0]).toBe(false);
    expect("project" in seen[0]).toBe(false);
  });

  it("hands over only the capabilities a test declared", async () => {
    const service = await createService();
    const seen: TestRunContext[] = [];
    const testId = registerTest({
      requires: ["project.read"],
      run: (ctx) => {
        seen.push(ctx);
        return { status: "passed" };
      }
    });

    await service.start(testId);
    await whenSettled(service);

    expect("project" in seen[0]).toBe(true);
    expect(seen[0].project?.projectPath).toBe("D:/project");
    expect("game" in seen[0]).toBe(false);
  });

  it("fails the run when a headless test asks for a game window, whatever it then claims", async () => {
    const service = await createService();
    let refusal: unknown;
    const testId = registerTest({
      // Declared headless but asking for the capability anyway: `requires` should already have
      // prevented this, and ruling R6 is the belt behind it.
      presentation: "headless",
      requires: ["game.launch"],
      run: async (ctx) => {
        try {
          await ctx.game!.launch();
        } catch (error) {
          refusal = error;
        }
        // Swallowed the refusal and claims a pass - the host must not believe it.
        return { status: "passed" };
      }
    });

    const runId = await service.start(testId);
    await whenSettled(service);

    expect(String(refusal)).toContain("headless");
    const record = service.getRun(runId);
    expect(record?.status).toBe("errored");
    expect(record?.error).toContain("headless");
    expect(record?.summary).toBeUndefined();
    expect(bridgeMock.launch).not.toHaveBeenCalled();
  });

  it("replays events pushed before the caller could subscribe, and refuses a second session", async () => {
    const service = await createService();
    const seen: TestGameEvent[] = [];
    let secondLaunch: unknown;

    bridgeMock.launch.mockImplementation(async () => {
      // Main pushes the game's first lines before the launch answer gets back across IPC.
      pushEvent({
        sessionId: "session-1",
        runId: service.getActiveRun()!.runId,
        timestamp: Date.now(),
        event: { kind: "console", level: "error", source: "game", message: "startup failed" }
      });
      return { success: true, data: { ok: true, sessionId: "session-1" } };
    });

    const testId = registerTest({
      presentation: "windowed",
      requires: ["game.launch"],
      run: async (ctx) => {
        const session = await ctx.game!.launch();
        session.onEvent((event) => seen.push(event));

        await ctx.game!.launch().catch((error) => {
          secondLaunch = error;
        });

        pushEvent({
          sessionId: "session-1",
          runId: ctx.runId,
          timestamp: Date.now(),
          event: { kind: "exit", exit: { reason: "closed-by-user", code: 0, signal: null } }
        });
        const exit = await session.waitForExit();
        return exit.reason === "closed-by-user"
          ? { status: "passed" }
          : { status: "failed", summary: { text: "the game did not survive" } };
      }
    });

    const runId = await service.start(testId);
    await whenSettled(service);

    expect(seen[0]).toEqual({
      kind: "console",
      level: "error",
      source: "game",
      message: "startup failed"
    });
    expect(seen[1]).toEqual({
      kind: "exit",
      exit: { reason: "closed-by-user", code: 0, signal: null }
    });
    expect(String(secondLaunch)).toContain("already has a game session");
    expect(service.getRun(runId)?.status).toBe("passed");
    expect(bridgeMock.launch).toHaveBeenCalledTimes(1);
  });
});

describe("TestRunService host gates", () => {
  it("holds the run slot against a second run", async () => {
    const service = await createService();
    const slow = registerTest({
      run: () => new Promise((resolve) => setTimeout(() => resolve({ status: "passed" }), 20))
    });
    const other = registerTest();

    await service.start(slow);
    await expect(service.start(other)).rejects.toThrow();
    expect(service.getAvailability(other).available).toBe(false);

    await whenSettled(service);
    expect(service.getAvailability(other).available).toBe(true);
  });

  it("refuses a windowed test on a frozen workspace and allows a headless one", async () => {
    const service = await createService({ frozen: true });
    const windowed = registerTest({ presentation: "windowed" });
    const headless = registerTest({ presentation: "headless" });

    // Ruling R9: Preview is already refused while frozen, and a test must not be the way around
    // that gate - but a headless one is a read-only observer, exactly like `lint:project`.
    expect(service.getAvailability(windowed)).toEqual({
      available: false,
      reason: { key: "test.reason.frozen" }
    });
    expect(service.getAvailability(headless)).toEqual({ available: true });
    await expect(service.start(windowed)).rejects.toThrow();
  });

  it("lets a definition decline for itself, and reports a definition that throws", async () => {
    const service = await createService();
    const declines = registerTest({
      checkAvailability: () => ({ available: false, reason: { text: "no locales configured" } })
    });
    const broken = registerTest({
      checkAvailability: () => {
        throw new Error("bad definition");
      }
    });

    expect(service.getAvailability(declines)).toEqual({
      available: false,
      reason: { text: "no locales configured" }
    });
    expect(service.getAvailability(broken).available).toBe(false);
  });

  it("lists the built-in test even before anything else touched the registry", async () => {
    const service = await createService();
    expect(
      service
        .listTests()
        .some((test) => test.definition.id === "narraleaf-studio:project-diagnostics")
    ).toBe(true);
  });
});
