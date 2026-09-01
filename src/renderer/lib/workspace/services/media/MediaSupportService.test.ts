import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaSupportVerdict } from "@shared/utils/mediaSupport";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { resetProjectTrustCacheForTests } from "@/lib/workspace/projectTrust";
import { AssetType } from "../assets/assetTypes";
import { AssetSource, type Asset } from "../assets/types";
import { Services, type WorkspaceContext } from "../services";
import { MediaSupportService } from "./MediaSupportService";

/**
 * What the library scan does and does not send, with trust as the axis.
 *
 * The claim under test is about calls, not about the answer shape: a distrusted project must not
 * put a single `ffprobe` request on the wire, because main refuses each one with a console error
 * and the asset browser scans the whole library on mount. Asserting only on `records` and
 * `unanswered` would pass just as happily against two hundred refused round trips, so every case
 * here reads the spy.
 *
 * The image asset in the fixture is the other half of the claim. Distrust governs execution, and
 * an image verdict is decided from the file's name inside the renderer with no process involved -
 * so it must keep answering, or opening somebody else's project would blank the panel.
 */

const probeMedia = vi.fn();
const trustQuery = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ probeMedia, projectTrust: { query: trustQuery } }),
}));

// `Service` pulls the widget registry in at module scope; nothing here initializes a workspace.
vi.mock("@/lib/ui-editor/widget-modules/registryInstance", () => ({
    ensureWidgetModulesRegistered: vi.fn(async () => undefined),
}));

const PROJECT_PATH = "D:/projects/theirs";

function asset(patch: Partial<Asset> & { id: string; type: AssetType; name: string }): Asset {
    return {
        hash: `hash-of-${patch.id}`,
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
        ...patch,
    } as Asset;
}

// Real UUIDs, because the content shard a probe is aimed at is arithmetic on the id and rejects
// anything that is not one.
/** A `.tif` is the image case: no browser decodes it, and the name alone settles that. */
const SCAN = asset({ id: "11111111-1111-4111-8111-111111111111", type: AssetType.Image, name: "backdrop.tif" });
const VOICE = asset({ id: "22222222-2222-4222-8222-222222222222", type: AssetType.Audio, name: "take-001.wav" });
const CLIP = asset({ id: "33333333-3333-4333-8333-333333333333", type: AssetType.Video, name: "intro.mp4" });

const LIBRARY = [SCAN, VOICE, CLIP];

function shardPath(assetId: string): string {
    return [PROJECT_PATH, ...ProjectNameConvention.AssetsDataShard(assetId)].join("/");
}

function playableVerdict(): MediaSupportVerdict {
    return {
        tier: "accept",
        reason: "playable",
        container: { names: ["mp4"], demuxable: true, knownUnsupported: false },
        streams: [],
        unsupportedCodecs: [],
        target: null,
    };
}

/**
 * A service holding a context with an asset library and nothing else.
 *
 * No filesystem service, deliberately: the cache is then empty and never written, which keeps
 * every assertion below about what was asked rather than about what was remembered.
 */
function mount(): MediaSupportService {
    const context = {
        project: {
            resolve: (...paths: (string | readonly string[])[]) =>
                [PROJECT_PATH, ...paths.flatMap(path => (Array.isArray(path) ? path : [path]))].join("/"),
        },
        services: {
            get: (id: Services) => {
                if (id === Services.Assets) {
                    return { getOrderedAssets: (type: AssetType) => LIBRARY.filter(item => item.type === type) };
                }
                throw new Error(`This test provides no ${String(id)} service`);
            },
        },
    } as unknown as WorkspaceContext;

    const service = new MediaSupportService();
    service.setContext(context);
    return service;
}

describe("MediaSupportService trust", () => {
    beforeEach(() => {
        resetProjectTrustCacheForTests();
        probeMedia.mockReset();
        probeMedia.mockResolvedValue({
            success: true,
            data: { outcome: { status: "probed", verdict: playableVerdict(), durationUs: 1_000, carriesAlpha: false } },
        });
        trustQuery.mockReset();
    });

    it("sends no probe at all for a distrusted project", async () => {
        trustQuery.mockResolvedValue({ success: true, data: { trusted: false, record: null } });

        const scan = await mount().scan();

        expect(probeMedia).not.toHaveBeenCalled();
        expect(trustQuery).toHaveBeenCalledWith(PROJECT_PATH);
        // Not knowing is not a verdict: the sound and the video carry no record, and the flag says
        // why, so the build gate lets a build through rather than refusing files nobody checked.
        expect(scan.probeAvailable).toBe(false);
        expect([...scan.records.keys()]).toEqual([SCAN.id]);
        expect(scan.unanswered).toEqual([VOICE.id, CLIP.id]);
    });

    it("still answers about images for a distrusted project", async () => {
        trustQuery.mockResolvedValue({ success: true, data: { trusted: false, record: null } });

        const scan = await mount().scan();

        // The panel is not blanked: the one asset whose answer needs no process still has one, and
        // it is the same answer a trusted project would get.
        expect(scan.records.get(SCAN.id)).toMatchObject({ state: "convertible", lossy: false });
        expect(scan.records.get(SCAN.id)?.target).not.toBeNull();
    });

    it("probes every uncached clip for a trusted project", async () => {
        trustQuery.mockResolvedValue({ success: true, data: { trusted: true, record: null } });

        const scan = await mount().scan();

        expect(probeMedia).toHaveBeenCalledTimes(2);
        // Addressed by asset id, which is what names the content shard.
        expect(probeMedia.mock.calls.map(([path]) => path as string))
            .toEqual([shardPath(VOICE.id), shardPath(CLIP.id)]);
        expect(scan.probeAvailable).toBe(true);
        expect(scan.unanswered).toEqual([]);
        expect(scan.records.get(VOICE.id)).toMatchObject({ state: "playable" });
        expect(scan.records.get(CLIP.id)).toMatchObject({ state: "playable" });
    });

    it("sends no probe when the trust question itself fails", async () => {
        // Fails closed, for the reason `isProjectTrusted` does: absence of an answer is not evidence
        // that this project may spawn anything, and a scan that guessed wrong would spend the whole
        // library on refusals to find out.
        trustQuery.mockRejectedValue(new Error("no ipc"));

        const scan = await mount().scan();

        expect(probeMedia).not.toHaveBeenCalled();
        expect(scan.probeAvailable).toBe(false);
        expect(scan.unanswered).toEqual([VOICE.id, CLIP.id]);
    });
});
