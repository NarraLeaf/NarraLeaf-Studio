import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger, type LogEntry } from "./logger";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Logger sinks", () => {
    it("removes a throwing sink and keeps delivering to healthy sinks", () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const failing = vi.fn(() => { throw new Error("sink failed"); });
        const healthy = vi.fn<(entry: LogEntry) => void>();
        const unsubscribeFailing = Logger.addSink(failing);
        const unsubscribeHealthy = Logger.addSink(healthy);

        try {
            const logger = new Logger("test");
            logger.info("first");
            logger.info("second");

            expect(failing).toHaveBeenCalledTimes(1);
            expect(healthy).toHaveBeenCalledTimes(2);
            expect(healthy.mock.calls.map(([entry]) => entry.message)).toEqual(["first", "second"]);
        } finally {
            unsubscribeFailing();
            unsubscribeHealthy();
        }
    });
});
