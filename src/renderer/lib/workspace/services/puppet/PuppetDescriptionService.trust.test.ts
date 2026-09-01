// @vitest-environment jsdom -- `probe()` mounts the model into an offscreen node of its own
/**
 * What the description path tells the author when the project is not trusted.
 *
 * The claim under test is about the *reason*, not about the failure. Every unavailable reason
 * selects a different sentence under the motion/expression/skin dropdowns, and the sentences say
 * different things to do: `distrusted` sends the author to Settings, `failed` sends them to their
 * model file. Reporting the second when the first is true is the expensive mistake — the author
 * spends the afternoon re-exporting an asset that was never broken — so these cases assert the
 * reason and never merely that `status` is `"unavailable"`.
 *
 * The mount is mocked at `./projectPuppetRuntimes` rather than at the trust query, because that is
 * where the two halves of the fix meet: `plan()` refuses up front so no mount is set up at all, and
 * the catch arm in `probe()` still has to carry a typed refusal through if one reaches it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetProjectTrustCacheForTests } from "@/lib/workspace/projectTrust";
import { SurfacePuppetUnavailableError } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import { AssetType } from "../assets/assetTypes";
import { Services, type WorkspaceContext } from "../services";
import { PuppetDescriptionService } from "./PuppetDescriptionService";

const trustQuery = vi.fn();
const createPuppetBackendSource = vi.fn();
const grantModelBundleUrl = vi.fn();
const readPuppetRuntimeStamp = vi.fn();
const createPuppetModelSession = vi.fn();
const listBundle = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ projectTrust: { query: trustQuery } }),
}));

// `Service` pulls the widget registry in at module scope; nothing here initializes a workspace.
vi.mock("@/lib/ui-editor/widget-modules/registryInstance", () => ({
    ensureWidgetModulesRegistered: vi.fn(async () => undefined),
}));

vi.mock("./projectPuppetRuntimes", () => ({
    createPuppetBackendSource: (...args: unknown[]) => createPuppetBackendSource(...args),
    grantModelBundleUrl: (...args: unknown[]) => grantModelBundleUrl(...args),
    readPuppetRuntimeStamp: (...args: unknown[]) => readPuppetRuntimeStamp(...args),
}));

vi.mock("@/lib/ui-editor/runtime/game/puppetModelSession", () => ({
    createPuppetModelSession: (...args: unknown[]) => createPuppetModelSession(...args),
}));

const PROJECT_PATH = "D:/projects/theirs";
const MODEL_ID = "44444444-4444-4444-8444-444444444444";

const REQUEST = { assetId: MODEL_ID, backend: "live2d", entry: null, options: {}, size: null };

/**
 * A service holding a project with one model bundle and one installed runtime.
 *
 * Everything the mount itself would touch is a mock, so a case decides what the backend does by
 * setting one return value. The filesystem service answers "no cache file", which keeps every
 * assertion about the live lookup rather than about what a previous one remembered.
 */
function mount(): PuppetDescriptionService {
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
                            [AssetType.Model]: {
                                [MODEL_ID]: { id: MODEL_ID, name: "heroine", hash: "hash-of-heroine" },
                            },
                        }),
                        modelService: {
                            getBundleRoot: (assetId: string) => `${PROJECT_PATH}/assets/models/${assetId}`,
                            listBundle,
                            resolveEntry: () => ({ entry: "heroine.model3.json" }),
                        },
                    };
                }
                if (id === Services.FileSystem) {
                    return {
                        readJSON: async () => ({ ok: false }),
                        createDir: async () => undefined,
                        write: async () => undefined,
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

describe("PuppetDescriptionService trust", () => {
    beforeEach(() => {
        resetProjectTrustCacheForTests();
        trustQuery.mockReset();
        createPuppetBackendSource.mockReset();
        grantModelBundleUrl.mockReset();
        readPuppetRuntimeStamp.mockReset();
        createPuppetModelSession.mockReset();
        listBundle.mockReset();

        listBundle.mockResolvedValue({ success: true, data: { files: ["heroine.model3.json"], totalBytes: 2048 } });
        readPuppetRuntimeStamp.mockResolvedValue("1024@1700000000000");
        grantModelBundleUrl.mockResolvedValue("app://fs/grant/heroine.model3.json");
        createPuppetBackendSource.mockResolvedValue({ id: "live2d", url: "app://fs/grant/index.js" });
        createPuppetModelSession.mockResolvedValue({
            describable: true,
            describe: async () => ({ motions: ["idle"], expressions: [], skins: [], params: [] }),
            dispose: () => undefined,
        });
    });

    it("reports a distrusted project as distrusted, not as a broken model", async () => {
        trustQuery.mockResolvedValue({ success: true, data: { trusted: false, record: null } });

        const result = await mount().describe(REQUEST);

        // The whole defect in one assertion. `failed` reads as "The model could not be read" and
        // offers a Refresh button that can never succeed; `distrusted` names the one thing the
        // author can actually do about it.
        expect(result).toMatchObject({ status: "unavailable", reason: "distrusted" });
        expect(trustQuery).toHaveBeenCalledWith(PROJECT_PATH);
    });

    it("does not walk the bundle or mint a grant for a distrusted project", async () => {
        trustQuery.mockResolvedValue({ success: true, data: { trusted: false, record: null } });

        await mount().describe(REQUEST);

        // Asking trust up front is not only about the message. None of this work is memoized when
        // it cannot produce an answer, and `allocateHash` does not dedup by path - so a scene
        // editor that describes every puppet character on mount would repeat the walk and leak a
        // window-lifetime directory grant per attempt.
        expect(listBundle).not.toHaveBeenCalled();
        expect(grantModelBundleUrl).not.toHaveBeenCalled();
        expect(createPuppetBackendSource).not.toHaveBeenCalled();
    });

    it("carries a typed unavailability out of the mount instead of flattening it", async () => {
        // The catch arm on its own, reached the only way it now can be: trust answers yes, and the
        // refusal comes from the choke point in `createPuppetBackendSource` regardless. That arm is
        // what was wrong, and a second producer of this error would land in it the same way.
        trustQuery.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        createPuppetBackendSource.mockRejectedValue(new SurfacePuppetUnavailableError("distrusted"));

        const result = await mount().describe(REQUEST);

        expect(result).toMatchObject({ status: "unavailable", reason: "distrusted" });
    });

    it("still reports a runtime that actually misbehaved as a failure", async () => {
        // The other direction, and the one that must not regress: a model that is genuinely
        // unreadable has to keep saying so, or the author is sent to Settings over a broken file.
        trustQuery.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        createPuppetModelSession.mockRejectedValue(new Error("Unexpected end of JSON input"));

        const result = await mount().describe(REQUEST);

        expect(result).toMatchObject({
            status: "unavailable",
            reason: "failed",
            message: "Unexpected end of JSON input",
        });
    });

    it("describes normally for a project the author vouched for", async () => {
        trustQuery.mockResolvedValue({ success: true, data: { trusted: true, record: null } });

        const result = await mount().describe(REQUEST);

        expect(result).toMatchObject({ status: "ok", origin: "live" });
        expect(result.status === "ok" && result.description.motions).toEqual(["idle"]);
    });
});
