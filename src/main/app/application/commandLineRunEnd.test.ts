import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
    COMMAND_LINE_RUN_FAILURE_BACKSTOP_MS,
    COMMAND_LINE_RUN_FINISH_MARGIN_MS,
    COMMAND_LINE_RUN_SILENCE_MS,
    COMMAND_LINE_RUN_WATCHDOG_MARGIN_MS,
    CommandLineRunEnd,
    describeFatalErrorForCommandLine,
    describeProfileInUse,
    endCommandLineRunOnFailure,
    installCommandLineRunEnd,
    readCommandLineRunIdentity,
    resetCommandLineRunEndForTests,
    type CommandLineRunEndHost,
    type CommandLineRunIdentity,
} from "./commandLineRunEnd";

/**
 * The world as the ending sees it, with a clock that only moves when the test says so. Standard
 * error calls back at once unless told to hang, which is the one stream a Windows pipe can hold.
 */
function fakeHost(options: { stderrHangs?: boolean; reportFails?: boolean } = {}) {
    let now = 1_000;
    let nextId = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const stderr: string[] = [];
    const reports: { path: string; content: unknown }[] = [];
    const exits: number[] = [];

    const host: CommandLineRunEndHost = {
        writeStderr: (text, done) => {
            stderr.push(text);
            if (!options.stderrHangs) {
                done();
            }
        },
        writeReport: (filePath, content) => {
            if (options.reportFails) {
                throw new Error("EACCES: permission denied");
            }
            reports.push({ path: filePath, content: JSON.parse(content) });
        },
        exit: code => exits.push(code),
        studioVersion: () => "0.9.2",
        now: () => now,
        setTimer: (fn, ms) => {
            const id = nextId++;
            timers.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimer: handle => {
            timers.delete(handle as number);
        },
    };

    /** Move the clock forward, firing whatever falls due on the way, in order. */
    function advance(ms: number): void {
        const until = now + ms;
        for (;;) {
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= until)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) {
                break;
            }
            timers.delete(due[0]);
            now = due[1].at;
            due[1].fn();
        }
        now = until;
    }

    return { host, stderr, reports, exits, advance };
}

const lint: CommandLineRunIdentity = { kind: "lint", reportPath: "/srv/artifacts/lint.json", unsignedAccepted: false };
const build: CommandLineRunIdentity = { kind: "build", reportPath: "/srv/artifacts/build.json", unsignedAccepted: true };

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
}

afterEach(() => {
    resetCommandLineRunEndForTests();
});

describe("readCommandLineRunIdentity", () => {
    const cwd = path.resolve("/srv/job");

    it("is null for a launch with somebody in front of it", () => {
        expect(readCommandLineRunIdentity(["electron", "."], cwd)).toBeNull();
        expect(readCommandLineRunIdentity(["electron", ".", "--project=/srv/projects/game"], cwd)).toBeNull();
    });

    it("names the family and resolves the report path the way the run will", () => {
        expect(readCommandLineRunIdentity(
            ["electron", ".", "--lint=/srv/projects/game", "--lint-report=out/lint.json"],
            cwd,
        )).toEqual({ kind: "lint", reportPath: path.resolve(cwd, "out/lint.json"), unsignedAccepted: false });
        expect(readCommandLineRunIdentity(
            ["electron", ".", "--build=/srv/projects/game", "--build-allow-unsigned"],
            cwd,
        )).toEqual({ kind: "build", reportPath: null, unsignedAccepted: true });
    });

    it("is a run even when the rest of the line is wrong, which is when it most needs to end as one", () => {
        expect(readCommandLineRunIdentity(["electron", ".", "--test"], cwd)?.kind).toBe("test");
    });
});

describe("a failure before the run has started", () => {
    it("prints the family's two lines, writes the family's report and exits 4", () => {
        const { host, stderr, reports, exits } = fakeHost();
        const logged: string[] = [];
        const end = new CommandLineRunEnd(lint, host);
        end.useLog(line => logged.push(line));

        end.fail("Studio could not start: the profile folder /x (--lint-user-data-dir) could not be created: ENOTDIR");

        expect(stderr.join("")).toBe(
            "[error] Lint: Studio could not start: the profile folder /x (--lint-user-data-dir) could not be created: ENOTDIR\n"
            + "[error] Lint: studio-failed (exit 4)\n",
        );
        expect(logged).toEqual(stderr.join("").trim().split("\n"));
        expect(exits).toEqual([4]);
        expect(reports).toHaveLength(1);
        expect(reports[0].path).toBe("/srv/artifacts/lint.json");
        expect(reports[0].content).toMatchObject({
            schema: 1,
            check: "lint",
            result: "studio-failed",
            exitCode: 4,
            studioVersion: "0.9.2",
            project: {},
            plugins: [],
            error: "Studio could not start: the profile folder /x (--lint-user-data-dir) could not be created: ENOTDIR",
            log: [
                expect.objectContaining({ level: "error", source: "Lint", message: expect.stringMatching(/^Studio could not start/) }),
                expect.objectContaining({ level: "error", source: "Lint", message: "studio-failed (exit 4)" }),
            ],
        });
    });

    it("writes a build's report with every block a job reads, saying nothing was built", () => {
        const { host, reports } = fakeHost();
        new CommandLineRunEnd(build, host).fail("Another Studio is already running on this profile.");

        expect(reports[0].content).toMatchObject({
            schema: 1,
            result: "studio-failed",
            exitCode: 4,
            signing: { signable: false, signed: false, unsignedAccepted: true },
            experimental: { state: "off", conditions: [], requestedConditions: [], unknownConditionFlags: [] },
            plugins: [],
            findings: [],
            artifacts: [],
        });
        expect(reports[0].content).not.toHaveProperty("check");
    });

    it("still exits 4 when the report cannot be written, and says where it could not go", () => {
        const { host, stderr, exits } = fakeHost({ reportFails: true });
        new CommandLineRunEnd(lint, host).fail("Studio could not start: something");

        expect(exits).toEqual([4]);
        expect(stderr.join("")).toContain("could not write the report to /srv/artifacts/lint.json: EACCES");
    });

    it("does not wait forever on a standard error that never drains", () => {
        const { host, exits, advance } = fakeHost({ stderrHangs: true });
        new CommandLineRunEnd(lint, host).fail("Studio could not start: something");

        expect(exits).toEqual([]);
        advance(2000);
        expect(exits).toEqual([4]);
    });

    it("keeps a failure whose own message spans lines to one line", () => {
        const { host, reports } = fakeHost();
        new CommandLineRunEnd(lint, host).fail('Studio could not start: plugin-registry.json could not be read: Unexpected token, "{\n\t"plugi"... is not valid JSON');

        expect((reports[0].content as { error: string }).error)
            .toBe('Studio could not start: plugin-registry.json could not be read: Unexpected token, "{ "plugi"... is not valid JSON');
    });
});

describe("a failure once the run has started", () => {
    it("is handed to the run's own finish, which writes the report and exits", async () => {
        const { host, stderr, reports, exits } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        const finished: string[] = [];
        end.attach(async sentence => {
            finished.push(sentence);
        });

        end.fail("Studio stopped on an internal error: Error: injected.");
        await flushMicrotasks();

        expect(finished).toEqual(["Studio stopped on an internal error: Error: injected."]);
        expect(stderr).toEqual([]);
        expect(reports).toEqual([]);
        expect(exits).toEqual([]);
    });

    it("falls back to its own ending when the run cannot end itself", async () => {
        const { host, reports, exits } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        end.attach(async () => {
            throw new Error("the logger is gone");
        });

        end.fail("Studio stopped on an internal error: Error: injected.");
        await flushMicrotasks();

        expect(exits).toEqual([4]);
        expect((reports[0].content as { error: string }).error)
            .toBe("Studio stopped on an internal error: Error: injected. (the run could not end itself: the logger is gone)");
    });

    it("counts only the first failure, and keeps the rest to the profile's log", async () => {
        const { host, stderr } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        const logged: string[] = [];
        end.useLog(line => logged.push(line));
        const finished: string[] = [];
        end.attach(async sentence => {
            finished.push(sentence);
        });

        end.fail("Studio stopped on an internal error: Error: first.");
        end.fail("Studio could not start: Error: first.");
        await flushMicrotasks();

        expect(finished).toEqual(["Studio stopped on an internal error: Error: first."]);
        expect(stderr).toEqual([]);
        expect(logged).toEqual(["[error] Lint: a further failure while the run was already ending: Studio could not start: Error: first."]);
    });

    it("ends the process with 4 when the run never gets as far as its own exit", async () => {
        const { host, exits, stderr, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        end.attach(() => new Promise<void>(() => undefined));
        end.waitingOn("the open project to be put down");

        end.fail("Studio stopped on an internal error: Error: injected.");
        await flushMicrotasks();
        advance(COMMAND_LINE_RUN_FAILURE_BACKSTOP_MS - 1);
        expect(exits).toEqual([]);
        advance(1);

        expect(exits).toEqual([4]);
        expect(stderr.join("")).toContain("(it was waiting for the open project to be put down), so it exits now with 4");
    });
});

describe("the watchdog", () => {
    const idleMs = COMMAND_LINE_RUN_SILENCE_MS.lint + COMMAND_LINE_RUN_WATCHDOG_MARGIN_MS;

    it("ends a run that stops making progress, naming what it was waiting on", () => {
        const { host, stderr, exits, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        end.waitingOn("the project's workspace window to load");

        advance(idleMs - 1);
        expect(exits).toEqual([]);
        advance(1);

        expect(exits).toEqual([4]);
        expect(stderr.join("")).toContain(
            `[error] Lint: Studio made no progress for ${Math.round(idleMs / 60000)} minutes while it was waiting for`
            + " the project's workspace window to load, so the run was abandoned.",
        );
    });

    it("waits from the first moment of the process, before anything has said what it is waiting on", () => {
        const { host, stderr, advance } = fakeHost();
        new CommandLineRunEnd(lint, host);

        advance(idleMs);

        expect(stderr.join("")).toContain("while it was waiting for Studio to start");
    });

    it("gives a build its own, shorter deadline plus the same margin", () => {
        const { host, exits, advance } = fakeHost();
        new CommandLineRunEnd(build, host);

        advance(COMMAND_LINE_RUN_SILENCE_MS.build + COMMAND_LINE_RUN_WATCHDOG_MARGIN_MS);

        expect(exits).toEqual([4]);
    });

    it("is reset by every line the run writes, so a long run is never cut short", () => {
        const { host, exits, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);

        for (let i = 0; i < 5; i += 1) {
            advance(idleMs - 1000);
            end.progress();
        }

        expect(exits).toEqual([]);
    });

    it("hands its failure to the run when there is one, so the run's report carries it", async () => {
        const { host, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        const finished: string[] = [];
        end.attach(async sentence => {
            finished.push(sentence);
        });
        end.waitingOn("the workspace to report");

        advance(idleMs);
        await flushMicrotasks();

        expect(finished).toEqual([expect.stringMatching(/while it was waiting for the workspace to report, so the run was abandoned\.$/)]);
    });
});

describe("a run that has decided its outcome", () => {
    it("exits with the code it decided once its teardown has overrun, rather than waiting on it", () => {
        const { host, exits, stderr, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);

        end.finishing(0, 20_000);
        end.waitingOn("standard output to drain");
        advance(20_000 + COMMAND_LINE_RUN_FINISH_MARGIN_MS - 1);
        expect(exits).toEqual([]);
        advance(1);

        expect(exits).toEqual([0]);
        expect(stderr.join("")).toContain("(it was waiting for standard output to drain), so it exits now with 0");
    });

    it("is not turned into another outcome by a failure during its teardown", async () => {
        const { host, exits, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        const finished: string[] = [];
        end.attach(async sentence => {
            finished.push(sentence);
        });

        end.finishing(1, 20_000);
        end.fail("Studio stopped on an internal error: Error: during the drain.");
        await flushMicrotasks();
        advance(20_000 + COMMAND_LINE_RUN_FINISH_MARGIN_MS);

        expect(finished).toEqual([]);
        expect(exits).toEqual([1]);
    });

    it("takes the run's own bound over the failure's backstop when a failure is what decided it", async () => {
        const { host, exits, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);
        end.attach(async () => {
            // What `finish` does first: decide, and say how long the teardown may take.
            end.finishing(4, 20_000);
        });

        end.fail("Studio stopped on an internal error: Error: injected.");
        await flushMicrotasks();
        advance(20_000 + COMMAND_LINE_RUN_FINISH_MARGIN_MS);

        expect(exits).toEqual([4]);
    });

    it("no longer runs the idle watchdog", () => {
        const { host, exits, advance } = fakeHost();
        const end = new CommandLineRunEnd(lint, host);

        const idleMs = COMMAND_LINE_RUN_SILENCE_MS.lint + COMMAND_LINE_RUN_WATCHDOG_MARGIN_MS;
        // A teardown allowed longer than the idle deadline, so only the idle deadline could fire.
        end.finishing(0, idleMs * 3);
        advance(idleMs * 2);

        expect(exits).toEqual([]);
    });
});

describe("endCommandLineRunOnFailure", () => {
    it("does nothing, and says so, in a launch that is not a command-line run", () => {
        const { host, exits } = fakeHost();
        expect(installCommandLineRunEnd(["electron", "."], host, "/srv")).toBeNull();

        expect(endCommandLineRunOnFailure("Studio stopped on an internal error: Error: x.")).toBe(false);
        expect(exits).toEqual([]);
    });

    it("ends the installed run", () => {
        const { host, exits } = fakeHost();
        installCommandLineRunEnd(["electron", ".", "--lint=/srv/projects/game"], host, "/srv");

        expect(endCommandLineRunOnFailure("Studio stopped on an internal error: Error: x.")).toBe(true);
        expect(exits).toEqual([4]);
    });
});

describe("the sentences", () => {
    it("says a fatal error by its first line, and where the rest of it is", () => {
        expect(describeFatalErrorForCommandLine(
            "Error: injected main-process failure\n    at Timeout._onTimeout (<anonymous>:1:26)",
            path.join("/profile", "logs"),
        )).toBe(`Studio stopped on an internal error: Error: injected main-process failure. The full error is in ${path.join("/profile", "logs", "main.log")}.`);
        expect(describeFatalErrorForCommandLine("Error: ends with a stop.", null))
            .toBe("Studio stopped on an internal error: Error: ends with a stop.");
    });

    it("names the family's own profile flag when another Studio has the profile", () => {
        expect(describeProfileInUse("build")).toBe(
            "Another Studio is already running on this profile, so this build was not started."
            + " Pass --build-user-data-dir to give it a profile of its own.",
        );
        expect(describeProfileInUse("test")).toContain("so this check was not started. Pass --test-user-data-dir");
    });
});
