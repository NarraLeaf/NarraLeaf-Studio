/**
 * The guard for a defect a real Mac found and no Windows run could have.
 *
 * `bindMacOS` registered its CGPoint struct on every call, and koffi's type registry is
 * process-global: the second registration threw `Duplicate type name 'NLCGPoint'`, which the
 * binding reported as "this host cannot move the cursor". Nothing in the message mentioned structs,
 * and nothing on Windows executes that branch, so the only thing standing between this and a
 * repeat is a test about the memo itself.
 */

import { describe, expect, it, vi } from "vitest";
import { registerKoffiStructOnce } from "./systemCursor";

describe("registerKoffiStructOnce", () => {
    it("registers a name once however many times it is asked", () => {
        const koffi = { struct: vi.fn() };

        registerKoffiStructOnce(koffi as never, "NLTestPoint", { x: "double", y: "double" });
        registerKoffiStructOnce(koffi as never, "NLTestPoint", { x: "double", y: "double" });
        registerKoffiStructOnce(koffi as never, "NLTestPoint", { x: "double", y: "double" });

        expect(koffi.struct).toHaveBeenCalledTimes(1);
        expect(koffi.struct).toHaveBeenCalledWith("NLTestPoint", { x: "double", y: "double" });
    });

    it("keeps separate names apart", () => {
        const koffi = { struct: vi.fn() };
        registerKoffiStructOnce(koffi as never, "NLTestA", { x: "double" });
        registerKoffiStructOnce(koffi as never, "NLTestB", { y: "double" });
        registerKoffiStructOnce(koffi as never, "NLTestA", { x: "double" });
        expect(koffi.struct).toHaveBeenCalledTimes(2);
    });
});
