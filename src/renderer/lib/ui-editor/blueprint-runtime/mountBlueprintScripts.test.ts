import { describe, expect, it, afterEach } from "vitest";
import { mountBlueprintCompiledScripts } from "./mountBlueprintScripts";
import type { DevModeBundle } from "@shared/types/devMode";

declare global {
    // eslint-disable-next-line no-var
    var __NL_BP_SCRIPT_EXECUTED__: boolean | undefined;
}

afterEach(() => {
    delete globalThis.__NL_BP_MODULES__;
    delete globalThis.__NL_BP_SCRIPT_EXECUTED__;
});

describe("mountBlueprintCompiledScripts", () => {
    it("does not evaluate project-controlled bundle scripts", () => {
        mountBlueprintCompiledScripts({
            bundleId: "bundle",
            revision: 1,
            timestamp: new Date(0).toISOString(),
            ui: {} as DevModeBundle["ui"],
            blueprintCompiledScripts: {
                malicious: "globalThis.__NL_BP_SCRIPT_EXECUTED__ = true;",
            },
        });

        expect(globalThis.__NL_BP_SCRIPT_EXECUTED__).toBeUndefined();
        expect(globalThis.__NL_BP_MODULES__).toEqual({});
    });
});
