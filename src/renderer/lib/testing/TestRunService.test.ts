import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameTestEventPayload } from "@shared/types/gameTest";
import type { WorkspaceFreezeKind } from "@shared/types/ipcEvents";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { resetProjectTrustCacheForTests } from "@/lib/workspace/projectTrust";
import { testRegistry } from "./registry";
import { TestRunService } from "./TestRunService";
import {
    TEST_PROTOCOL_VERSION,
    type TestAvailabilityContext,
    type TestDefinition,
    type TestGameEvent,
    type TestRunContext,
} from "./types";

const bridgeMock = vi.hoisted(() => ({
    onEvent: vi.fn((_handler: (payload: GameTestEventPayload) => void) => ({ cancel: () => undefined })),
    launch: vi.fn(),
    stop: vi.fn(),
}));

/** Main's trust ledger, which `isProjectTrusted` asks across IPC. Answers "trusted" unless a case says otherwise. */
const trustMock = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ gameTest: bridgeMock, projectTrust: trustMock }),
    getPrivilegedInterface: () => ({}),
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
        ...patch,
    };
    disposers.push(testRegistry.register(definition));
    return id;
}

/**
 * The project's parameter cache, in memory.
 *
 * A plain file behind `readJSON` / `write`, so the service's own "absent or unreadable means nothing
 * remembered" path is exercised rather than mocked away.
 */
type FakeCache = {
    file: string | null;
    written: string[];
    createdDirs: string[];
};

function createContext(options: { freeze?: WorkspaceFreezeKind; cache?: FakeCache } = {}): WorkspaceContext {
    const consoleStub = {
        registerChannel: vi.fn(() => () => undefined),
        log: vi.fn(),
        setProgress: vi.fn(),
        getProgress: vi.fn(() => null),
    };
    const cache = options.cache;
    const filesystemStub = {
        readJSON: async () => {
            if (cache?.file == null) {
                return { ok: false, error: { code: "NOT_FOUND", message: "no such file" } };
            }
            try {
                return { ok: true, data: JSON.parse(cache.file) };
            } catch {
                return { ok: false, error: { code: "INVALID_JSON", message: "bad json" } };
            }
        },
        createDir: async (path: string) => {
            cache?.createdDirs.push(path);
            return { ok: true, data: undefined };
        },
        write: async (_path: string, data: string) => {
            if (cache) {
                cache.file = data;
                cache.written.push(data);
            }
            return { ok: true, data: undefined };
        },
    };
    return {
        project: {
            getConfig: () => ({ projectPath: "D:/project" }),
            resolve: (...paths: (string | readonly string[])[]) =>
                ["D:/project", ...paths.flatMap(path => (Array.isArray(path) ? path : [path]))].join("/"),
        },
        services: {
            get: (serviceId: Services) => {
                if (serviceId === Services.Console) {
                    return consoleStub;
                }
                if (serviceId === Services.WorkspaceFreeze) {
                    return { getReason: () => (options.freeze ? { kind: options.freeze } : null) };
                }
                if (serviceId === Services.FileSystem) {
                    if (!cache) {
                        throw new Error("This test has no file system");
                    }
                    return filesystemStub;
                }
                throw new Error(`Unexpected service lookup: ${serviceId}`);
            },
        },
    } as unknown as WorkspaceContext;
}

async function createService(options: { freeze?: WorkspaceFreezeKind; cache?: FakeCache } = {}): Promise<TestRunService> {
    const service = new TestRunService();
    await service.initialize(createContext(options), async () => undefined);
    return service;
}

function emptyCache(): FakeCache {
    return { file: null, written: [], createdDirs: [] };
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Wait for the run slot to come free. Bounded so a wedged run fails the test instead of hanging it. */
async function whenSettled(service: TestRunService): Promise<void> {
    for (let attempt = 0; attempt < 400 && service.getActiveRun(); attempt += 1) {
        await tick();
    }
    expect(service.getActiveRun()).toBeNull();
}

beforeEach(() => {
    bridgeMock.onEvent.mockReset();
    bridgeMock.onEvent.mockImplementation(handler => {
        pushEvent = handler;
        return { cancel: () => undefined };
    });
    bridgeMock.launch.mockReset();
    bridgeMock.stop.mockReset();
    bridgeMock.stop.mockResolvedValue({ success: true, data: undefined });
    // Answers are memoized per project path for the life of a window, so one case's answer would
    // otherwise be every later case's answer.
    resetProjectTrustCacheForTests();
    trustMock.query.mockReset();
    trustMock.query.mockResolvedValue({ success: true, data: { trusted: true } });
});

afterEach(() => {
    while (disposers.length > 0) {
        disposers.pop()?.();
    }
});

describe("TestRunService verdicts", () => {
    it("records the verdict a test returns", async () => {
        const service = await createService();
        const testId = registerTest({ run: () => ({ status: "failed", summary: { text: "two dead ends" } }) });

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
            },
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
            run: ctx => {
                ctx.report({ severity: "warning", message: { text: "found before the stop" } });
                return new Promise((_resolve, reject) => {
                    ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
                });
            },
        });

        const runId = await service.start(testId);
        await tick();
        service.cancel(runId);
        await whenSettled(service);

        const record = service.getRun(runId);
        expect(record?.status).toBe("cancelled");
        // A cancelled run is still evidence.
        expect(record?.findings).toEqual([{ severity: "warning", message: { text: "found before the stop" } }]);
    });

    it("honours a verdict a test returns after catching its own abort", async () => {
        // Ruling R4's shape for "close the window when satisfied": the test, not the host, decides
        // what author-termination means to it.
        const service = await createService();
        const testId = registerTest({
            run: async ctx => {
                await new Promise<void>(resolve => ctx.signal.addEventListener("abort", () => resolve()));
                return { status: "failed", summary: { text: "the author stopped it" } };
            },
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

        expect(service.listRuns().map(run => run.runId)).toEqual([second, first]);
    });
});

describe("TestRunService capabilities", () => {
    it("omits an undeclared capability rather than handing over a throwing stub", async () => {
        const service = await createService();
        const seen: TestRunContext[] = [];
        const testId = registerTest({
            requires: [],
            run: ctx => {
                seen.push(ctx);
                return { status: "passed" };
            },
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
            run: ctx => {
                seen.push(ctx);
                return { status: "passed" };
            },
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
            run: async ctx => {
                try {
                    await ctx.game!.launch();
                } catch (error) {
                    refusal = error;
                }
                // Swallowed the refusal and claims a pass - the host must not believe it.
                return { status: "passed" };
            },
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
                event: { kind: "console", level: "error", source: "game", message: "startup failed" },
            });
            return { success: true, data: { ok: true, sessionId: "session-1" } };
        });

        const testId = registerTest({
            presentation: "windowed",
            requires: ["game.launch"],
            run: async ctx => {
                const session = await ctx.game!.launch();
                session.onEvent(event => seen.push(event));

                await ctx.game!.launch().catch(error => {
                    secondLaunch = error;
                });

                pushEvent({
                    sessionId: "session-1",
                    runId: ctx.runId,
                    timestamp: Date.now(),
                    event: { kind: "exit", exit: { reason: "closed-by-user", code: 0, signal: null } },
                });
                const exit = await session.waitForExit();
                return exit.reason === "closed-by-user"
                    ? { status: "passed" }
                    : { status: "failed", summary: { text: "the game did not survive" } };
            },
        });

        const runId = await service.start(testId);
        await whenSettled(service);

        expect(seen[0]).toEqual({ kind: "console", level: "error", source: "game", message: "startup failed" });
        expect(seen[1]).toEqual({ kind: "exit", exit: { reason: "closed-by-user", code: 0, signal: null } });
        expect(String(secondLaunch)).toContain("already has a game session");
        expect(service.getRun(runId)?.status).toBe("passed");
        expect(bridgeMock.launch).toHaveBeenCalledTimes(1);
    });
});

describe("TestRunService host gates", () => {
    it("holds the run slot against a second run", async () => {
        const service = await createService();
        const slow = registerTest({
            run: () => new Promise(resolve => setTimeout(() => resolve({ status: "passed" }), 20)),
        });
        const other = registerTest();

        await service.start(slow);
        await expect(service.start(other)).rejects.toThrow();
        expect(service.getAvailability(other).available).toBe(false);

        await whenSettled(service);
        expect(service.getAvailability(other).available).toBe(true);
    });

    it("refuses a windowed test on a frozen workspace and allows a headless one", async () => {
        const service = await createService({ freeze: "manual" });
        const windowed = registerTest({ presentation: "windowed" });
        const headless = registerTest({ presentation: "headless" });

        // Ruling R9: Preview is already refused while frozen, and a test must not be the way around
        // that gate - but a headless one is a read-only observer, exactly like `lint:project`.
        expect(service.getAvailability(windowed)).toEqual({
            available: false,
            reason: { key: "test.reason.frozen" },
        });
        expect(service.getAvailability(headless)).toEqual({ available: true });
        await expect(service.start(windowed)).rejects.toThrow();
    });

    it("offers a windowed test during a live session, because main would launch it", async () => {
        // The refusal above is a consistency guard - what ran would not be what the author is
        // looking at. A session's working tree IS what everybody is looking at, and `GameTestManager`
        // launches it, so refusing here would grey out a row over a game that would have started.
        const service = await createService({ freeze: "live-session" });
        const windowed = registerTest({ presentation: "windowed" });

        expect(service.getAvailability(windowed)).toEqual({ available: true });
    });

    it("greys every test out in a project nobody has vouched for, and refuses to start one", async () => {
        trustMock.query.mockResolvedValue({ success: true, data: { trusted: false } });
        const service = await createService();
        const headless = registerTest({ presentation: "headless" });
        const windowed = registerTest({ presentation: "windowed" });

        await service.prepareAvailability();

        // The same seam the freeze cuts, reached separately: a windowed test starts a game on the
        // project's behalf, which is what trust governs and what `GameTestManager.launch` refuses.
        // A headless one reads the project and starts nothing, and reading is exactly what an
        // untrusted project keeps - greying it would take away browsing to no end.
        expect(service.getAvailability(windowed)).toEqual({
            available: false,
            reason: { key: "test.reason.distrusted" },
        });
        expect(service.getAvailability(headless)).toEqual({ available: true });
        await expect(service.start(windowed)).rejects.toThrow();
    });

    it("leaves a trusted project alone", async () => {
        const service = await createService();
        const testId = registerTest();

        await service.prepareAvailability();

        expect(service.getAvailability(testId)).toEqual({ available: true });
    });

    it("settles trust on activation, so Run again on a report reads a settled answer", async () => {
        // The report tab has no prepare step of its own - it asks the service and renders what it
        // says. Nothing but activation has run here.
        trustMock.query.mockResolvedValue({ success: true, data: { trusted: false } });
        const service = await createService();
        const testId = registerTest({ presentation: "windowed" });

        service.activate(service.getContext());
        await tick();

        expect(service.getAvailability(testId).available).toBe(false);
    });

    it("re-asks after a query that failed rather than distrusting the project for the session", async () => {
        trustMock.query.mockRejectedValueOnce(new Error("the channel is down"));
        const service = await createService();
        const testId = registerTest({ presentation: "windowed" });

        // A query that cannot be answered is answered "not trusted": absence of an answer is not
        // evidence that somebody else's code is safe to run.
        await service.prepareAvailability();
        expect(service.getAvailability(testId).available).toBe(false);

        // But it is not remembered, so the next open asks again instead of leaving the author with
        // every test greyed out for the rest of the window's life.
        await service.prepareAvailability();
        expect(service.getAvailability(testId)).toEqual({ available: true });
    });

    it("shows a definition's option list the same distrust the host judged on", async () => {
        trustMock.query.mockResolvedValue({ success: true, data: { trusted: false } });
        const service = await createService();
        const seen: TestAvailabilityContext[] = [];
        const testId = registerTest({
            parameters: [{
                id: "ending",
                kind: "select",
                label: { text: "Ending" },
                options: ctx => {
                    seen.push(ctx);
                    return [{ value: "good", label: { text: "Good end" } }];
                },
            }],
        });

        await service.prepareAvailability();
        service.listParameters(testId);

        // `options` is the one place a definition sees this: the gate above answers before
        // `checkAvailability` is asked anything.
        expect(seen.at(-1)?.distrusted).toBe(true);
    });

    it("lets a definition decline for itself, and reports a definition that throws", async () => {
        const service = await createService();
        const declines = registerTest({
            checkAvailability: () => ({ available: false, reason: { text: "no locales configured" } }),
        });
        const broken = registerTest({
            checkAvailability: () => {
                throw new Error("bad definition");
            },
        });

        expect(service.getAvailability(declines)).toEqual({
            available: false,
            reason: { text: "no locales configured" },
        });
        expect(service.getAvailability(broken).available).toBe(false);
    });

    it("lists the built-in test even before anything else touched the registry", async () => {
        const service = await createService();
        expect(service.listTests().some(test => test.definition.id === "narraleaf-studio:project-diagnostics"))
            .toBe(true);
    });

    it("refuses a test whose select has nothing to choose from, naming the parameter", async () => {
        const service = await createService();
        // A project with no endings yet. Not a defect and not an error - but a walkthrough that
        // cannot be told where to walk cannot be started either.
        const testId = registerTest({
            parameters: [{ id: "ending", kind: "select", label: { text: "Ending" }, options: () => [] }],
        });

        const availability = service.getAvailability(testId);
        expect(availability.available).toBe(false);
        expect(availability.available === false && availability.reason).toEqual({
            key: "test.reason.parameterEmpty",
            params: { parameter: "Ending" },
        });
        await expect(service.start(testId)).rejects.toThrow();
    });
});

describe("TestRunService parameters", () => {
    const ENDINGS = [
        { value: "good", label: { text: "Good end" } },
        { value: "true", label: { text: "True end" } },
    ];

    function registerParametrised(patch: Partial<TestDefinition> = {}, seen: TestRunContext[] = []): string {
        return registerTest({
            parameters: [
                { id: "ending", kind: "select", label: { text: "Ending" }, options: () => ENDINGS },
                { id: "skipRead", kind: "boolean", label: { text: "Skip read text" }, defaultValue: true },
            ],
            run: ctx => {
                seen.push(ctx);
                return { status: "passed" };
            },
            ...patch,
        });
    }

    it("states the protocol version parameters arrived in", () => {
        // Bumped because `TestRunContext.parameters` is a required member; a plugin built against
        // an older host would not have been given one.
        expect(TEST_PROTOCOL_VERSION).toBe(2);
    });

    it("hands a test only the ids it declared, resolved against its own declarations", async () => {
        const service = await createService();
        const seen: TestRunContext[] = [];
        const testId = registerParametrised({}, seen);

        await service.start(testId, {
            ending: "true",
            // Never declared, and a caller cannot smuggle it in.
            devTools: true,
        });
        await whenSettled(service);

        expect(seen[0].parameters).toEqual({ ending: "true", skipRead: true });
    });

    it("gives a test that declares nothing an empty set rather than undefined", async () => {
        const service = await createService();
        const seen: TestRunContext[] = [];
        const testId = registerTest({
            run: ctx => {
                seen.push(ctx);
                return { status: "passed" };
            },
        });

        await service.start(testId, { ending: "true" });
        await whenSettled(service);

        expect(seen[0].parameters).toEqual({});
    });

    it("falls back to the default when a value names an option that is gone", async () => {
        const service = await createService();
        const seen: TestRunContext[] = [];
        const testId = registerParametrised({}, seen);

        await service.start(testId, { ending: "the-one-they-deleted", skipRead: false });
        await whenSettled(service);

        expect(seen[0].parameters).toEqual({ ending: "good", skipRead: false });
    });

    it("snapshots the resolved values on the run record", async () => {
        const service = await createService();
        const testId = registerParametrised();

        const runId = await service.start(testId, { ending: "true", skipRead: false });
        await whenSettled(service);

        // What the report says the run was told, kept after the definition could have been
        // unregistered by a plugin reload.
        expect(service.getRun(runId)?.parameters).toEqual({ ending: "true", skipRead: false });
        expect(service.getRun(runId)?.protocolVersion).toBe(TEST_PROTOCOL_VERSION);
    });

    it("remembers what a test was started with, and reads it back", async () => {
        const cache = emptyCache();
        const service = await createService({ cache });
        const testId = registerParametrised();

        // Nothing on disk yet is the ordinary state, not a failure.
        expect(await service.readRememberedParameters()).toEqual({});

        await service.rememberParameters(testId, { ending: "true", skipRead: false });

        expect(await service.readRememberedParameters()).toEqual({
            [testId]: { ending: "true", skipRead: false },
        });
        expect(cache.createdDirs).toEqual(["D:/project/editor/cache/"]);
    });

    it("treats an unreadable cache as nothing remembered", async () => {
        const cache = emptyCache();
        cache.file = "{ this was truncated mid-";
        const service = await createService({ cache });

        expect(await service.readRememberedParameters()).toEqual({});
    });

    it("keeps working with no file system at all", async () => {
        // A workspace whose services are not all up yet. Losing the memory of a dropdown is the
        // whole cost, and it must not be an error anyone sees.
        const service = await createService();

        expect(await service.readRememberedParameters()).toEqual({});
        await expect(service.rememberParameters("unit:whatever", { ending: "true" })).resolves.toBeUndefined();
    });
});
