import { describe, expect, it } from "vitest";
import {
    createPluginFacadeToken,
    defaultFacadeToken,
    resolvePrivilegedActor,
    revokePrivilegedToken,
} from "./privilegedTokens";

describe("privileged facade tokens", () => {
    it("resolves the default facade token without exposing mutable token state", () => {
        expect(Object.isFrozen(defaultFacadeToken)).toBe(true);
        expect(Object.getPrototypeOf(defaultFacadeToken)).toBe(null);
        expect(resolvePrivilegedActor(defaultFacadeToken)).toEqual({ kind: "facade", id: "default" });
    });

    it("rejects forged tokens and revoked plugin tokens", () => {
        const token = createPluginFacadeToken("plugin.test");
        expect(resolvePrivilegedActor(token)).toEqual({ kind: "plugin", pluginId: "plugin.test" });

        const forged = Object.freeze(Object.create(null));
        expect(() => resolvePrivilegedActor(forged)).toThrow("Invalid privileged facade token");

        revokePrivilegedToken(token);
        expect(() => resolvePrivilegedActor(token)).toThrow("Invalid privileged facade token");
    });

    it("names a plugin's own actor even after the built-ins are tampered with", () => {
        // Plugin code shares this realm. Replacing `WeakMap.prototype.get` used to be enough to have
        // a plugin's privileged call resolve to Studio's own actor.
        const token = createPluginFacadeToken("plugin.hostile");
        const forged = Object.freeze(Object.create(null));
        const original = WeakMap.prototype.get;
        // Read under the patch, asserted after it: the test runner leans on WeakMap itself.
        let resolved: unknown;
        let forgedResolved: unknown;
        WeakMap.prototype.get = function () {
            return { kind: "facade", id: "default" };
        };
        try {
            resolved = resolvePrivilegedActor(token);
            try {
                forgedResolved = resolvePrivilegedActor(forged);
            } catch (error) {
                forgedResolved = error;
            }
        } finally {
            WeakMap.prototype.get = original;
            revokePrivilegedToken(token);
        }

        expect(resolved).toEqual({ kind: "plugin", pluginId: "plugin.hostile" });
        expect(forgedResolved).toBeInstanceOf(Error);
    });
});
