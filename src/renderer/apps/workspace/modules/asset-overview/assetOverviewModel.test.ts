import { describe, expect, it } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { buildAssetOverview, byteShare, formatByteSize } from "./assetOverviewModel";

function asset(id: string, name: string, type: AssetType = AssetType.Image): Asset {
    return {
        id,
        name,
        type,
        hash: `hash-${id}`,
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
    } as Asset;
}

function overview(options: {
    assets: Asset[];
    bytes?: Record<string, number>;
    references?: Record<string, number>;
    directoryBytes?: number;
    directoryFileCount?: number;
    topCount?: number;
}) {
    return buildAssetOverview({
        assets: options.assets,
        bytesByAssetId: new Map(Object.entries(options.bytes ?? {})),
        referenceCountByAssetId: new Map(Object.entries(options.references ?? {})),
        directoryBytes: options.directoryBytes ?? 0,
        directoryFileCount: options.directoryFileCount ?? 0,
        topCount: options.topCount ?? 10,
    });
}

describe("buildAssetOverview", () => {
    it("splits the library into the referenced set and its complement", () => {
        const summary = overview({
            assets: [asset("a", "Used"), asset("b", "Loose"), asset("c", "Also loose")],
            bytes: { a: 100, b: 20, c: 5 },
            references: { a: 3 },
        });

        expect(summary.total).toEqual({ count: 3, bytes: 125 });
        expect(summary.referenced).toEqual({ count: 1, bytes: 100 });
        expect(summary.orphan).toEqual({ count: 2, bytes: 25 });
        expect(summary.entries.find(entry => entry.asset.id === "a")).toMatchObject({
            referenced: true,
            referenceCount: 3,
        });
    });

    it("reports an asset with no local file as unknown bytes rather than zero", () => {
        const summary = overview({ assets: [asset("a", "Remote")], references: { a: 1 } });

        expect(summary.entries[0].bytes).toBeNull();
        expect(summary.total.bytes).toBe(0);
        expect(formatByteSize(summary.entries[0].bytes)).toBe("—");
    });

    it("aggregates count and bytes per type, dropping types with nothing in them", () => {
        const summary = overview({
            assets: [
                asset("a", "One", AssetType.Image),
                asset("b", "Two", AssetType.Image),
                asset("c", "Three", AssetType.Audio),
            ],
            bytes: { a: 10, b: 30, c: 7 },
            references: { a: 1 },
        });

        expect(summary.byType).toEqual([
            { type: AssetType.Image, count: 2, bytes: 40, referencedCount: 1, referencedBytes: 10 },
            { type: AssetType.Audio, count: 1, bytes: 7, referencedCount: 0, referencedBytes: 0 },
        ]);
    });

    it("orders the largest list by size and breaks ties on name", () => {
        const summary = overview({
            assets: [asset("a", "Bravo"), asset("b", "Alpha"), asset("c", "Huge")],
            bytes: { a: 10, b: 10, c: 99 },
            topCount: 2,
        });

        expect(summary.largest.map(entry => entry.asset.name)).toEqual(["Huge", "Alpha"]);
    });

    it("predicts the reachable bytes against the real directory total", () => {
        const summary = overview({
            assets: [asset("a", "Used"), asset("b", "Loose")],
            bytes: { a: 100, b: 40 },
            references: { a: 1 },
            // Larger than the two content files together: metadata and any stale content the
            // records no longer claim still ship today, and land in the difference.
            directoryBytes: 200,
            directoryFileCount: 5,
        });

        expect(summary.packaging).toEqual({
            actualBytes: 200,
            reachableBytes: 100,
            differenceBytes: 100,
            fileCount: 5,
        });
    });

    it("never reports a negative saving when the directory reads smaller than the reachable set", () => {
        const summary = overview({
            assets: [asset("a", "Used")],
            bytes: { a: 100 },
            references: { a: 1 },
            directoryBytes: 10,
        });

        expect(summary.packaging.differenceBytes).toBe(0);
    });

    it("reports an empty library without dividing by anything", () => {
        const summary = overview({ assets: [] });

        expect(summary.total).toEqual({ count: 0, bytes: 0 });
        expect(summary.byType).toEqual([]);
        expect(summary.largest).toEqual([]);
        expect(summary.packaging.differenceBytes).toBe(0);
    });
});

describe("formatByteSize", () => {
    it("keeps whole bytes whole and scales everything else", () => {
        expect(formatByteSize(0)).toBe("0 B");
        expect(formatByteSize(512)).toBe("512 B");
        expect(formatByteSize(1024)).toBe("1.0 KB");
        expect(formatByteSize(1536)).toBe("1.5 KB");
        expect(formatByteSize(1024 ** 3)).toBe("1.0 GB");
    });

    it("distinguishes unknown from empty", () => {
        expect(formatByteSize(null)).toBe("—");
        expect(formatByteSize(0)).toBe("0 B");
    });
});

describe("byteShare", () => {
    it("is a clamped percentage, and zero when there is no total", () => {
        expect(byteShare(25, 100)).toBe(25);
        expect(byteShare(200, 100)).toBe(100);
        expect(byteShare(10, 0)).toBe(0);
        expect(byteShare(-5, 100)).toBe(0);
    });
});
