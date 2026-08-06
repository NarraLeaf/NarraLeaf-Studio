import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearWorkspaceAnomalies,
    describeRawError,
    getWorkspaceAnomalies,
    getWorkspaceAnomalyReportCount,
    observeWorkspaceAnomalies,
    reportWorkspaceAnomaly,
} from "./anomalyLog";

const OPERATION = "workspace.recovery.operations.assetsShardRead" as const;

beforeEach(() => {
    clearWorkspaceAnomalies();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("reportWorkspaceAnomaly", () => {
    it("keeps the error text exactly as it arrived", () => {
        // The reason this module exists. A test that only checked "an anomaly was recorded" would
        // pass just as happily against a version that stored a friendly summary, which is the one
        // thing the recovery panel cannot use.
        reportWorkspaceAnomaly({
            source: "assets",
            operationKey: OPERATION,
            path: "D:\\Proj\\editor\\assets.image.json",
            error: { code: "INVALID_JSON", message: "Unexpected token } in JSON at position 41273" },
            severity: "degraded",
        });

        const [anomaly] = getWorkspaceAnomalies();
        expect(anomaly.raw).toBe("INVALID_JSON: Unexpected token } in JSON at position 41273");
        // Windows paths reach the panel unmangled; see the backslash regression this repeats.
        expect(anomaly.path).toBe("D:\\Proj\\editor\\assets.image.json");
    });

    it("collapses an identical repeat", () => {
        // Every load path that reports here runs again on each working-tree re-read, so a single
        // damaged file must not add a row every time the author browses their own history.
        const input = {
            source: "story",
            operationKey: OPERATION,
            path: "editor/story/index.json",
            error: new Error("boom"),
            severity: "fatal",
        } as const;
        const first = reportWorkspaceAnomaly({ ...input });
        const second = reportWorkspaceAnomaly({ ...input });

        expect(getWorkspaceAnomalies()).toHaveLength(1);
        expect(second.id).toBe(first.id);
    });

    it("keeps a different error about the same file", () => {
        reportWorkspaceAnomaly({
            source: "story",
            operationKey: OPERATION,
            path: "editor/story/index.json",
            error: new Error("first"),
            severity: "fatal",
        });
        reportWorkspaceAnomaly({
            source: "story",
            operationKey: OPERATION,
            path: "editor/story/index.json",
            error: new Error("second"),
            severity: "fatal",
        });

        expect(getWorkspaceAnomalies()).toHaveLength(2);
    });

    it("lists newest first", () => {
        reportWorkspaceAnomaly({ source: "assets", operationKey: OPERATION, error: "older", severity: "degraded" });
        reportWorkspaceAnomaly({ source: "assets", operationKey: OPERATION, error: "newer", severity: "degraded" });

        expect(getWorkspaceAnomalies().map(anomaly => anomaly.raw)).toEqual(["newer", "older"]);
    });

    it("notifies observers, immediately and on change", () => {
        const seen: number[] = [];
        const unsubscribe = observeWorkspaceAnomalies(anomalies => seen.push(anomalies.length));
        expect(seen).toEqual([0]);

        reportWorkspaceAnomaly({ source: "plugins", operationKey: OPERATION, error: "x", severity: "degraded" });
        expect(seen).toEqual([0, 1]);

        unsubscribe();
        reportWorkspaceAnomaly({ source: "plugins", operationKey: OPERATION, error: "y", severity: "degraded" });
        expect(seen).toEqual([0, 1]);
    });

    it("survives an observer that throws", () => {
        // An observer must never be able to turn "we survived this" into a thrown error on the load
        // path that survived it.
        observeWorkspaceAnomalies(() => {
            throw new Error("observer is broken");
        });

        expect(() => reportWorkspaceAnomaly({
            source: "assets",
            operationKey: OPERATION,
            error: "still recorded",
            severity: "degraded",
        })).not.toThrow();
        expect(getWorkspaceAnomalies()).toHaveLength(1);
    });
});

describe("getWorkspaceAnomalyReportCount", () => {
    it("counts a deduped repeat that the log itself collapses", () => {
        // The reason it exists. A recovery probe asks "did anything go wrong while I ran?", and the
        // set of anomalies cannot answer that on a second run - the record is identical and is
        // deduped away, so the probe would report a green tick over an unreadable file.
        const input = {
            source: "assets",
            operationKey: OPERATION,
            path: "assets/assets.metadata.image.json",
            error: "same failure both times",
            severity: "degraded",
        } as const;

        expect(getWorkspaceAnomalyReportCount("assets")).toBe(0);
        reportWorkspaceAnomaly({ ...input });
        reportWorkspaceAnomaly({ ...input });

        expect(getWorkspaceAnomalies()).toHaveLength(1);
        expect(getWorkspaceAnomalyReportCount("assets")).toBe(2);
    });

    it("counts each source separately", () => {
        reportWorkspaceAnomaly({ source: "assets", operationKey: OPERATION, error: "a", severity: "degraded" });
        reportWorkspaceAnomaly({ source: "story", operationKey: OPERATION, error: "b", severity: "degraded" });

        expect(getWorkspaceAnomalyReportCount("assets")).toBe(1);
        expect(getWorkspaceAnomalyReportCount("story")).toBe(1);
        expect(getWorkspaceAnomalyReportCount("interface")).toBe(0);
    });

    it("resets with the log", () => {
        reportWorkspaceAnomaly({ source: "assets", operationKey: OPERATION, error: "a", severity: "degraded" });
        clearWorkspaceAnomalies();
        expect(getWorkspaceAnomalyReportCount("assets")).toBe(0);
    });
});

describe("describeRawError", () => {
    it("keeps an Error's stack", () => {
        const error = new Error("could not read");
        expect(describeRawError(error)).toBe(error.stack);
    });

    it("appends a cause", () => {
        const error = new Error("outer", { cause: new Error("inner") });
        expect(describeRawError(error)).toContain("Caused by: ");
        expect(describeRawError(error)).toContain("inner");
    });

    it("reads a filesystem reject as code plus message", () => {
        expect(describeRawError({ code: "ENOENT", message: "no such file" })).toBe("ENOENT: no such file");
    });

    it("passes a string through untouched", () => {
        expect(describeRawError("plain")).toBe("plain");
    });

    it("serialises an unrecognised object rather than stringifying it", () => {
        // `[object Object]` is what this exists to prevent: the case worth recording is the one
        // nobody predicted the shape of.
        expect(describeRawError({ weird: true })).toBe("{\n  \"weird\": true\n}");
    });

    it("falls back when serialisation is impossible", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(describeRawError(circular)).toBe("[object Object]");
    });
});

describe("clearWorkspaceAnomalies", () => {
    it("empties the log and announces it", () => {
        reportWorkspaceAnomaly({ source: "assets", operationKey: OPERATION, error: "x", severity: "degraded" });
        const seen: number[] = [];
        observeWorkspaceAnomalies(anomalies => seen.push(anomalies.length));

        clearWorkspaceAnomalies();

        expect(getWorkspaceAnomalies()).toHaveLength(0);
        expect(seen).toEqual([1, 0]);
    });
});
