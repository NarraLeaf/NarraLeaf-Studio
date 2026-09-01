import { beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_APP_TAG } from "@shared/types/appTag";
import { AssetType } from "../assets/assetTypes";
import { buildReferenceIndex, type AssetReference } from "../references/referenceModel";
import { ReferenceService } from "../references/ReferenceService";
import { DEFAULT_LINTING_CONFIGURATION, DEFAULT_NETWORK_CONFIGURATION } from "../../project/configuration";
import { Services, type WorkspaceContext } from "../services";
import { resetProjectTrustCacheForTests } from "../../projectTrust";
import { LintService } from "./LintService";

/** What main would answer about this project, and the spawn a video probe would cost. */
const bridge = vi.hoisted(() => ({
    trusted: true,
    probeMedia: vi.fn(async () => ({ success: true, data: { outcome: { status: "probed", carriesAlpha: true } } })),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        projectTrust: {
            query: async () => ({ success: true, data: { trusted: bridge.trusted, record: null } }),
        },
        probeMedia: bridge.probeMedia,
    }),
}));

/**
 * `LintService.buildContext()` - and specifically the one wire in it that no rule test could ever
 * have caught.
 *
 * `assetReferences` used to be `getReferencesForAll(assets.map(a => a.id))`. That map's keys are, by
 * construction, a subset of the ids the library *has* - and `assets/missing` exists to find
 * references to ids the library has *lost*. The rule was correct, its own tests passed against
 * hand-built contexts with dangling keys, and on a real project it could not fire. So the assertion
 * here is about the context the service assembles, not about the rule.
 *
 * The second half of the file is about the other thing only the service can decide: whether the
 * `io` it hands the rules will send an ffprobe spawn per video clip at a main process that refuses
 * every one of them on the console. No rule test could catch that either - a rule sees an answer
 * or no answer, and both look the same from inside it.
 */

const DANGLING: AssetReference = {
    id: "story:s1:sc1:b1:background.assetId",
    assetId: "gone",
    kind: "story",
    label: "Kitchen",
    detail: "Chapter 1 › Kitchen",
    field: "background.assetId",
};

const LIVE: AssetReference = { ...DANGLING, id: "story:s1:sc1:b2:background.assetId", assetId: "present" };

/** A shard-addressable id: content files are addressed by UUID, and the resolver rejects anything else. */
const CLIP_ID = "11111111-2222-4333-8444-555555555555";

/**
 * A real `ReferenceService` with a seeded index.
 *
 * `getIndex()` builds from six private slices only a live workspace can fill, and returns the cache
 * when one is already there - so seeding the cache is what lets the REAL `getReferencedAssetIds` and
 * `getReferencesForAll` bodies run in a unit test. Stand-ins for those two would have tested a copy
 * of the thing the defect was in.
 */
function referenceServiceWith(references: AssetReference[]): ReferenceService {
    const service = new ReferenceService();
    (service as unknown as { indexCache: Map<string, AssetReference[]> }).indexCache =
        buildReferenceIndex(references);
    vi.spyOn(service, "ensureReady").mockResolvedValue(undefined);
    return service;
}

/** A LintService wired to fakes for every service `buildContext()` reaches. */
function mount(options: {
    assetIds: string[];
    references: AssetReference[];
    /** Video rows in the library, which are the only ones `probeVideoAlpha` will look at. */
    videoAssetIds?: string[];
}): LintService {
    const assets = Object.fromEntries(
        options.assetIds.map(id => [id, { id, type: AssetType.Image, name: `${id}.png`, ext: "png", meta: {} }]),
    );
    const videos = Object.fromEntries(
        (options.videoAssetIds ?? []).map(id =>
            [id, { id, type: AssetType.Video, name: `${id}.webm`, ext: "webm", meta: {} }]),
    );
    const referenceService = referenceServiceWith(options.references);

    const ctx = {
        // Variadic, like the real one: `buildContext()` calls it with no arguments to name the
        // project root, and with a path to name a file under it.
        project: { resolve: (...parts: string[]) => parts.join("/") },
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Project:
                        return {
                            getLintingConfiguration: () => ({ ...DEFAULT_LINTING_CONFIGURATION }),
                            getNetworkConfiguration: () => ({ ...DEFAULT_NETWORK_CONFIGURATION }),
                            getProjectConfig: () => ({}),
                        };
                    case Services.Story:
                        return { getLibraryIndex: () => ({ stories: [] }) };
                    case Services.Assets:
                        return { getAssets: () => ({ [AssetType.Image]: assets, [AssetType.Video]: videos }) };
                    case Services.Reference:
                        return referenceService;
                    case Services.Character:
                        return { listCharacter: () => [] };
                    // `listTags` synthesizes the release variant, so this list is never empty.
                    case Services.AppTags:
                        return { listTags: () => [RELEASE_APP_TAG], listDeclaredExternalLinks: () => [] };
                    // Absent-is-empty by construction, so a project that ships none answers a list.
                    case Services.Dlc:
                        return { list: () => [] };
                    case Services.VariableRegistry:
                        return { listEntries: () => [], listEntriesInScope: () => [] };
                    case Services.Localization:
                        return { getConfiguration: () => ({ sourceLocale: "en", locales: [] }) };
                    case Services.Voice:
                        return { getConfiguration: () => ({ voicedLocales: [] }) };
                    case Services.UIDocument:
                        return { getDocument: () => null };
                    case Services.UIGraph:
                        return { getDocument: () => ({ blueprintDocument: null }) };
                    default:
                        throw new Error(`Unexpected service lookup: ${String(id)}`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new LintService();
    service.setContext(ctx);
    return service;
}

beforeEach(() => {
    // Trust is memoized per project path for the life of the window, so one case's answer would
    // otherwise be every later case's answer.
    resetProjectTrustCacheForTests();
    bridge.trusted = true;
    bridge.probeMedia.mockClear();
});

describe("LintService.buildContext", () => {
    it("keys assetReferences by the referenced ids, so a dangling one reaches the rules", async () => {
        const service = mount({ assetIds: ["present"], references: [DANGLING, LIVE] });

        const ctx = await service.buildContext();

        expect([...ctx.assetReferences.keys()].sort()).toEqual(["gone", "present"]);
        expect(ctx.assetReferences.get("gone")).toEqual([DANGLING]);
        expect(ctx.referencedAssetIds.has("gone")).toBe(true);
    });

    it("leaves an unreferenced library row out of the map entirely", async () => {
        const service = mount({ assetIds: ["present", "unused"], references: [LIVE] });

        const ctx = await service.buildContext();

        expect([...ctx.assetReferences.keys()]).toEqual(["present"]);
        expect(ctx.referencedAssetIds.has("unused")).toBe(false);
        // The library row is still there for `assets/unused` to find; only the reference map is narrow.
        expect(ctx.assets.map(asset => asset.id).sort()).toEqual(["present", "unused"]);
    });

    it("probes a video clip when the project is trusted", async () => {
        const service = mount({ assetIds: [], references: [], videoAssetIds: [CLIP_ID] });

        const ctx = await service.buildContext();
        const probe = await ctx.io.probeVideoAlpha(CLIP_ID);

        expect(bridge.probeMedia).toHaveBeenCalledTimes(1);
        expect(probe).toEqual({ ok: true, carriesAlpha: true });
    });

    it("sends no probe at all for a project that is not trusted", async () => {
        // Main refuses every spawn from a distrusted project and writes an error line to the
        // workspace console for each refusal. `portability/vfx-alpha` asks about every distinct clip
        // a `/vfx create` row uses, so one sweep would fill the console with refusals the author did
        // not ask for. The answer is asked of main once instead, before the sweep.
        bridge.trusted = false;
        const service = mount({ assetIds: [], references: [], videoAssetIds: [CLIP_ID] });

        const ctx = await service.buildContext();
        const probe = await ctx.io.probeVideoAlpha(CLIP_ID);

        expect(bridge.probeMedia).not.toHaveBeenCalled();
        // Not a verdict: the rule reads every `ok: false` as "nothing was learned about this clip",
        // so it reports neither a finding nor a false clean bill.
        expect(probe.ok).toBe(false);
    });
});
