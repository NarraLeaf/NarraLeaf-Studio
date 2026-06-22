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
});
