import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_APP_TAG } from "@shared/types/appTag";
import type { GameBuildRequest } from "@shared/types/gameBuild";
import type { StoryDocument } from "@shared/types/story";
import type { LintReport } from "@/lib/lint/types";
import type { LintingConfiguration } from "../../project/configuration";
import type { MediaAssetSupportRecord } from "../media/mediaAssetSupport";
import { Services, type WorkspaceContext } from "../services";
import { BUILD_CONSOLE_CHANNEL, BuildService } from "./BuildService";

/**
 * The media gate: a project holding an asset the engine cannot decode does not build.
 *
 * Driven through the real `BuildService.start()` for the reason the lint gate's file states - the
 * claim is not "the arithmetic is right" but that a refused build **never reaches the main
 * process**, so what is asserted is that `gameBuild.start` was not called.
 *
 * The two halves worth reading first are the ordering test (this gate stands ahead of lint and
 * behind the invalid-command gate) and the unavailable test (a host with no converter builds).
 */

const gameBuild = vi.hoisted(() => ({
    start: vi.fn(async () => ({ success: true, data: { state: { status: "done" } } })),
    getStatus: vi.fn(async () => ({ success: false })),
    cancel: vi.fn(),
    preflight: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ gameBuild }),
}));

/** Keys and params, not prose: a copy edit must not fail this file. */
vi.mock("@/lib/i18n", () => ({
    translate: (key: string, params?: Record<string, unknown>) =>
        (params ? `${key}(${JSON.stringify(params)})` : key),
    translateN: (key: string, count: number) => `${key}(${count})`,
}));

const PROJECT_PATH = "D:/projects/demo";

const REQUEST = {
    targets: [{ platform: "windows", formats: ["nsis"] }],
} as unknown as GameBuildRequest;

const CLEAN_STORY = { id: "s1", name: "Main", scenes: {} } as unknown as StoryDocument;

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

function convertible(): MediaAssetSupportRecord {
    return {
        state: "convertible",
        target: { kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" },
        durationUs: 5_000_000,
        lossy: true,
    };
}

function unplayable(): MediaAssetSupportRecord {
    return { state: "unplayable", target: null, durationUs: null, lossy: false };
}

type ConsoleLine = { channel: string; level: string; message: string };

function mount(options: {
    unplayable?: { asset: { id: string; name: string }; record: MediaAssetSupportRecord }[];
    unanswered?: string[];
    scanThrows?: boolean;
    storyHasInvalidBlock?: boolean;
    lintRunOnBuild?: boolean;
} = {}) {
    const lines: ConsoleLine[] = [];
    const lintRun = vi.fn(async (): Promise<LintReport> => ({
        startedAt: 0,
        finishedAt: 1,
        entries: [],
        counts: { error: 0, warning: 0, info: 0 },
        rulesRun: [],
        skipped: [],
    }));
    const linting: LintingConfiguration = {
        runOnBuild: options.lintRunOnBuild ?? true,
        failBuildOn: "error",
        severities: {},
        options: {},
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
    const scan = vi.fn(async () => {
        if (options.scanThrows) {
            throw new Error("the probe bridge exploded");
        }
        return {
            records: new Map(),
            probeAvailable: (options.unanswered ?? []).length === 0,
            unanswered: options.unanswered ?? [],
            finishedAt: 1,
        };
    });
    const media = {
        scan,
        listUnplayable: () => options.unplayable ?? [],
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) },
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Project:
                        return {
                            getLintingConfiguration: () => linting,
                            // This file is about the media gate; a project that allows HTTP keeps
                            // the network gate ahead of it out of the way.
                            getNetworkConfiguration: () => ({
                                allowHttp: true,
                                allowRemoteResource: false,
                                allowRemoteScript: false,
                            }),
                        };
                    case Services.Lint:
                        return { run: lintRun };
                    case Services.Console:
                        return {
                            log: (channel: string, level: string, message: string) => {
                                lines.push({ channel, level, message });
                            },
                            setProgress: () => undefined,
                            getProgress: () => null,
                        };
                    case Services.Story:
                        return story;
                    // Every project has the release variant, so the AppTag gate always resolves a name.
                    case Services.AppTags:
                        return { resolveTag: () => RELEASE_APP_TAG };
                    case Services.MediaSupport:
                        return media;
                    case Services.Character:
                    case Services.UIDocument:
                    case Services.UIGraph:
                        return clean;
                    default:
                        throw new Error(`Unexpected service lookup: ${id}`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new BuildService();
    service.setContext(ctx);
    return { service, lines, scan, lintRun };
}

beforeEach(() => {
    vi.useFakeTimers();
    gameBuild.start.mockClear();
    gameBuild.start.mockResolvedValue({ success: true, data: { state: { status: "done" } } });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("BuildService media gate", () => {
    it("builds when every media asset plays", async () => {
        const { service } = mount();

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
    });

    it("refuses a build holding a file that needs converting, without reaching the main process", async () => {
        const { service, lines } = mount({
            unplayable: [{ asset: { id: "a1", name: "intro.avi" }, record: convertible() }],
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.status).toBe("error");
        expect(state.error).toContain("build.mediaSummary");
        // The file is named on the console, with the thing to do about it.
        expect(lines.some(line => line.channel === BUILD_CONSOLE_CHANNEL
            && line.level === "error"
            && line.message.includes("build.mediaNeedsConverting")
            && line.message.includes("intro.avi"))).toBe(true);
    });

    it("says something different about a file there is no conversion for", async () => {
        const { service, lines } = mount({
            unplayable: [{ asset: { id: "a2", name: "silence.mkv" }, record: unplayable() }],
        });

        await service.start(REQUEST);

        // "Convert it" would be advice the author cannot follow: there is nothing inside to convert.
        expect(lines.some(line => line.message.includes("build.mediaNotPlayable"))).toBe(true);
        expect(lines.some(line => line.message.includes("build.mediaNeedsConverting"))).toBe(false);
    });

    it("stamps startedAt and platforms on the refusal, so the dashboard can archive it", async () => {
        const { service } = mount({
            unplayable: [{ asset: { id: "a1", name: "intro.avi" }, record: convertible() }],
        });

        const state = await service.start(REQUEST);

        expect(state.startedAt).toBeGreaterThan(0);
        expect(state.finishedAt).toBeGreaterThanOrEqual(state.startedAt ?? 0);
        expect(state.platforms).toEqual(["windows"]);
    });

    it("still refuses when the project switched the lint gate off", async () => {
        // The whole reason this sits outside the lint gate: `runOnBuild` is a choice about a sweep
        // of opinions, and a video the engine cannot decode is not an opinion.
        const { service } = mount({
            lintRunOnBuild: false,
            unplayable: [{ asset: { id: "a1", name: "intro.avi" }, record: convertible() }],
        });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).not.toHaveBeenCalled();
        expect(state.error).toContain("build.mediaSummary");
    });

    it("runs behind the invalid-command gate and ahead of the lint sweep", async () => {
        const { service, scan, lintRun } = mount({
            storyHasInvalidBlock: true,
            unplayable: [{ asset: { id: "a1", name: "intro.avi" }, record: convertible() }],
        });

        const state = await service.start(REQUEST);

        // Refused before the probe pass was even asked for: no spawns to answer a question about a
        // build that was already stopping.
        expect(state.error).toContain("build.invalidCommandSummary");
        expect(scan).not.toHaveBeenCalled();
        expect(lintRun).not.toHaveBeenCalled();
    });

    it("stops the build before the lint sweep runs", async () => {
        const { service, lintRun } = mount({
            unplayable: [{ asset: { id: "a1", name: "intro.avi" }, record: convertible() }],
        });

        await service.start(REQUEST);

        expect(lintRun).not.toHaveBeenCalled();
    });

    it("builds on a host with no converter, and says the files went unchecked", async () => {
        // Nothing is wrong with these files. Refusing here would make a machine that merely lacks a
        // tool unable to build a project it builds fine today.
        const { service, lines } = mount({ unanswered: ["a1", "a2"] });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
        expect(lines.some(line => line.level === "info"
            && line.message.includes("build.mediaUnchecked"))).toBe(true);
    });

    it("says nothing about unchecked files when there were none", async () => {
        const { service, lines } = mount();

        await service.start(REQUEST);

        expect(lines.some(line => line.message.includes("build.mediaUnchecked"))).toBe(false);
    });

    it("lets the build through when the check itself throws", async () => {
        // The gate has no off switch by design, so failing closed on its own defect would leave the
        // project unbuildable with nothing the author could do about it.
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { service, lines } = mount({ scanThrows: true });

        const state = await service.start(REQUEST);

        expect(gameBuild.start).toHaveBeenCalledTimes(1);
        expect(state.status).toBe("done");
        expect(lines.some(line => line.level === "warning")).toBe(true);
        consoleError.mockRestore();
    });
});
