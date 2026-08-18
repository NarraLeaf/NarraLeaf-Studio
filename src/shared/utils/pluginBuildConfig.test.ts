import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { RELEASE_APP_TAG, type ProjectAppTag } from "../types/appTag";
import type { GameBuildPlatform } from "../types/gameBuild";
import type { PluginBuildConfigField, PluginBuildConfigFieldContribution } from "../types/plugins";
import {
  collectPluginBuildConfigFields,
  pluginBuildConfigSlots,
  resolveShippedPluginBuildConfig,
  type PluginBuildConfigDeclaringPlugin
} from "./pluginBuildConfig";
import { validatePluginManifest } from "./pluginManifest";

/**
 * The fold from "what the installed plugins declare" to "what this build has to be told": which
 * plugins are asked, which fields survive the platform filter, and how many values each field is.
 */

const plugin = (
  pluginId: string,
  buildConfig: PluginBuildConfigFieldContribution[],
  overrides: Partial<PluginBuildConfigDeclaringPlugin> = {}
): PluginBuildConfigDeclaringPlugin => ({
  pluginId,
  enabled: true,
  manifest: { name: pluginId, contributes: { buildConfig } },
  ...overrides
});

const field = (
  key: string,
  scope: PluginBuildConfigFieldContribution["scope"],
  platforms?: GameBuildPlatform[]
): PluginBuildConfigFieldContribution => ({
  key,
  label: key,
  type: "text",
  scope,
  ...(platforms ? { platforms } : {})
});

const declared = (
  pluginId: string,
  contribution: PluginBuildConfigFieldContribution
): PluginBuildConfigField => ({
  ...contribution,
  pluginId,
  pluginName: pluginId
});

describe("collectPluginBuildConfigFields", () => {
  it("carries the declaring plugin with every field", () => {
    const fields = collectPluginBuildConfigFields(
      [plugin("acme.steam", [field("appId", "global")])],
      ["windows"]
    );

    expect(fields).toEqual([
      expect.objectContaining({
        key: "appId",
        pluginId: "acme.steam",
        pluginName: "acme.steam"
      })
    ]);
  });

  it("asks nothing of a disabled plugin", () => {
    const fields = collectPluginBuildConfigFields(
      [plugin("acme.steam", [field("appId", "global")], { enabled: false })],
      ["windows"]
    );

    expect(fields).toEqual([]);
  });

  it("drops a field no platform being built matches, and keeps one that names none", () => {
    const fields = collectPluginBuildConfigFields(
      [
        plugin("acme.steam", [
          field("desktopOnly", "global", ["windows", "macos"]),
          field("everywhere", "global")
        ])
      ],
      ["android"]
    );

    expect(fields.map((entry) => entry.key)).toEqual(["everywhere"]);
  });

  it("falls back to the plugin id when the manifest names nothing", () => {
    const fields = collectPluginBuildConfigFields(
      [
        {
          pluginId: "acme.steam",
          enabled: true,
          manifest: { contributes: { buildConfig: [field("appId", "global")] } }
        }
      ],
      ["windows"]
    );

    expect(fields[0].pluginName).toBe("acme.steam");
  });

  it("answers nothing for a build with no targets", () => {
    expect(
      collectPluginBuildConfigFields([plugin("acme.steam", [field("appId", "global")])], [])
    ).toEqual([]);
  });
});

describe("pluginBuildConfigSlots", () => {
  it("asks a platform-scoped field once per platform, and every other scope once", () => {
    const slots = pluginBuildConfigSlots(
      [
        declared("acme.steam", field("appId", "global")),
        declared("acme.steam", field("branch", "variant-platform"))
      ],
      ["windows", "macos"]
    );

    expect(slots.map((slot) => [slot.storageKey, slot.platform])).toEqual([
      ["appId", undefined],
      ["branch@windows", "windows"],
      ["branch@macos", "macos"]
    ]);
  });

  it("skips the platforms a platform-scoped field does not name", () => {
    const slots = pluginBuildConfigSlots(
      [declared("acme.steam", field("depot", "platform", ["windows"]))],
      ["windows", "linux"]
    );

    expect(slots.map((slot) => slot.storageKey)).toEqual(["depot@windows"]);
  });
});

/**
 * The fold from "what the author filled in" to "what a build carries", which is a narrower question
 * than the two above: those decide what to *ask* for, this decides what may leave the project.
 *
 * The fixture package is the subject rather than a literal, because the two fields it declares are
 * exactly the pair that has to come apart here - a public storefront id and an upload credential.
 */
const FIXTURE_ID = "narraleaf.steam-appid-fixture";

async function fixturePlugin(): Promise<Omit<PluginBuildConfigDeclaringPlugin, "enabled">> {
  const manifestPath = path.join(
    fileURLToPath(new URL(`./__fixtures__/plugins/${FIXTURE_ID}/`, import.meta.url)),
    "manifest.json"
  );
  const result = validatePluginManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  if (!result.ok) {
    throw new Error(`fixture manifest is not valid: ${result.error}`);
  }
  return { pluginId: result.manifest.id, manifest: result.manifest };
}

const variant = (pluginConfig: ProjectAppTag["pluginConfig"]): ProjectAppTag => ({
  id: "demo",
  name: "Demo",
  overrides: {},
  ...(pluginConfig ? { pluginConfig } : {})
});

describe("resolveShippedPluginBuildConfig", () => {
  it("carries a global value the project holds", async () => {
    const shipped = resolveShippedPluginBuildConfig(await fixturePlugin(), RELEASE_APP_TAG, {
      [FIXTURE_ID]: { appId: "480" }
    });

    expect(shipped.values).toEqual({ appId: "480" });
  });

  it("carries what the variant states over what the project holds", async () => {
    const plugin = await fixturePlugin();
    // `appId` is global-scoped, so a variant cannot state one; a variant-scoped text field can.
    const withVariantField = {
      ...plugin,
      manifest: {
        ...plugin.manifest,
        contributes: {
          buildConfig: [
            ...plugin.manifest.contributes!.buildConfig!,
            { key: "branch", label: "Branch", type: "text", scope: "variant" } as const
          ]
        }
      }
    };

    expect(
      resolveShippedPluginBuildConfig(
        withVariantField,
        variant({ [FIXTURE_ID]: { branch: "demo-branch" } }),
        { [FIXTURE_ID]: { appId: "480", branch: "default" } }
      ).values
    ).toEqual({ appId: "480", branch: "demo-branch" });

    // The same project under a variant that states nothing reads the project's own.
    expect(
      resolveShippedPluginBuildConfig(withVariantField, variant(undefined), {
        [FIXTURE_ID]: { appId: "480", branch: "default" }
      }).values
    ).toEqual({ appId: "480", branch: "default" });
  });

  it("never carries a secret field, whichever record holds its handle", async () => {
    const shipped = resolveShippedPluginBuildConfig(
      await fixturePlugin(),
      variant({ [FIXTURE_ID]: { buildToken: "handle-from-the-variant" } }),
      { [FIXTURE_ID]: { appId: "480", buildToken: "handle-from-the-project" } }
    );

    expect(shipped.values).toEqual({ appId: "480" });
    expect(JSON.stringify(shipped)).not.toContain("handle");
  });

  /**
   * A platform-scoped field against an artifact that serves several platforms at once.
   *
   * The rule is agreement, not arithmetic: one platform selected has one answer, and so does a
   * field the author filled in the same way everywhere. Anything else is a question this artifact
   * cannot answer, and it is named rather than resolved to whichever platform came first.
   */
  async function platformFieldPlugin() {
    const plugin = await fixturePlugin();
    return {
      ...plugin,
      manifest: {
        ...plugin.manifest,
        contributes: {
          buildConfig: [{ key: "depot", label: "Depot", type: "text", scope: "platform" } as const]
        }
      }
    };
  }

  const DEPOTS = { [FIXTURE_ID]: { "depot@windows": "1001", "depot@macos": "1002" } };

  it("carries the platform-scoped value of the one platform this artifact serves", async () => {
    const shipped = resolveShippedPluginBuildConfig(
      await platformFieldPlugin(),
      RELEASE_APP_TAG,
      DEPOTS,
      ["windows"]
    );

    expect(shipped.values).toEqual({ depot: "1001" });
    expect(shipped.ambiguousKeys).toEqual([]);
  });

  it("names the key when the served platforms disagree, and carries nothing for it", async () => {
    const shipped = resolveShippedPluginBuildConfig(
      await platformFieldPlugin(),
      RELEASE_APP_TAG,
      DEPOTS,
      ["windows", "macos"]
    );

    expect(shipped.values).toEqual({});
    expect(shipped.ambiguousKeys).toEqual(["depot"]);
  });

  it("carries one value the served platforms agree on", async () => {
    const shipped = resolveShippedPluginBuildConfig(
      await platformFieldPlugin(),
      RELEASE_APP_TAG,
      { [FIXTURE_ID]: { "depot@windows": "1001", "depot@macos": "1001" } },
      ["windows", "macos"]
    );

    expect(shipped.values).toEqual({ depot: "1001" });
    expect(shipped.ambiguousKeys).toEqual([]);
  });

  it("carries nothing, and complains about nothing, when no platform is named", async () => {
    // Dev Mode and the preview. There is no platform to resolve against, and a compile that is
    // not producing a package has nothing to warn an author about.
    const shipped = resolveShippedPluginBuildConfig(
      await platformFieldPlugin(),
      RELEASE_APP_TAG,
      DEPOTS
    );

    expect(shipped.values).toEqual({});
    expect(shipped.ambiguousKeys).toEqual([]);
  });

  it("leaves out a field nobody filled in, rather than carrying a blank", async () => {
    expect(
      resolveShippedPluginBuildConfig(await fixturePlugin(), RELEASE_APP_TAG, {}).values
    ).toEqual({});
    expect(
      resolveShippedPluginBuildConfig(await fixturePlugin(), RELEASE_APP_TAG, {
        [FIXTURE_ID]: { appId: "" }
      }).values
    ).toEqual({});
  });

  it("reads only the declaring plugin's own record", async () => {
    const shipped = resolveShippedPluginBuildConfig(await fixturePlugin(), RELEASE_APP_TAG, {
      [FIXTURE_ID]: { appId: "480" },
      "acme.other": { appId: "999" }
    });

    expect(shipped.values).toEqual({ appId: "480" });
  });
});
