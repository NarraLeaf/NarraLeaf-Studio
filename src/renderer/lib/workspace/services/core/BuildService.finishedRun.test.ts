import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_APP_TAG } from "@shared/types/appTag";
import type { GameBuildRequest, GamePatchExportRequest } from "@shared/types/gameBuild";
import type { StoryDocument } from "@shared/types/story";
import type { LintReport } from "@/lib/lint/types";
import type { LintingConfiguration } from "../../project/configuration";
import { Services, type WorkspaceContext } from "../services";
import { BuildService } from "./BuildService";

/**
 * What the service remembers about a run once it has ended.
 *
 * The build report and the notification both read `getLastFinishedRun()`, and three of its answers
 * are load-bearing: a run is recorded once however many times the poll repeats the same snapshot, a
 * run the author stopped is marked as stopped rather than reported as a failure, and a run this
 * workspace never started is not recorded at all.
 */

const gameBuild = vi.hoisted(() => ({
    start: vi.fn(async () => ({ success: true, data: { state: { status: "done" } } })),
    getStatus: vi.fn(async () => ({ success: false })),
    cancel: vi.fn(async () => ({ success: true, data: { state: { status: "error", error: "Build cancelled" } } })),
    exportPatch: vi.fn(async () => ({ success: true, data: { state: { status: "done" } } })),
    preflight: vi.fn(),
}));

const plugins = vi.hoisted(() => ({
    list: vi.fn(async () => ({ success: true, data: { plugins: [] } })),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ gameBuild, plugins }),
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
    appTagId: "tag-demo",
} as unknown as GameBuildRequest;

const PATCH_REQUEST = {
    contentAppTagId: "tag-demo",
    outputFile: "D:/projects/demo/dist/demo.nlpatch",
} as unknown as GamePatchExportRequest;

const CLEAN_STORY = { id: "s1", name: "Main", scenes: {} } as unknown as StoryDocument;

function mount() {
    const linting: LintingConfiguration = {
        runOnBuild: false,
        failBuildOn: "error",
        severities: {},
        options: {},
    };
    const lintRun = vi.fn(async (): Promise<LintReport> => ({
        startedAt: 0,
        finishedAt: 1,
        entries: [],
        counts: { error: 0, warning: 0, info: 0 },
        rulesRun: [],
        skipped: [],
    }));

    const clean = {
        isDirty: () => false,
        save: async () => undefined,
        getDocument: () => ({}),
        flushPendingChanges: async () => undefined,
    };
    const story = {
        ...clean,
        getLibraryIndex: () => ({ stories: [{ id: "s1", name: "Main" }] }),
        loadStory: async () => CLEAN_STORY,
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
                                allowHttp: true,
                                allowRemoteResource: false,
                                allowRemoteScript: false,
                            }),
                            getBuildConfiguration: () => ({ platforms: ["windows"] }),
                        };
                    case Services.Lint:
                        return { run: lintRun };
                    case Services.Console:
                        return {
                            log: () => undefined,
                            setProgress: () => undefined,
                            getProgress: () => null,
                        };
                    case Services.Story:
                        return story;
                    case Services.Assets:
                        return { listSharedBlueprints: async () => [] };
                    case Services.AppTags:
                        return { resolveTag: () => RELEASE_APP_TAG, getDocument: () => ({ tags: [] }) };
                    case Services.MediaSupport:
                        return {
                            scan: async () => ({
                                records: new Map(),
                                probeAvailable: true,
                                unanswered: [],
                                finishedAt: 1,
                            }),
                            listUnplayable: () => [],
                        };
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
    return { service };
}

beforeEach(() => {
    vi.useFakeTimers();
    gameBuild.start.mockClear();
    gameBuild.start.mockResolvedValue({ success: true, data: { state: { status: "done" } } });
    gameBuild.exportPatch.mockClear();
    gameBuild.exportPatch.mockResolvedValue({ success: true, data: { state: { status: "done" } } });
    gameBuild.getStatus.mockReset();
    gameBuild.getStatus.mockResolvedValue({ success: false } as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("BuildService.getLastFinishedRun", () => {
    it("has nothing to report before a run has ended", () => {
        const { service } = mount();
        expect(service.getLastFinishedRun()).toBeNull();
    });

    it("records the finished build with the variant it was requested under", async () => {
        const { service } = mount();

        await service.start(REQUEST);

        const run = service.getLastFinishedRun();
        expect(run?.kind).toBe("build");
        expect(run?.appTagId).toBe("tag-demo");
        expect(run?.cancelled).toBe(false);
        expect(run?.state.status).toBe("done");
    });

    it("records a run once, however many times the poll repeats its snapshot", async () => {
        const { service } = mount();

        await service.start(REQUEST);
        const first = service.getLastFinishedRun();

        gameBuild.getStatus.mockResolvedValue({ success: true, data: { state: { status: "done" } } } as never);
        await service.refreshState();
        await service.refreshState();

        expect(service.getLastFinishedRun()?.id).toBe(first?.id);
    });

    it("marks a run the author stopped, which the pipeline reports as a failure", async () => {
        const { service } = mount();
        gameBuild.start.mockResolvedValue({ success: true, data: { state: { status: "packaging" } } } as never);

        await service.start(REQUEST);
        await service.cancel();

        const run = service.getLastFinishedRun();
        expect(run?.state.status).toBe("error");
        expect(run?.cancelled).toBe(true);
    });

    it("does not record a run this workspace never started", async () => {
        const { service } = mount();
        gameBuild.getStatus.mockResolvedValue({ success: true, data: { state: { status: "done" } } } as never);

        await service.refreshState();

        expect(service.getLastFinishedRun()).toBeNull();
    });

    it("records a patch export as a patch, under the variant its content carries", async () => {
        const { service } = mount();

        await service.exportPatch(PATCH_REQUEST);

        const run = service.getLastFinishedRun();
        expect(run?.kind).toBe("patch");
        expect(run?.appTagId).toBe("tag-demo");
        expect(run?.state.status).toBe("done");
    });

    it("stops treating the previous cancel as this run's", async () => {
        const { service } = mount();
        gameBuild.start.mockResolvedValue({ success: true, data: { state: { status: "packaging" } } } as never);
        await service.start(REQUEST);
        await service.cancel();

        gameBuild.start.mockResolvedValue({ success: true, data: { state: { status: "done" } } } as never);
        await service.start(REQUEST);

        expect(service.getLastFinishedRun()?.cancelled).toBe(false);
    });
});
