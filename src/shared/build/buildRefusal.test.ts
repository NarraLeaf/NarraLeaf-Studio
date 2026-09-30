import { describe, expect, it } from "vitest";
import { BuildRefusal, describeWorkerFailure } from "./buildRefusal";

describe("what a worker sends for a failure", () => {
    it("is the refusal's sentence alone, which is what the author is shown", () => {
        const text = describeWorkerFailure(new BuildRefusal("1 script could not be compiled.\nscripts/boot.ts: ..."));
        expect(text).toBe("1 script could not be compiled.\nscripts/boot.ts: ...");
        expect(text).not.toMatch(/\n\s+at /);
    });

    it("is a defect's stack, which is what someone fixing Studio needs", () => {
        const error = new Error("unexpected");
        expect(describeWorkerFailure(error)).toBe(error.stack);
    });

    it("is anything else as text", () => {
        expect(describeWorkerFailure("plain")).toBe("plain");
    });
});
