import { describe, expect, it } from "vitest";
import {
    migrateProjectAppTagDocument,
    resolveAppTagPluginConfigValue,
    variantStorablePluginConfig,
} from "./appTag";
import { GAME_BUILD_FORMATS_BY_PLATFORM } from "./gameBuild";
import type { PluginBuildConfigField } from "./plugins";

function field(key: string, scope: PluginBuildConfigField["scope"]): PluginBuildConfigField {
    return { pluginId: "example.plugin", pluginName: "Example", key, label: key, type: "text", scope };
}

describe("app tag plugin config ownership", () => {
    it("keeps a differently named variant field when a global field is swept", () => {
        const document = migrateProjectAppTagDocument({
            tags: [{
                id: "demo",
                name: "Demo",
                pluginConfig: { "example.plugin": { depot: "misplaced", "depot@windows": "variant-value" } },
            }],
        });
        const tag = document.tags[0];
        tag.pluginConfig = variantStorablePluginConfig(tag.pluginConfig!, [field("depot", "global")]);
        const saved = migrateProjectAppTagDocument(JSON.parse(JSON.stringify(document)));

        expect(resolveAppTagPluginConfigValue(saved.tags[0], {}, field("depot@windows", "variant")))
            .toEqual({ value: "variant-value", overridden: true });
        expect(saved.tags[0].pluginConfig).toEqual({ "example.plugin": { "depot@windows": "variant-value" } });
    });

    it("sweeps actual platform keys while retaining other prefixed fields", () => {
        const document = migrateProjectAppTagDocument({
            tags: [{
                id: "demo",
                name: "Demo",
                pluginConfig: {
                    "example.plugin": { depot: "misplaced", "depot@windows": "old-value", "depot@bonus": "variant-value" },
                },
            }],
        });
        const tag = document.tags[0];
        tag.pluginConfig = variantStorablePluginConfig(tag.pluginConfig!, [field("depot", "platform")]);
        const saved = migrateProjectAppTagDocument(JSON.parse(JSON.stringify(document)));

        expect(resolveAppTagPluginConfigValue(saved.tags[0], {}, field("depot@bonus", "variant")))
            .toEqual({ value: "variant-value", overridden: true });
        expect(saved.tags[0].pluginConfig).toEqual({ "example.plugin": { "depot@bonus": "variant-value" } });
    });

    it("sweeps each supported platform for a platform-scoped field", () => {
        const values = Object.fromEntries(
            Object.keys(GAME_BUILD_FORMATS_BY_PLATFORM).map(platform => [`depot@${platform}`, "misplaced"]),
        );
        expect(variantStorablePluginConfig({ "example.plugin": values }, [field("depot", "platform")]))
            .toEqual({});
    });
});
