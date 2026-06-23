import { describe, expect, it } from "vitest";
import { ApiCapability } from "../types/pluginPermissions";
import {
    describePluginInstallPermissions,
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
