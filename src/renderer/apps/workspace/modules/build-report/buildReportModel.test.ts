import { describe, expect, it } from "vitest";
import type { GameBuildStateSnapshot, ShippedAssetReportEntry } from "@shared/types/gameBuild";
import {
    artifactFileName,
    artifactLocation,
    buildArtifactRows,
    filterShippedAssets,
    formatBuildDuration,
    groupShippedAssets,
    shippedAssetReport,
    totalArtifactBytes,
} from "./buildReportModel";

function entry(
    id: string,
    name: string,
    type: string,
    bytes?: number,
): ShippedAssetReportEntry {
    return bytes === undefined ? { id, name, type } : { id, name, type, bytes };
}

/** Stands in for the translator: returns the key and the values it was handed. */
const t = ((key: string, params?: Record<string, unknown>) =>
    `${key}:${JSON.stringify(params ?? {})}`) as never;

describe("artifactFileName", () => {
    it("takes the last segment of a Windows path", () => {
        expect(artifactFileName("D:\\dist\\Game Setup 1.0.0.exe")).toBe("Game Setup 1.0.0.exe");
    });

    it("takes the last segment of a POSIX path", () => {
        expect(artifactFileName("/home/a/dist/Game-1.0.0.AppImage")).toBe("Game-1.0.0.AppImage");
    });

    it("ignores a trailing separator, as a packaged app directory carries", () => {
        expect(artifactFileName("/home/a/dist/mac/Game.app/")).toBe("Game.app");
    });
});

describe("artifactLocation", () => {
    it("is blank for an artifact in the output folder itself", () => {
        expect(artifactLocation("D:\\proj\\dist\\Game Setup.exe", "D:\\proj\\dist")).toBe("");
    });

    it("names the folder a nested artifact sits in", () => {
        expect(artifactLocation("D:\\proj\\dist\\dlc\\winter\\winter_DLC.pak", "D:\\proj\\dist"))
            .toBe("dlc/winter/");
        expect(artifactLocation("/p/dist/Game-1.0.0-web/index.html", "/p/dist")).toBe("Game-1.0.0-web/");
    });

    it("relates the two paths whichever separator and case each was written in", () => {
        // The snapshot crosses from a main process that may have built for the other OS, and
        // Windows reports a drive letter in either case.
        expect(artifactLocation("d:/proj/dist/mac/Game.app", "D:\\proj\\dist")).toBe("mac/");
    });

    it("claims no relation for a path outside the output folder, or with no folder recorded", () => {
        expect(artifactLocation("/elsewhere/a.zip", "/p/dist")).toBe("");
        expect(artifactLocation("/p/dist/a.zip", undefined)).toBe("");
        // The folder itself is not inside itself, however it was spelled.
        expect(artifactLocation("/p/dist", "/p/dist/")).toBe("");
    });
});

describe("buildArtifactRows", () => {
    it("pairs each artifact with its measured size", () => {
        const rows = buildArtifactRows({
            status: "done",
            progress: null,
            artifacts: ["/dist/a.zip", "/dist/b.dmg"],
            artifactSizes: [{ path: "/dist/b.dmg", bytes: 20 }, { path: "/dist/a.zip", bytes: 10 }],
        });
        expect(rows).toEqual([
            { path: "/dist/a.zip", name: "a.zip", location: "", bytes: 10 },
            { path: "/dist/b.dmg", name: "b.dmg", location: "", bytes: 20 },
        ]);
    });

    it("carries where each artifact sits, so a multi-target run is not a flat list of names", () => {
        const rows = buildArtifactRows({
            status: "done",
            progress: null,
            outputDir: "/p/dist",
            artifacts: ["/p/dist/Game.exe", "/p/dist/dlc/winter/winter_DLC.pak", "/p/dist/SHA256SUMS"],
        });
        expect(rows.map(row => row.location)).toEqual(["", "dlc/winter/", ""]);
    });

    it("leaves an unmeasured artifact without a size rather than at zero", () => {
        const rows = buildArtifactRows({
            status: "done",
            progress: null,
            artifacts: ["/dist/a.zip"],
            artifactSizes: [{ path: "/dist/a.zip" }],
        });
        expect(rows[0]).not.toHaveProperty("bytes");
    });

    it("reports the artifacts of a run that measured nothing", () => {
        const rows = buildArtifactRows({ status: "done", progress: null, artifacts: ["/dist/patch.nlpatch"] });
        expect(rows).toEqual([{ path: "/dist/patch.nlpatch", name: "patch.nlpatch", location: "" }]);
        expect(totalArtifactBytes(rows)).toBe(0);
    });

    it("is empty for a run that produced nothing", () => {
        expect(buildArtifactRows({ status: "error", progress: null })).toEqual([]);
    });
});

describe("filterShippedAssets", () => {
    const entries = [
        entry("a1", "Title screen", "image", 100),
        entry("a2", "Opening theme", "audio", 200),
        entry("a3", "Rain loop", "audio", 50),
    ];

    it("returns everything for a blank query", () => {
        expect(filterShippedAssets(entries, "   ")).toHaveLength(3);
    });

    it("matches the name regardless of case", () => {
        expect(filterShippedAssets(entries, "RAIN").map(e => e.id)).toEqual(["a3"]);
    });

    it("matches the id and the type as well as the name", () => {
        expect(filterShippedAssets(entries, "a2").map(e => e.id)).toEqual(["a2"]);
        expect(filterShippedAssets(entries, "audio").map(e => e.id)).toEqual(["a2", "a3"]);
    });
});

describe("groupShippedAssets", () => {
    it("orders groups and their entries heaviest first", () => {
        const groups = groupShippedAssets([
            entry("a1", "Icon", "image", 10),
            entry("a2", "Backdrop", "image", 900),
            entry("a3", "Theme", "audio", 400),
        ]);
        expect(groups.map(group => group.type)).toEqual(["image", "audio"]);
        expect(groups[0]?.bytes).toBe(910);
        expect(groups[0]?.entries.map(e => e.id)).toEqual(["a2", "a1"]);
    });

    it("counts an unmeasured entry without weighing it", () => {
        const groups = groupShippedAssets([entry("a1", "Model", "model"), entry("a2", "Pose", "model", 5)]);
        expect(groups[0]?.entries).toHaveLength(2);
        expect(groups[0]?.bytes).toBe(5);
        // The measured one leads: an entry with no size cannot claim to be the heaviest.
        expect(groups[0]?.entries[0]?.id).toBe("a2");
    });

    it("breaks ties by name so two readings of one build agree", () => {
        const groups = groupShippedAssets([
            entry("a2", "Beta", "font", 7),
            entry("a1", "Alpha", "font", 7),
        ]);
        expect(groups[0]?.entries.map(e => e.id)).toEqual(["a1", "a2"]);
    });

    it("has no groups for an empty list", () => {
        expect(groupShippedAssets([])).toEqual([]);
    });
});

describe("formatBuildDuration", () => {
    it("states seconds under a minute", () => {
        expect(formatBuildDuration({ status: "done", progress: null, startedAt: 0, finishedAt: 2500 }, t))
            .toBe(`build.report.durationSeconds:${JSON.stringify({ seconds: "2.5" })}`);
    });

    it("states minutes and padded seconds over a minute", () => {
        expect(formatBuildDuration({ status: "done", progress: null, startedAt: 0, finishedAt: 125_000 }, t))
            .toBe(`build.report.durationMinutes:${JSON.stringify({ minutes: 2, seconds: "05" })}`);
    });

    it("says nothing about a run that carries no stamps", () => {
        expect(formatBuildDuration({ status: "error", progress: null }, t)).toBe("");
        expect(formatBuildDuration({ status: "error", progress: null, startedAt: 10 }, t)).toBe("");
    });
});

describe("shippedAssetReport", () => {
    it("is null for a run that narrowed nothing", () => {
        const previewLike: GameBuildStateSnapshot = { status: "done", progress: null, artifacts: [] };
        expect(shippedAssetReport(previewLike)).toBeNull();
    });

    it("hands back the report a run that narrowed the library carries", () => {
        const state: GameBuildStateSnapshot = {
            status: "done",
            progress: null,
            assetReport: {
                included: [entry("a1", "Title screen", "image", 100)],
                excluded: [],
                excludedCharacters: [{ id: "c1", name: "Kaede" }],
                includedBytes: 100,
                excludedBytes: 0,
            },
        };
        expect(shippedAssetReport(state)?.includedBytes).toBe(100);
    });
});
