import { describe, expect, it } from "vitest";
import type { GameBuildPlatform } from "../types/gameBuild";
import type { PluginBuildConfigField, PluginBuildConfigFieldContribution } from "../types/plugins";
import {
    collectPluginBuildConfigFields,
    pluginBuildConfigSlots,
    type PluginBuildConfigDeclaringPlugin,
} from "./pluginBuildConfig";

/**
 * The fold from "what the installed plugins declare" to "what this build has to be told": which
 * plugins are asked, which fields survive the platform filter, and how many values each field is.
 */

const plugin = (
    pluginId: string,
    buildConfig: PluginBuildConfigFieldContribution[],
    overrides: Partial<PluginBuildConfigDeclaringPlugin> = {},
): PluginBuildConfigDeclaringPlugin => ({
    pluginId,
    enabled: true,
    manifest: { name: pluginId, contributes: { buildConfig } },
    ...overrides,
});

const field = (
    key: string,
    scope: PluginBuildConfigFieldContribution["scope"],
    platforms?: GameBuildPlatform[],
): PluginBuildConfigFieldContribution => ({
    key,
    label: key,
    type: "text",
    scope,
    ...(platforms ? { platforms } : {}),
});

const declared = (pluginId: string, contribution: PluginBuildConfigFieldContribution): PluginBuildConfigField => ({
    ...contribution,
    pluginId,
    pluginName: pluginId,
});

describe("collectPluginBuildConfigFields", () => {
    it("carries the declaring plugin with every field", () => {
        const fields = collectPluginBuildConfigFields(
            [plugin("acme.steam", [field("appId", "global")])],
            ["windows"],
        );

        expect(fields).toEqual([expect.objectContaining({
            key: "appId",
            pluginId: "acme.steam",
            pluginName: "acme.steam",
        })]);
    });

    it("asks nothing of a disabled plugin", () => {
        const fields = collectPluginBuildConfigFields(
            [plugin("acme.steam", [field("appId", "global")], { enabled: false })],
            ["windows"],
        );

        expect(fields).toEqual([]);
    });

    it("drops a field no platform being built matches, and keeps one that names none", () => {
        const fields = collectPluginBuildConfigFields(
            [plugin("acme.steam", [
                field("desktopOnly", "global", ["windows", "macos"]),
                field("everywhere", "global"),
            ])],
            ["android"],
        );

        expect(fields.map(entry => entry.key)).toEqual(["everywhere"]);
    });

    it("falls back to the plugin id when the manifest names nothing", () => {
        const fields = collectPluginBuildConfigFields(
            [{ pluginId: "acme.steam", enabled: true, manifest: { contributes: { buildConfig: [field("appId", "global")] } } }],
            ["windows"],
        );

        expect(fields[0].pluginName).toBe("acme.steam");
    });

    it("answers nothing for a build with no targets", () => {
        expect(collectPluginBuildConfigFields([plugin("acme.steam", [field("appId", "global")])], [])).toEqual([]);
    });
});

describe("pluginBuildConfigSlots", () => {
    it("asks a platform-scoped field once per platform, and every other scope once", () => {
        const slots = pluginBuildConfigSlots(
            [
                declared("acme.steam", field("appId", "global")),
                declared("acme.steam", field("branch", "variant-platform")),
            ],
            ["windows", "macos"],
        );

        expect(slots.map(slot => [slot.storageKey, slot.platform])).toEqual([
            ["appId", undefined],
            ["branch@windows", "windows"],
            ["branch@macos", "macos"],
        ]);
    });

    it("skips the platforms a platform-scoped field does not name", () => {
        const slots = pluginBuildConfigSlots(
            [declared("acme.steam", field("depot", "platform", ["windows"]))],
            ["windows", "linux"],
        );

        expect(slots.map(slot => slot.storageKey)).toEqual(["depot@windows"]);
    });
});
