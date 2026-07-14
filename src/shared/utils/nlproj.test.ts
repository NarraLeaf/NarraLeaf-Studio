import { describe, expect, it } from "vitest";
import { decodeProjectConfig, encodeProjectConfig, type ProjectConfigData } from "./nlproj";
import { PROJECT_DEPENDENCY_SCHEMA_VERSION } from "../types/pluginDependencies";

describe("nlproj codec", () => {
    it("round-trips a config that carries a dependency table", () => {
        const config: ProjectConfigData = {
            name: "Demo",
            identifier: "com.example.demo",
            metadata: { version: "0.1.0" },
            dependencies: {
                schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION,
                plugins: [
                    {
                        id: "narraleaf.gallery",
                        name: "NarraLeaf Gallery",
                        builtIn: true,
                        authoredVersion: "1.0.0",
                        hard: true,
                        usedBy: { blueprintNode: ["narraleaf.gallery.add"] },
                    },
                ],
            },
        };

        const decoded = decodeProjectConfig(encodeProjectConfig(config));
        expect(decoded.dependencies).toEqual(config.dependencies);
    });

    it("round-trips a config with no dependency table", () => {
        const config: ProjectConfigData = {
            name: "Bare",
            identifier: "com.example.bare",
            metadata: {},
        };
        const decoded = decodeProjectConfig(encodeProjectConfig(config));
        expect(decoded.dependencies).toBeUndefined();
    });
});
