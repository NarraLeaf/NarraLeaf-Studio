import { afterEach, describe, expect, it, vi } from "vitest";
import { recordCommandLineRunLine } from "./commandLineRunConsole";

vi.mock("./commandLineRunEnd", () => ({ getCommandLineRunEnd: () => null }));

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Both command-line runners record through this one function, so a build's console reaches the
 * profile log exactly as a check's does and survives a process that ends without flushing stdout.
 */
describe("recordCommandLineRunLine", () => {
    it("keeps the line, prints it, and writes the same text into the log", () => {
        const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const info = vi.fn();
        const log: Parameters<typeof recordCommandLineRunLine>[0] = [];
        const line = { timestamp: 1, level: "info" as const, source: "Build", message: "packaging" };

        recordCommandLineRunLine(log, { info }, line);

        expect(log).toEqual([line]);
        expect(write).toHaveBeenCalledWith("[info] Build: packaging\n");
        expect(info).toHaveBeenCalledWith("[CommandLine] [info] Build: packaging");
    });
});
