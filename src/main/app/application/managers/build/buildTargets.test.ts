import { describe, expect, it } from "vitest";
import { resolveBuildTargets } from "./buildTargets";

describe("build target resolution", () => {
    it("partitions mixed targets without changing the caller's selection", () => {
        const selection = [
            { platform: "windows" as const, formats: ["zip" as const, "zip" as const], arch: "x64" as const },
            { platform: "android" as const, formats: ["apk" as const] },
            { platform: "web" as const, formats: ["zip" as const, "apk" as const] },
        ];
        const resolved = resolveBuildTargets(selection);
        expect(resolved.desktopTargets).toEqual([{ platform: "windows", formats: ["zip"], arch: "x64" }]);
        expect(resolved.mobileTargets.map(target => target.platform)).toEqual(["android"]);
        expect(resolved.webFormats).toEqual(["zip"]);
        expect(selection[0].formats).toHaveLength(2);
    });

    it("retains unknown targets so execution can refuse them", () => {
        const selection = [{ platform: "unknown", formats: ["zip"] }] as never;
        expect(resolveBuildTargets(selection).unknownTargets).toHaveLength(1);
        expect(resolveBuildTargets(undefined).targets).toEqual([]);
        expect(resolveBuildTargets([{ platform: "web", formats: [] }]).targets).toEqual([]);
    });
});
