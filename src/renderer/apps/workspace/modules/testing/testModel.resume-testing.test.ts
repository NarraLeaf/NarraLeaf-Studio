import { createTranslator } from "@shared/i18n";
import type { TestRunRecord } from "@/lib/testing/types";
import { describe, expect, it } from "vitest";
import { formatTestDuration } from "./testModel";

describe("test report duration", () => {
    const t = createTranslator("en").t;
    const record = (elapsed: number): TestRunRecord => ({
        runId: "run",
        testId: "test",
        title: { text: "Test" },
        protocolVersion: 2,
        parameters: {},
        status: "passed",
        startedAt: 1000,
        finishedAt: 1000 + elapsed,
        findings: [],
        log: [],
        progress: null,
    });

    it("carries rounded seconds into the next minute", () => {
        expect(formatTestDuration(record(119_600), t)).toBe("2m 00s");
        expect(formatTestDuration(record(120_400), t)).toBe("2m 00s");
        expect(formatTestDuration(record(121_000), t)).toBe("2m 01s");
    });
});
