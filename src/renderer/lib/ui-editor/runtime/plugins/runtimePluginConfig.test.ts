/**
 * `app.game.config` - what a plugin's runtime can read of the build configuration its author filled
 * in, and what it cannot: another plugin's values, a field its manifest never declared, and the
 * secret whose value never left the machine that typed it.
 *
 * The plugins here are real ESM modules loaded through the real loader, because the isolation being
 * checked is a property of how the loader builds one `app` per descriptor. A test that called the
 * reader directly would be checking a function nobody hands a plugin.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  NormalizedPluginManifestV2,
  PluginBuildConfigFieldContribution,
  RuntimePluginDescriptor
} from "@shared/types/plugins";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimePluginGame } from "./runtimePluginApi";

const CAPTURED = "__nlsRuntimePluginConfigCapture";

type Captured = Record<string, RuntimePluginGame>;

let tempDir = "";

function captured(): Captured {
  return (globalThis as Record<string, unknown>)[CAPTURED] as Captured;
}

/** Writes a plugin whose whole runtime is "hand my `app.game` back to the test". */
async function writePlugin(
  id: string,
  buildConfig: PluginBuildConfigFieldContribution[],
  values?: Record<string, string>
): Promise<RuntimePluginDescriptor> {
  const entryPath = path.join(tempDir, `${id}.mjs`);
  await fs.writeFile(
    entryPath,
    "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n" +
      `export default defineRuntimePlugin({ setup(app) { globalThis["${CAPTURED}"][app.plugin.id] = app.game; } });\n`,
    "utf-8"
  );
  const manifest: NormalizedPluginManifestV2 = {
    manifestVersion: 2,
    id,
    name: id,
    version: "1.0.0",
    entries: { runtime: `${id}.mjs` },
    contributes: {
      blueprintNodes: [],
      widgets: [],
      tests: [],
      runtimeData: [],
      locales: [],
      runtimeCapabilities: [],
      sidecars: [],
      buildDependencies: [],
      buildConfig,
      externalLinks: [],
      network: []
    },
    permissions: []
  };
  return {
    plugin: { id, name: id, version: "1.0.0" },
    manifest,
    entryUrl: pathToFileURL(entryPath).href,
    ...(values ? { buildConfig: values } : {})
  };
}

const textField = (key: string): PluginBuildConfigFieldContribution => ({
  key,
  label: key,
  type: "text",
  scope: "global"
});

describe("app.game.config", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-config-"));
    (globalThis as Record<string, unknown>)[CAPTURED] = {};
  });

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>)[CAPTURED];
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads the values of the plugin it belongs to and no other's", async () => {
    const steam = await writePlugin("acme.steam", [textField("appId")], { appId: "480" });
    const itch = await writePlugin("acme.itch", [textField("appId")], {
      appId: "not-the-steam-one"
    });

    const results = await loadRuntimePlugins([steam, itch], { log: () => {} });

    expect(results.every((result) => result.ok)).toBe(true);
    expect(captured()["acme.steam"].config.get("appId")).toBe("480");
    // Both plugins declare a field called `appId`. Each one's is its own: the record a plugin
    // reads is the entry it was loaded from, so there is no key that names the other's value.
    expect(captured()["acme.itch"].config.get("appId")).toBe("not-the-steam-one");
  });

  it("answers nothing for a field the manifest never declared", async () => {
    const plugin = await writePlugin("acme.undeclared", [textField("appId")], {
      appId: "480",
      sneaked: "in"
    });
    const lines: string[] = [];

    await loadRuntimePlugins([plugin], { log: (_level, message) => lines.push(message) });

    expect(captured()["acme.undeclared"].config.get("sneaked")).toBeNull();
    expect(lines.some((line) => line.includes("contributes.buildConfig"))).toBe(true);
  });

  it("answers nothing for a secret field, which no build carries a value for", async () => {
    const plugin = await writePlugin("acme.secret", [
      { key: "buildToken", label: "Build token", type: "secret", scope: "variant" }
    ]);

    await loadRuntimePlugins([plugin], { log: () => {} });

    expect(captured()["acme.secret"].config.get("buildToken")).toBeNull();
  });

  it("answers nothing outside a build, where no variant resolved a value", async () => {
    const plugin = await writePlugin("acme.unbuilt", [textField("appId")]);

    await loadRuntimePlugins([plugin], { log: () => {} });

    expect(captured()["acme.unbuilt"].config.get("appId")).toBeNull();
    expect(captured()["acme.unbuilt"].config.get("")).toBeNull();
  });
});
