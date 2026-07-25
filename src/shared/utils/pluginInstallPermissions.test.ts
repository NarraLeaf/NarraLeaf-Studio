import { describe, expect, it } from "vitest";
import { ApiCapability } from "../types/pluginPermissions";
import {
    describePluginInstallPermissions,
    isPermissionSubset,
    NO_INSTALL_PERMISSIONS_COPY,
} from "./pluginInstallPermissions";

describe("plugin install permission copy", () => {
    it("synthesizes install permission text from structured filesystem and api permissions", () => {
        expect(describePluginInstallPermissions([
            {
                kind: "filesystem",
                path: "/Users/test/Desktop/narraleaf-plugin-permission-test.txt",
                mode: "readwrite",
                recursive: false,
            },
            {
                kind: "api",
                capability: ApiCapability.BashExecute,
            },
        ])).toEqual([
            "Read and write access for /Users/test/Desktop/narraleaf-plugin-permission-test.txt",
            "Use Studio API capability: bash.execute",
        ]);
    });

    it("uses system fallback copy when install approval has no privileged controls", () => {
        expect(describePluginInstallPermissions(undefined)).toEqual([NO_INSTALL_PERMISSIONS_COPY]);
        expect(describePluginInstallPermissions([])).toEqual([NO_INSTALL_PERMISSIONS_COPY]);
    });

    it("normalizes structured values before rendering them", () => {
        expect(describePluginInstallPermissions([
            {
                kind: "api",
                capability: "custom.capability\nwith.extra\tspacing",
            },
        ])).toEqual(["Use Studio API capability: custom.capability with.extra spacing"]);
    });
});

describe("isPermissionSubset", () => {
    const fs = (path: string, mode: "read" | "write" | "readwrite", recursive = false) =>
        ({ kind: "filesystem", path, mode, recursive }) as const;
    const api = (capability: string) => ({ kind: "api", capability }) as const;

    it("treats empty against empty as covered", () => {
        expect(isPermissionSubset([], [])).toBe(true);
        expect(isPermissionSubset(undefined, undefined)).toBe(true);
    });

    it("covers an unchanged set", () => {
        const permissions = [api(ApiCapability.BashExecute), fs("/project", "read")];
        expect(isPermissionSubset(permissions, permissions)).toBe(true);
    });

    it("covers a set that only drops permissions", () => {
        expect(isPermissionSubset([api("a")], [api("a"), api("b")])).toBe(true);
        expect(isPermissionSubset([], [api("a")])).toBe(true);
    });

    it("rejects a newly added capability", () => {
        expect(isPermissionSubset([api("a"), api("b")], [api("a")])).toBe(false);
        expect(isPermissionSubset([api("a")], [])).toBe(false);
    });

    it("lets a broader granted mode cover a narrower request", () => {
        expect(isPermissionSubset([fs("/p", "read")], [fs("/p", "readwrite")])).toBe(true);
        expect(isPermissionSubset([fs("/p", "write")], [fs("/p", "readwrite")])).toBe(true);
        expect(isPermissionSubset([fs("/p", "readwrite")], [fs("/p", "read")])).toBe(false);
        expect(isPermissionSubset([fs("/p", "write")], [fs("/p", "read")])).toBe(false);
    });

    it("lets a recursive grant cover paths beneath it", () => {
        expect(isPermissionSubset([fs("/p/a", "read")], [fs("/p", "read", true)])).toBe(true);
        expect(isPermissionSubset([fs("/p/a", "read", true)], [fs("/p", "read", true)])).toBe(true);
        expect(isPermissionSubset([fs("/p", "read", true)], [fs("/p", "read")])).toBe(false);
        expect(isPermissionSubset([fs("/p/a", "read")], [fs("/p", "read")])).toBe(false);
    });

    it("does not mistake a sibling for a child of a recursive grant", () => {
        expect(isPermissionSubset([fs("/p/bc", "read")], [fs("/p/b", "read", true)])).toBe(false);
    });

    it("compares paths across separator styles", () => {
        expect(isPermissionSubset([fs("C:/p/a", "read")], [fs("C:\\p", "read", true)])).toBe(true);
    });

    it("never lets one kind cover another", () => {
        expect(isPermissionSubset([api("/p")], [fs("/p", "readwrite", true)])).toBe(false);
        expect(isPermissionSubset([fs("/p", "read")], [api("/p")])).toBe(false);
    });
});
