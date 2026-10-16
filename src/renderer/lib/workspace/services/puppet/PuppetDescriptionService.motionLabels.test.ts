// @vitest-environment jsdom -- `probe()` mounts the model into an offscreen node of its own
/**
 * A Live2D model's motions, named by their files beside the description.
 *
 * The runtime answers `Idle_0`, `TapBody_0`; the manifest it loaded says which file each one is.
 * The service reads that manifest - the entry file the mount was given, and only it - and hands the
 * labels on with the description. They are never written to the description cache: the cache is the
 * backend's answer, and the labels are Studio's reading of a file it can read again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetProjectTrustCacheForTests } from "@/lib/workspace/projectTrust";
import { AssetType } from "../assets/assetTypes";
import { Services, type WorkspaceContext } from "../services";
import { PuppetDescriptionService } from "./PuppetDescriptionService";

const trustQuery = vi.fn();
const createPuppetModelSession = vi.fn();
const read = vi.fn();
const write = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ projectTrust: { query: trustQuery } }),
}));

vi.mock("@/lib/ui-editor/widget-modules/registryInstance", () => ({
    ensureWidgetModulesRegistered: vi.fn(async () => undefined),
}));

vi.mock("./projectPuppetRuntimes", () => ({
    createPuppetBackendSource: async () => ({ id: "live2d", url: "app://fs/grant/index.js" }),
    grantModelBundleUrl: async (_root: string, entry: string) => `app://fs/grant/${entry}`,
    readPuppetRuntimeStamp: async () => "1024@1700000000000",
}));

vi.mock("@/lib/ui-editor/runtime/game/puppetModelSession", () => ({
    createPuppetModelSession: (...args: unknown[]) => createPuppetModelSession(...args),
}));

const PROJECT_PATH = "D:/projects/mine";
const MODEL_ID = "55555555-5555-4555-8555-555555555555";
const BUNDLE_ROOT = `${PROJECT_PATH}/assets/content/${MODEL_ID}`;

const MANIFEST = JSON.stringify({
    Version: 3,
    FileReferences: {
        Moc: "Hiyori.moc3",
        Motions: {
            Idle: [{ File: "motions/Hiyori_m01.motion3.json" }, { File: "motions/Idle_01.motion3.json" }],
            TapBody: [{ File: "motions/Hiyori_m04.motion3.json" }],
        },
    },
});

function mount(entry: string): PuppetDescriptionService {
    const context = {
        project: {
            resolve: (...paths: (string | readonly string[])[]) =>
                [PROJECT_PATH, ...paths.flatMap(path => (Array.isArray(path) ? path : [path]))].join("/"),
        },
        services: {
            get: (id: Services) => {
                if (id === Services.Assets) {
                    return {
                        getAssets: () => ({
                            [AssetType.Model]: { [MODEL_ID]: { id: MODEL_ID, name: "Hiyori", hash: "hash-of-hiyori" } },
                        }),
                        modelService: {
                            getBundleRoot: () => BUNDLE_ROOT,
                            listBundle: async () => ({ success: true, data: { files: [entry], totalBytes: 2048 } }),
                            resolveEntry: () => ({ entry }),
                        },
                    };
                }
                if (id === Services.FileSystem) {
                    return {
                        readJSON: async () => ({ ok: false }),
                        read,
                        createDir: async () => undefined,
                        write,
                        deleteFile: async () => undefined,
                    };
                }
                throw new Error(`This test provides no ${String(id)} service`);
            },
        },
    } as unknown as WorkspaceContext;
    const service = new PuppetDescriptionService();
    service.setContext(context);
    return service;
}

const REQUEST = { assetId: MODEL_ID, backend: "live2d", entry: null, options: {}, size: null };

describe("PuppetDescriptionService motion labels", () => {
    beforeEach(() => {
        resetProjectTrustCacheForTests();
        trustQuery.mockReset();
        trustQuery.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        createPuppetModelSession.mockReset();
        createPuppetModelSession.mockResolvedValue({
            describable: true,
            describe: async () => ({ motions: ["Idle_0", "Idle_1", "TapBody_0"], expressions: [], skins: [], params: [] }),
            dispose: () => undefined,
        });
        read.mockReset();
        read.mockResolvedValue({ ok: true, data: MANIFEST });
        write.mockReset();
    });

    it("names each motion its file names, from the manifest the model was mounted from", async () => {
        const service = mount("Hiyori.model3.json");
        const result = await service.describe(REQUEST);

        expect(read).toHaveBeenCalledWith(`${BUNDLE_ROOT}/Hiyori.model3.json`, "utf-8");
        expect(result.status === "ok" && result.description.motions).toEqual(["Idle_0", "Idle_1", "TapBody_0"]);
        // `Idle_1`'s file is the group and a number, so it keeps its name.
        expect(result.status === "ok" && result.description.motionLabels).toEqual({ Idle_0: "Hiyori m01", TapBody_0: "Hiyori m04" });
        // What a render path reads synchronously carries them too.
        expect(service.peek(REQUEST)?.motionLabels).toEqual({ Idle_0: "Hiyori m01", TapBody_0: "Hiyori m04" });
    });

    it("keeps the labels out of the description cache", async () => {
        await mount("Hiyori.model3.json").describe(REQUEST);
        const record = JSON.parse(String(write.mock.calls[0]?.[1]));
        expect(record.description.motions).toEqual(["Idle_0", "Idle_1", "TapBody_0"]);
        expect(record.description).not.toHaveProperty("motionLabels");
    });

    it("reads no manifest for a model that is not Cubism 3, and describes it as before", async () => {
        const result = await mount("skeleton.json").describe(REQUEST);
        expect(read).not.toHaveBeenCalled();
        expect(result.status === "ok" && result.description).not.toHaveProperty("motionLabels");
    });

    it("describes the model as before when its manifest cannot be read", async () => {
        read.mockResolvedValue({ ok: true, data: "{ not json" });
        const result = await mount("Hiyori.model3.json").describe(REQUEST);
        expect(result.status === "ok" && result.description.motions).toEqual(["Idle_0", "Idle_1", "TapBody_0"]);
        expect(result.status === "ok" && result.description).not.toHaveProperty("motionLabels");
    });
});
