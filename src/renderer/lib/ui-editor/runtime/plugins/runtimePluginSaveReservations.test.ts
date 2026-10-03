/**
 * A save slot a plugin keeps for itself stays off the player's save listing, and stays within the
 * plugin's own reach.
 *
 * The built-in Quick Save is the case that needed it: its one slot sat in `List Saves` beside the
 * player's, so a save screen that drew every listed id drew the quick save as a slot nobody made.
 *
 * Real manifest, real loader, real host controller. What is under test is a chain - the manifest's
 * `contributes.reservedSaveIds`, the loader handing it to the host, the listing `List Saves` returns
 * - and a stand-in at any link would only check the shape this file already declares.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION } from "@shared/types/saveCompatibility";
import { autoSaveSlotId, LOCALE_RESTART_SAVE_ID } from "@shared/types/saves";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import { validatePluginManifest } from "@shared/utils/pluginManifest";
import {
    createQuickSaveBlueprintNodes,
    PLUGIN_ID as QUICK_SAVE_PLUGIN_ID,
    QUICK_SAVE_SLOT_ID,
} from "../../../../../builtin-plugins/quick-save/nodes";
import { listPlayerSaveIds } from "../app/saveLoad";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import { RuntimePluginHostController } from "./runtimePluginHostController";

const QUICK_SAVE_MANIFEST = fileURLToPath(
    new URL("../../../../../builtin-plugins/quick-save/manifest.json", import.meta.url),
);

/** What is on disk: a player's slot, the quick save, and Studio's own two kinds of bookkeeping. */
const STORED_IDS = ["1", QUICK_SAVE_SLOT_ID, autoSaveSlotId(0), LOCALE_RESTART_SAVE_ID];

let tempDir = "";

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-save-reservations-"));
});

afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
});

async function readQuickSaveManifest(): Promise<NormalizedPluginManifestV2> {
    const result = validatePluginManifest(JSON.parse(await fs.readFile(QUICK_SAVE_MANIFEST, "utf-8")));
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.manifest;
}

/**
 * The Quick Save manifest as it ships, behind a runtime entry of `source`.
 *
 * Each test writes its own entry file: the loader caches per id + version + entry URL, so two tests
 * sharing a path would share the first one's outcome.
 */
async function quickSaveDescriptor(fileName: string, source: string): Promise<RuntimePluginDescriptor> {
    const entryPath = path.join(tempDir, fileName);
    await fs.writeFile(entryPath, source, "utf-8");
    const manifest = await readQuickSaveManifest();
    return {
        plugin: { id: manifest.id, name: manifest.name, version: manifest.version },
        manifest,
        entryUrl: pathToFileURL(entryPath).href,
    };
}

/** A shell whose store holds {@link STORED_IDS}, read raw - which is what plugins are handed. */
function shellController(): RuntimePluginHostController {
    return new RuntimePluginHostController({
        saves: {
            listIds: async () => [...STORED_IDS],
            readMetadata: async () => null,
        },
    });
}

/** What `List Saves` answers for the stored slots, given the reservations the controller holds. */
function listSaves(controller: RuntimePluginHostController): string[] {
    return listPlayerSaveIds(STORED_IDS.map(id => ({ id })), {
        pluginReservedSaveIds: controller.reservedSaveIds,
        build: null,
        compatibilityConfig: DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION,
    });
}

const SETUP_NOTHING = "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
    + "export default defineRuntimePlugin({ setup() {} });\n";

describe("the built-in Quick Save's slot", () => {
    it("is declared reserved by the manifest the plugin ships", async () => {
        const manifest = await readQuickSaveManifest();

        expect(manifest.id).toBe(QUICK_SAVE_PLUGIN_ID);
        // The id the nodes write and the id the manifest reserves are two spellings of one slot;
        // if they drift apart the quick save is back on every save screen.
        expect(manifest.contributes.reservedSaveIds).toEqual([QUICK_SAVE_SLOT_ID]);
    });

    it("is left out of List Saves once the game carries the plugin, beside Studio's own bookkeeping", async () => {
        const controller = shellController();
        await loadRuntimePlugins([await quickSaveDescriptor("loads.mjs", SETUP_NOTHING)], {
            log: () => {},
            host: controller.host,
        });

        expect(listSaves(controller)).toEqual(["1"]);
    });

    it("is still found by Has Quick Save, which reads the raw store listing", async () => {
        const controller = shellController();
        await loadRuntimePlugins([await quickSaveDescriptor("has.mjs", SETUP_NOTHING)], {
            log: () => {},
            host: controller.host,
        });
        const has = createQuickSaveBlueprintNodes().find(def => def.type === `${QUICK_SAVE_PLUGIN_ID}.has`);
        if (!has) {
            throw new Error("Has Quick Save is missing");
        }

        // The same backend the loader hands the plugin as `app.game.saves`.
        const result = await has.execute({ game: { saves: controller.host.saves } } as never);

        expect(result).toMatchObject({ outputValues: { hasQuickSave: true } });
    });

    it("stays reserved when the plugin's entry fails to load", async () => {
        // The slot on disk is the plugin's whether or not its code ran this time; a broken entry
        // must not turn the quick save into a mystery slot on the player's save screen.
        const controller = shellController();
        const [result] = await loadRuntimePlugins([
            await quickSaveDescriptor("throws.mjs", "throw new Error('entry failed');\n"),
        ], { log: () => {}, host: controller.host });

        expect(result.ok).toBe(false);
        expect(listSaves(controller)).toEqual(["1"]);
    });

    it("is an ordinary slot to a game that does not carry the plugin", () => {
        // Reservations come from the plugins this game loaded, not from the id's spelling.
        expect(listSaves(shellController())).toEqual(["1", QUICK_SAVE_SLOT_ID]);
    });
});
