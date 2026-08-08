import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameBuildRequest } from "@shared/types/gameBuild";
import type { StoryDocument } from "@shared/types/story";
import type { LintReport, LintReportEntry, LintRuleId, LintSeverity } from "@/lib/lint/types";
import type { LintingConfiguration } from "../../project/configuration";
import { Services, type WorkspaceContext } from "../services";
import {
    BUILD_CONSOLE_CHANNEL,
    BuildService,
    countBlockingLintFindings,
    formatLintFinding,
    shouldBlockBuild,
} from "./BuildService";

/**
 * The lint build gate (ruling R3) and the gate it stands behind (ruling R4).
 *
 * Driven through the real `BuildService.start()` with a faked service registry rather than against
 * the decision helper alone, because the claim the milestone makes is not "the arithmetic is right"
 * - it is that a refused build **never reaches the main process**. A test that only asked
 * `shouldBlockBuild` would keep passing if the gate computed the right answer and then started the
 * build anyway. What is asserted is that `gameBuild.start` is not called at all.
 *
 * The pure helper is covered separately at the bottom, where the severity/threshold matrix is cheap
 * to state exhaustively.
 */

const gameBuild = vi.hoisted(() => ({
    // "done" rather than an active status: an active one would start the service's 1s poll and
    // leave a live interval behind every test that lets a build through.
    start: vi.fn(async () => ({ success: true, data: { state: { status: "done" } } })),
    getStatus: vi.fn(async () => ({ success: false })),
    cancel: vi.fn(),
    preflight: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ gameBuild }),
}));

/**
 * Keys and params, not prose. The gate's contract is *which* message it reports a refusal with and
 * what it puts in it; asserting the English sentence would make this file fail on a copy edit.
 */
vi.mock("@/lib/i18n", () => ({
    translate: (key: string, params?: Record<string, unknown>) =>
        (params ? `${key}(${JSON.stringify(params)})` : key),
    translateN: (key: string) => key,
}));

const PROJECT_PATH = "D:/projects/demo";

const REQUEST = {
    targets: [
        { platform: "windows", formats: ["nsis"] },
        { platform: "web", formats: ["dir"] },
    ],
} as unknown as GameBuildRequest;

/** A story with nothing wrong with it. */
const CLEAN_STORY = { id: "s1", name: "Main", scenes: {} } as unknown as StoryDocument;

/** One unresolved command line - what `collectInvalidStoryBlocks` refuses, ahead of lint. */
const STORY_WITH_INVALID_BLOCK = {
    id: "s1",
    name: "Main",
    scenes: {
        sc1: {
            id: "sc1",
            name: "Scene 1",
            rootBlockIds: ["b1"],
            blocks: {
                b1: { id: "b1", kind: "invalid", childrenIds: [], payload: { source: "/hlaf-typed" } },
            },
        },
    },
} as unknown as StoryDocument;

function finding(severity: LintSeverity, ruleId: LintRuleId = "story/dead-end"): LintReportEntry {
    return {
        ruleId,
        messageKey: "lint.rule.storyDeadEnd.message",
        messageParams: { scene: "Scene 1" },
        location: { kind: "story", storyId: "s1", storyName: "Main", sceneId: "sc1", sceneName: "Scene 1" },
        severity,
    };
}

function report(entries: LintReportEntry[]): LintReport {
    return {
        startedAt: 1_000,
        finishedAt: 2_400,
        entries,
        counts: {
            error: entries.filter(entry => entry.severity === "error").length,
            warning: entries.filter(entry => entry.severity === "warning").length,
            info: entries.filter(entry => entry.severity === "info").length,
        },
        rulesRun: [],
        skipped: [],
    };
}

type ConsoleLine = { channel: string; level: string; message: string };

/**
 * A BuildService wired to fakes for every service `start()` reaches: the project's lint config, the
 * lint sweep, the console, and the four dirty-state flushes that run before any gate.
 */
function mount(options: {
    linting?: Partial<LintingConfiguration>;
    run?: () => Promise<LintReport>;
    storyHasInvalidBlock?: boolean;
    /** Defaults to allowing HTTP, so the network gate stays out of the way of this file's subject. */
    allowHttp?: boolean;
    blueprintDocument?: unknown;
} = {}) {
    const lines: ConsoleLine[] = [];
    const run = vi.fn(options.run ?? (async () => report([])));
    const linting: LintingConfiguration = {
        runOnBuild: true,
        failBuildOn: "error",
        severities: {},
        options: {},
        ...options.linting,
    };

    const clean = {
        isDirty: () => false,
        save: async () => undefined,
        getDocument: () => ({}),
        flushPendingChanges: async () => undefined,
    };
    const story = {
        ...clean,
        getLibraryIndex: () => ({ stories: [{ id: "s1", name: "Main" }] }),
        loadStory: async () => (options.storyHasInvalidBlock ? STORY_WITH_INVALID_BLOCK : CLEAN_STORY),
    };
    const consoleService = {
        log: (channel: string, level: string, message: string) => {
            lines.push({ channel, level, message });
        },
        setProgress: () => undefined,
        getProgress: () => null,
    };
    /** A project whose media is all fine, so this file keeps testing the two gates it is about. */
    const media = {
        scan: async () => ({ records: new Map(), probeAvailable: true, unanswered: [], finishedAt: 0 }),
        listUnplayable: () => [],
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) },
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Project:
                        return {
                            getLintingConfiguration: () => linting,
                            getNetworkConfiguration: () => ({
                                allowHttp: options.allowHttp ?? true,
                                allowRemoteResource: false,
                                allowRemoteScript: false,
                            }),
                        };
                    case Services.Lint:
                        return { run };
                    case Services.Console:
                        return consoleService;
                    case Services.Story:
                        return story;
                    case Services.MediaSupport:
                        return media;
                    case Services.UIGraph:
                        return {
                            ...clean,
                            getDocument: () => ({ blueprintDocument: options.blueprintDocument ?? null }),
                        };
                    case Services.Character:
                    case Services.UIDocument:
                        return clean;
                    default:
                        throw new Error(`Unexpected service lookup: ${id}`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new BuildService();
    service.setContext(ctx);
    return { service, lines, run, ctx };
}

beforeEach(() => {
    vi.useFakeTimers();
    gameBuild.start.mockClear();
    gameBuild.start.mockResolvedValue({ success: true, data: { state: { status: "done" } } });
});

afterEach(() => {
    // Discards the console's post-build linger timeout rather than leaving it pending.
    vi.useRealTimers();
});

describe("BuildService lint gate", () => {
    it("does not sweep at all when the project turned the gate off", async () => {
        const { service, run } = mount({ linting: { runOnBuild: false } });

        const state = await service.start(REQUEST);

        expect(run).not.toHaveBeenCalled();
        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
    });

    it("refuses the build on an error finding without reaching the main process", async () => {
        const { service, run } = mount({
            run: async () => report([finding("error", "story/goto-missing"), finding("warning")]),
        });

        const state = await service.start(REQUEST);

        expect(run).toHaveBeenCalledTimes(1);
        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.error).toContain("lint.build.blocked");
        // Only the error counts against `failBuildOn: "error"`, not the warning beside it.
        expect(state.error).toContain("\"count\":1");
    });

    it("says on the console that the build stopped, and where to change that", async () => {
        const { service, lines } = mount({ run: async () => report([finding("error")]) });

        await service.start(REQUEST);

        // The toast carrying the same sentence is gone in seconds and never archived; this channel
        // is the record, so a refused run has to explain itself here.
        expect(lines.some(line => line.channel === BUILD_CONSOLE_CHANNEL
            && line.level === "error"
            && line.message.includes("lint.build.blocked("))).toBe(true);
        // `info`, not `verbose`: the console hides verbose by default, which is the one place this
        // line must not be.
        expect(lines.some(line => line.channel === BUILD_CONSOLE_CHANNEL
            && line.level === "info"
            && line.message === "lint.build.blockedHint")).toBe(true);
    });

    it("points at the setting when the sweep itself is what stopped the build", async () => {
        const { service, lines } = mount({
            run: async () => {
                throw new Error("context assembly exploded");
            },
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await service.start(REQUEST);

        // Same dead end for the author, so the same way out of it.
        expect(lines.some(line => line.message === "lint.build.blockedHint")).toBe(true);
        consoleError.mockRestore();
    });

    it("stamps startedAt and platforms on the refusal, so the dashboard can archive it", async () => {
        const { service } = mount({ run: async () => report([finding("error")]) });

        const state = await service.start(REQUEST);

        expect(state.status).toBe("error");
        expect(state.startedAt).toBeGreaterThan(0);
        expect(state.finishedAt).toBeGreaterThanOrEqual(state.startedAt ?? 0);
        expect(state.platforms).toEqual(["windows", "web"]);
    });

    it("lets warnings through when the project stops only on errors, and still logs them", async () => {
        const { service, lines } = mount({
            linting: { failBuildOn: "error" },
            run: async () => report([finding("warning"), finding("info", "story/empty-scene")]),
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
        // The build passed; the author still gets the report, on the channel they are looking at.
        expect(lines.some(line => line.channel === BUILD_CONSOLE_CHANNEL
            && line.level === "warning"
            && line.message.includes("story/dead-end"))).toBe(true);
        expect(lines.some(line => line.level === "info" && line.message.includes("story/empty-scene"))).toBe(true);
        // ...and nothing that reads as a refusal. A warning the default threshold lets through must
        // not leave "Build stopped" or the way-out-of-it hint sitting in the log beside it.
        expect(lines.some(line => line.message.includes("lint.build.blocked"))).toBe(false);
    });

    it("refuses on the same warnings once the project stops on warnings", async () => {
        const { service } = mount({
            linting: { failBuildOn: "warning" },
            run: async () => report([finding("warning"), finding("warning", "story/label-duplicate")]),
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.error).toContain("\"count\":2");
    });

    it("never blocks on info, under either threshold", async () => {
        for (const failBuildOn of ["error", "warning"] as const) {
            gameBuild.start.mockClear();
            const { service } = mount({
                linting: { failBuildOn },
                run: async () => report([finding("info", "story/label-unused")]),
            });

            const state = await service.start(REQUEST);

            expect(gameBuild.start).toHaveBeenCalledTimes(1);
            expect(state.status).toBe("done");
        }
    });

    it("builds on a clean report and says so", async () => {
        const { service, lines } = mount({ run: async () => report([]) });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
        expect(lines.some(line => line.level === "success" && line.message.includes("lint.console.finished")))
            .toBe(true);
    });

    it("caps the per-finding lines and says how many it held back", async () => {
        const many = Array.from({ length: 250 }, () => finding("info", "story/label-unused"));
        const { service, lines } = mount({ run: async () => report(many) });

        await service.start(REQUEST);

        expect(lines.filter(line => line.message.includes("lint.console.finding"))).toHaveLength(200);
        expect(lines.some(line => line.message === "+50 more")).toBe(true);
    });

    it("fails the build rather than proceeding when the sweep itself throws", async () => {
        const { service, lines } = mount({
            run: async () => {
                throw new Error("context assembly exploded");
            },
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const state = await service.start(REQUEST);

        // A sweep that crashed did not answer "is this project clean", and an unknown must not be
        // spent as a pass - that would ship the broken build silently.
        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.platforms).toEqual(["windows", "web"]);
        expect(lines.some(line => line.level === "error")).toBe(true);
        consoleError.mockRestore();
    });
});

describe("BuildService invalid-block gate (ruling R4)", () => {
    it("refuses ahead of lint, before the sweep is even asked to run", async () => {
        const { service, run } = mount({
            storyHasInvalidBlock: true,
            run: async () => report([]),
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.error).toContain("build.invalidCommandSummary");
        // The lint sweep is behind it, not around it.
        expect(run).not.toHaveBeenCalled();
    });

    it("still refuses when the project has the lint gate switched off", async () => {
        // The point of R4: `runOnBuild: false` is an author's choice about *lint*, and it must not
        // reach the unconditional check that stops a story the compiler refuses from shipping.
        const { service } = mount({
            storyHasInvalidBlock: true,
            linting: { runOnBuild: false },
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.error).toContain("build.invalidCommandSummary");
    });
});

describe("BuildService network gate", () => {
    /** One Fetch on one event of one blueprint. */
    const DOCUMENT_WITH_FETCH = {
        ownerRecords: { "surface:main": { activeBlueprintId: "bp1", privateBlueprintIds: [] } },
        blueprints: {
            bp1: {
                id: "bp1",
                name: "Title Screen",
                program: {
                    kind: "graph",
                    graphs: {
                        events: { ev1: { graph: { nodes: { n1: { id: "n1", type: "blueprint.network.fetch" } } } } },
                        functions: {},
                        macros: {},
                    },
                },
            },
        },
    };

    it("refuses ahead of lint, before the sweep is even asked to run", async () => {
        const { service, run } = mount({ allowHttp: false, blueprintDocument: DOCUMENT_WITH_FETCH });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.error).toContain("build.networkSummary");
        expect(run).not.toHaveBeenCalled();
    });

    it("still refuses when the project has the lint gate switched off", async () => {
        // The reason this gate exists at all. `network/fetch-disallowed` is an error and would stop
        // the build through the lint gate - but `runOnBuild: false` switches that off, and a graph
        // that provably cannot run must not ship because an author changed a lint preference.
        const { service } = mount({
            allowHttp: false,
            blueprintDocument: DOCUMENT_WITH_FETCH,
            linting: { runOnBuild: false },
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.error).toContain("build.networkSummary");
    });

    it("names the blueprint on the console so the author knows where to look", async () => {
        const { service, lines } = mount({ allowHttp: false, blueprintDocument: DOCUMENT_WITH_FETCH });

        await service.start(REQUEST);

        expect(lines.some(line =>
            line.channel === BUILD_CONSOLE_CHANNEL
            && line.level === "error"
            && line.message.includes("build.networkNodeDisallowed")
            && line.message.includes("Title Screen"))).toBe(true);
    });

    it("builds when the project allows HTTP", async () => {
        const { service } = mount({ allowHttp: true, blueprintDocument: DOCUMENT_WITH_FETCH });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
    });

    it("builds when the project has no network nodes, HTTP off or not", async () => {
        const { service } = mount({ allowHttp: false });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
    });

    it("stamps startedAt and platforms on the refusal, so the dashboard can archive it", async () => {
        const { service } = mount({ allowHttp: false, blueprintDocument: DOCUMENT_WITH_FETCH });

        const state = await service.start(REQUEST);

        expect(state.startedAt).toBeGreaterThan(0);
        expect(state.platforms).toEqual(["windows", "web"]);
    });
});

describe("countBlockingLintFindings", () => {
    const errors = report([finding("error")]);
    const warnings = report([finding("warning"), finding("warning")]);
    const infos = report([finding("info")]);
    const mixed = report([finding("error"), finding("warning"), finding("info")]);

    it("counts errors under either threshold", () => {
        expect(countBlockingLintFindings(errors, "error")).toBe(1);
        expect(countBlockingLintFindings(errors, "warning")).toBe(1);
    });

    it("counts warnings only at the warning threshold", () => {
        expect(countBlockingLintFindings(warnings, "error")).toBe(0);
        expect(countBlockingLintFindings(warnings, "warning")).toBe(2);
    });

    it("never counts info", () => {
        expect(countBlockingLintFindings(infos, "error")).toBe(0);
        expect(countBlockingLintFindings(infos, "warning")).toBe(0);
    });

    it("counts the blocking slice of a mixed report", () => {
        expect(countBlockingLintFindings(mixed, "error")).toBe(1);
        expect(countBlockingLintFindings(mixed, "warning")).toBe(2);
    });

    it("reads entries, not the report's own counts", () => {
        // A report whose header disagrees with its list: the console prints the list, so the number
        // in the refusal has to come from the same place or the two contradict each other.
        const lying: LintReport = { ...report([finding("error")]), counts: { error: 99, warning: 0, info: 0 } };
        expect(countBlockingLintFindings(lying, "error")).toBe(1);
    });
});

/**
 * The console line, and specifically the one thing it must not do: say the finding's subject twice.
 *
 * Asserted by counting occurrences rather than by matching the sentence, because `translate` is
 * mocked to `key(params)` here - the location the formatter chose lands in that JSON beside the
 * message's own params, which is exactly what a duplicate would look like on the real console.
 */
describe("formatLintFinding", () => {
    const occurrences = (line: string, needle: string) => line.split(needle).length - 1;

    /** Severity is irrelevant to this question, so it is not a parameter. */
    function findingAt(
        ruleId: LintRuleId,
        messageKey: LintReportEntry["messageKey"],
        messageParams: LintReportEntry["messageParams"],
        location: LintReportEntry["location"],
    ): LintReportEntry {
        return { ruleId, messageKey, messageParams, location, severity: "warning" };
    }

    it("names an asset once when the message already named it", () => {
        const line = formatLintFinding(findingAt(
            "assets/unused",
            "lint.rule.assetsUnused.message",
            { asset: "dialog.png" },
            { kind: "asset", assetId: "a1", assetName: "dialog.png" },
        ));

        expect(occurrences(line, "dialog.png")).toBe(1);
        // The rule id is the part of the line the sentence cannot carry; it stays either way.
        expect(line).toContain("assets/unused");
    });

    it("keeps the story name a message cannot carry, and drops the scene it repeats", () => {
        // `assets/missing` names its own site inside the sentence, so the scene segment is a repeat
        // and the story segment is not. Judged segment by segment, not all or nothing.
        const line = formatLintFinding(findingAt(
            "assets/missing",
            "lint.rule.assetsMissing.message",
            { location: "At the Station" },
            { kind: "story", storyId: "s1", storyName: "Demo", sceneId: "sc1", sceneName: "At the Station" },
        ));

        expect(occurrences(line, "At the Station")).toBe(1);
        expect(occurrences(line, "Demo")).toBe(1);
    });

    it("names the row the way the scene editor's gutter does", () => {
        const line = formatLintFinding(findingAt(
            "text/overlong",
            "lint.rule.textOverlong.message",
            { width: 168, max: 120 },
            {
                kind: "story",
                storyId: "s1",
                storyName: "Demo",
                sceneId: "sc1",
                sceneName: "At the Station",
                blockId: "b1",
                line: 12,
            },
        ));

        // `path:line`, so two findings of one rule in one scene are told apart in a build log.
        expect(line).toContain("Demo / At the Station:12");
    });

    it("prints the whole location when the message names none of it", () => {
        const line = formatLintFinding(findingAt(
            "text/overlong",
            "lint.rule.textOverlong.message",
            { width: 168, max: 120 },
            { kind: "story", storyId: "s1", storyName: "Demo", sceneId: "sc1", sceneName: "At the Station" },
        ));

        expect(line).toContain("Demo / At the Station");
    });

    it("emits nothing for a project-wide finding, which has no site to name", () => {
        const line = formatLintFinding(findingAt(
            "localization/orphan",
            "lint.rule.localizationOrphan.message",
            { count: 3, locale: "ja" },
            { kind: "project" },
        ));

        expect(line).toContain("\"location\":\"\"");
    });
});

describe("shouldBlockBuild", () => {
    const config = (patch: Partial<LintingConfiguration>): LintingConfiguration => ({
        runOnBuild: true,
        failBuildOn: "error",
        severities: {},
        options: {},
        ...patch,
    });

    it("does not block when the gate is off, whatever the report says", () => {
        expect(shouldBlockBuild(report([finding("error")]), config({ runOnBuild: false }))).toBe(false);
    });

    it("blocks on an error at the error threshold", () => {
        expect(shouldBlockBuild(report([finding("error")]), config({}))).toBe(true);
    });

    it("does not block on a warning at the error threshold", () => {
        expect(shouldBlockBuild(report([finding("warning")]), config({}))).toBe(false);
    });

    it("blocks on a warning at the warning threshold", () => {
        expect(shouldBlockBuild(report([finding("warning")]), config({ failBuildOn: "warning" }))).toBe(true);
    });

    it("does not block on an empty report", () => {
        expect(shouldBlockBuild(report([]), config({ failBuildOn: "warning" }))).toBe(false);
    });
});
