import { describe, expect, it } from "vitest";
import { AssetOrderManager } from "./AssetOrderManager";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { AssetsService } from "../../core/AssetsService";
import { AssetType } from "../assetTypes";
import { Services } from "../../services";
import { clearWorkspaceAnomalies, getWorkspaceAnomalies } from "@/lib/workspace/recovery/anomalyLog";

/**
 * What an open does with `assets/assets.metadata.<type>.json` when the file is there and will not
 * parse.
 *
 * The behaviour this pins down is a refusal to write. The record for such a type comes up empty,
 * which is not the same as the project having no assets of it: the file still holds every asset the
 * author ever imported, and the first write of that empty record replaces them with `{}`. One bad
 * read then becomes a permanent loss, because every open after it reads the file that was written.
 *
 * So the shard stays exactly as it was found, a copy of the bytes goes to quarantine as evidence,
 * the failure is reported as an anomaly (which is what raises the recovery offer), and every write
 * to that type is refused for the life of the library. The sibling types are unaffected - a
 * truncated image shard is no reason to stop the author working on audio.
 *
 * A seam test, like `assetCategoryShards.test.ts`: the filesystem is a stub that hands back file
 * text and records what was written.
 */

const IMAGE_SHARD = "assets.metadata.image.json";
const AUDIO_SHARD = "assets.metadata.audio.json";
const AUDIO_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function assetRecord(id: string, type: AssetType): string {
    return `{"id":"${id}","type":"${type}","name":"${id}","hash":"h-${id}","ext":"png","source":"local",`
        + `"meta":{},"tags":[],"description":""}`;
}

function metadataShard(...records: string[]): string {
    return `{${records.map(record => `${JSON.stringify(JSON.parse(record).id)}:${record}`).join(",")}}`;
}

/** Every metadata shard as an empty record, so that only the one under test is interesting. */
function emptyMetadataShards(): Record<string, string> {
    return Object.fromEntries(Object.values(AssetType).map(type => [`assets.metadata.${type}.json`, "{}"]));
}

/**
 * `path suffix → file text`. Anything not listed reads back as absent.
 *
 * `copyFile` and `createDir` are here because quarantine needs them: the point of the whole
 * exercise is that the bytes are preserved somewhere, so a harness that could not model the copy
 * could not tell a shard that was set aside from one that was merely abandoned.
 */
function createHarness(files: Record<string, string> = {}) {
    const writes: { path: string; data: string }[] = [];
    const copies: { from: string; to: string }[] = [];
    const reported: { path: string; quarantinePath: string | null }[] = [];
    const present = { ...files };

    const suffixOf = (path: string): string | undefined =>
        Object.keys(present).find(candidate => path.endsWith(candidate));

    const readText = (path: string): string | undefined => {
        const suffix = suffixOf(path);
        return suffix === undefined ? undefined : present[suffix];
    };

    const record = (path: string, data: string) => {
        writes.push({ path, data });
        present[suffixOf(path) ?? path.split("/").pop()!] = data;
        return { ok: true as const, data: undefined };
    };

    const filesystemService = {
        async ensureRegularFile(path: string, data: string) {
            if (readText(path) === undefined) {
                return record(path, data);
            }
            return { ok: true as const, data: undefined };
        },
        async isFileExists(path: string) {
            return { ok: true as const, data: readText(path) !== undefined };
        },
        async read(path: string) {
            const text = readText(path);
            return text === undefined
                ? { ok: false as const, error: { code: "NOT_FOUND", message: "missing" } }
                : { ok: true as const, data: text };
        },
        async readJSON(path: string) {
            const text = readText(path);
            if (text === undefined) {
                return { ok: false as const, error: { code: "NOT_FOUND", message: "missing" } };
            }
            try {
                return { ok: true as const, data: JSON.parse(text) };
            } catch {
                return { ok: false as const, error: { code: "INVALID_JSON", message: "bad json" } };
            }
        },
        async write(path: string, data: string) {
            return record(path, data);
        },
        async writeFileNoFollow(path: string, data: string) {
            if (readText(path) === undefined) {
                return { ok: false as const, error: { code: "NOT_FOUND", message: `lstat '${path}'` } };
            }
            return record(path, data);
        },
        async writeFileNoFollowOrCreate(path: string, data: string) {
            return record(path, data);
        },
        async createDir() {
            return { ok: true as const, data: undefined };
        },
        async copyFile(from: string, to: string) {
            const text = readText(from);
            if (text === undefined) {
                return { ok: false as const, error: { code: "NOT_FOUND", message: "missing" } };
            }
            copies.push({ from, to });
            return { ok: true as const, data: undefined };
        },
    };

    const context = {
        project: {
            resolve: (segments: string[]) => segments.join("/"),
            getConfig: () => ({ projectPath: "" }),
        },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) {
                    return filesystemService;
                }
                // The channel a story or a character that will not parse already goes out on: one
                // sticky notice naming the file and a line in the Storage console.
                if (serviceId === Services.SaveStatus) {
                    return {
                        reportUnreadableDocument(error: { path: string }, quarantinePath: string | null) {
                            reported.push({ path: error.path, quarantinePath });
                        },
                    };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    };

    const service = new AssetsService();
    service.setContext(context as any);

    return { service, context, writes, copies, present, reported };
}

/** The order `AssetsService.init` brings the metadata and order managers up in. */
async function initAssets(harness: ReturnType<typeof createHarness>) {
    const orderManager = await new AssetOrderManager(harness.context as any).init();
    (harness.service as any).assetOrderManager = orderManager;

    const metadataManager = new AssetsMetadataManager(harness.service, harness.context as any);
    (harness.service as any).assetsMetadataManager = metadataManager;
    (harness.service as any).assetsMetadataInitializing = true;
    try {
        await metadataManager.init();
    } finally {
        (harness.service as any).assetsMetadataInitializing = false;
    }
    await harness.service["flushPendingWrites"]();

    return { metadataManager, orderManager };
}

function wroteTo(writes: { path: string }[], suffix: string): boolean {
    return writes.some(write => write.path.endsWith(suffix));
}

describe("a metadata shard that cannot be read", () => {
    it("leaves the file exactly as it was found", async () => {
        const truncated = '{"a1":{"id":"a1","type":"image","name":"a1"';
        const harness = createHarness({ ...emptyMetadataShards(), [IMAGE_SHARD]: truncated });

        await initAssets(harness);

        expect(wroteTo(harness.writes, IMAGE_SHARD)).toBe(false);
        expect(harness.present[IMAGE_SHARD]).toBe(truncated);
    });

    it("keeps a copy of the bytes as evidence", async () => {
        const harness = createHarness({ ...emptyMetadataShards(), [IMAGE_SHARD]: "{ not json at all" });

        await initAssets(harness);

        const quarantined = harness.copies.filter(copy => copy.from.endsWith(IMAGE_SHARD));
        expect(quarantined).toHaveLength(1);
        // Separators normalised: the copy is given an absolute path, which is native on Windows.
        expect(quarantined[0].to.split("\\").join("/")).toContain(".nlstudio/quarantine/");
    });

    it("reports it, so the workspace can offer recovery", async () => {
        clearWorkspaceAnomalies();
        const harness = createHarness({ ...emptyMetadataShards(), [IMAGE_SHARD]: "{ not json at all" });

        await initAssets(harness);

        const reported = getWorkspaceAnomalies().filter(anomaly => anomaly.source === "assets");
        expect(reported).toHaveLength(1);
        expect(reported[0].severity).toBe("degraded");
        expect(reported[0].path).toContain(IMAGE_SHARD);
        clearWorkspaceAnomalies();
    });

    it("tells the author, through the channel an unreadable document already uses", async () => {
        const harness = createHarness({ ...emptyMetadataShards(), [IMAGE_SHARD]: "{ not json at all" });

        await initAssets(harness);

        expect(harness.reported).toHaveLength(1);
        expect(harness.reported[0].path).toContain(IMAGE_SHARD);
        expect(harness.reported[0].quarantinePath).toContain("quarantine");
    });

    it("refuses every write to that shard, and keeps the debt queued", async () => {
        // The write this exists to stop: the record is empty because the file could not be read,
        // and `{}` written here is the author's library replaced with nothing.
        const harness = createHarness({ ...emptyMetadataShards(), [IMAGE_SHARD]: "{ not json at all" });

        const { metadataManager } = await initAssets(harness);
        expect(metadataManager.isShardUnreadable(AssetType.Image)).toBe(true);

        const refusal = await (harness.service as any).writeAssetsMetadata(AssetType.Image);
        expect(refusal.ok).toBe(false);
        expect(wroteTo(harness.writes, IMAGE_SHARD)).toBe(false);

        // Answered as a failure rather than a success, so the queue keeps the debt: the edit is
        // still unwritten, and an open that can read the shard is what settles it.
        (harness.service as any).dirtyTypes.add(AssetType.Image);
        await harness.service["flushPendingWrites"]();
        expect((harness.service as any).dirtyTypes.has(AssetType.Image)).toBe(true);
    });

    it("leaves the sibling shards writable", async () => {
        const harness = createHarness({
            ...emptyMetadataShards(),
            [IMAGE_SHARD]: "{ not json at all",
            [AUDIO_SHARD]: metadataShard(assetRecord(AUDIO_ONE, AssetType.Audio)),
        });

        const { metadataManager } = await initAssets(harness);

        expect(metadataManager.isShardUnreadable(AssetType.Audio)).toBe(false);
        expect(metadataManager.list(AssetType.Audio)).toEqual([AUDIO_ONE]);

        (harness.service as any).dirtyTypes.add(AssetType.Audio);
        await harness.service["flushPendingWrites"]();

        expect(JSON.parse(harness.present[AUDIO_SHARD])).toHaveProperty(AUDIO_ONE);
        expect(wroteTo(harness.writes, IMAGE_SHARD)).toBe(false);
    });

    it("says which type it was and why, in one line", async () => {
        const harness = createHarness({ ...emptyMetadataShards(), [IMAGE_SHARD]: "{ not json at all" });

        const { metadataManager } = await initAssets(harness);

        const shard = metadataManager.getUnreadableShards().get(AssetType.Image);
        expect(shard?.type).toBe(AssetType.Image);
        expect(shard?.path).toContain(IMAGE_SHARD);
        expect(shard?.reason).toContain("SyntaxError");
        expect(shard?.quarantinePath).toContain(".nlstudio/quarantine/");
    });

    it("does not latch a shard that is simply absent", async () => {
        // Absent is not corrupt, and there are no bytes for a later write to destroy. The shard is
        // created on the way in, so this only happens when that creation was refused.
        const harness = createHarness({});

        const { metadataManager } = await initAssets(harness);

        for (const type of Object.values(AssetType)) {
            expect(metadataManager.isShardUnreadable(type)).toBe(false);
        }
    });
});
