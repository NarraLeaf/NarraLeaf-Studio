import { describe, expect, it, vi } from "vitest";
import { AssetType } from "../assets/assetTypes";
import { buildReferenceIndex, type AssetReference } from "../references/referenceModel";
import { ReferenceService } from "../references/ReferenceService";
import { DEFAULT_LINTING_CONFIGURATION, DEFAULT_NETWORK_CONFIGURATION } from "../../project/configuration";
import { Services, type WorkspaceContext } from "../services";
import { LintService } from "./LintService";

/**
 * `LintService.buildContext()` - and specifically the one wire in it that no rule test could ever
 * have caught.
 *
 * `assetReferences` used to be `getReferencesForAll(assets.map(a => a.id))`. That map's keys are, by
 * construction, a subset of the ids the library *has* - and `assets/missing` exists to find
 * references to ids the library has *lost*. The rule was correct, its own tests passed against
 * hand-built contexts with dangling keys, and on a real project it could not fire. So the assertion
 * here is about the context the service assembles, not about the rule.
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
function mount(options: { assetIds: string[]; references: AssetReference[] }): LintService {
    const assets = Object.fromEntries(
        options.assetIds.map(id => [id, { id, type: AssetType.Image, name: `${id}.png`, ext: "png", meta: {} }]),
    );
    const referenceService = referenceServiceWith(options.references);

    const ctx = {
        project: { resolve: (parts: string[]) => parts.join("/") },
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
                        return { getAssets: () => ({ [AssetType.Image]: assets }) };
                    case Services.Reference:
                        return referenceService;
                    case Services.Character:
                        return { listCharacter: () => [] };
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
});
