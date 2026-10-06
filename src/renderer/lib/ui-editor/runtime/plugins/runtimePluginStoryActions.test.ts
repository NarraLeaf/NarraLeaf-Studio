/**
 * `app.game.storyActions` - registering what runs when the story reaches one of a plugin's own rows.
 *
 * The plugins here are real ESM modules loaded through the real loader, for the reason
 * `runtimePluginConfig.test.ts` gives: the ownership rules are a property of the `app` the loader
 * builds per descriptor, and the runner the compiler later calls has to be handed that plugin's own
 * `game`.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import { clearStoryPluginActions, getStoryPluginAction } from "../game/storyPluginActions";

const CAPTURED = "__nlsRuntimePluginStoryActionCapture";

let tempDir = "";

/** Writes a plugin whose setup is `body`, run with `app` in scope. */
async function writePlugin(id: string, body: string): Promise<RuntimePluginDescriptor> {
    const entryPath = path.join(tempDir, `${id}.mjs`);
    await fs.writeFile(
        entryPath,
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
        + `export default defineRuntimePlugin({ setup(app) { ${body} } });\n`,
        "utf-8",
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
            reservedSaveIds: [],
            runtimeData: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [],
            buildDependencies: [],
            buildConfig: [],
            externalLinks: [],
            network: [],
            widgetText: {},
            structs: [],
        },
        permissions: [],
    };
    return {
        plugin: { id, name: id, version: "1.0.0" },
        manifest,
        entryUrl: pathToFileURL(entryPath).href,
    };
}

describe("app.game.storyActions", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-story-actions-"));
        (globalThis as Record<string, unknown>)[CAPTURED] = {};
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        clearStoryPluginActions();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("is there without declaring a capability, and registers a runner bound to the plugin's game", async () => {
        const plugin = await writePlugin(
            "acme.rps",
            `globalThis["${CAPTURED}"].game = app.game;
             app.game.storyActions.register({ id: "acme.rps.play", run: async () => {} });`,
        );

        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });

        expect(result.ok).toBe(true);
        const registered = getStoryPluginAction("acme.rps.play");
        expect(registered?.owner).toBe("acme.rps");
        expect(registered?.game).toBe(((globalThis as unknown as Record<string, Record<string, unknown>>)[CAPTURED]).game);
    });

    it("refuses an id that is not prefixed with the plugin id", async () => {
        const plugin = await writePlugin(
            "acme.rps",
            `app.game.storyActions.register({ id: "rps.play", run: async () => {} });`,
        );

        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });

        expect(result.ok).toBe(false);
        expect(result.ok ? "" : result.error).toContain("prefixed with plugin id");
        expect(getStoryPluginAction("rps.play")).toBeUndefined();
    });

    it("refuses a registration without a run function", async () => {
        const plugin = await writePlugin(
            "acme.rps",
            `app.game.storyActions.register({ id: "acme.rps.play" });`,
        );

        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });

        expect(result.ok).toBe(false);
        expect(getStoryPluginAction("acme.rps.play")).toBeUndefined();
    });
});
