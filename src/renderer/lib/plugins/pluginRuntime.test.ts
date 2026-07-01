import { describe, expect, it, vi } from "vitest";
import { definePlugin } from "@/plugin";
import { resolvePluginDefinition } from "./pluginRuntime";

describe("plugin runtime", () => {
    it("accepts default exported definePlugin definitions", () => {
        const setup = vi.fn();
        const definition = definePlugin({ setup });

        expect(resolvePluginDefinition({ default: definition })).toBe(definition);
    });

    it("accepts named plugin definitions for compatibility", () => {
        const setup = vi.fn();
        const definition = definePlugin({ setup });

        expect(resolvePluginDefinition({ plugin: definition })).toBe(definition);
    });

    it("rejects entries that do not export definePlugin definitions", () => {
        expect(() => resolvePluginDefinition({ default: {} })).toThrow("default-export definePlugin");
    });
});
