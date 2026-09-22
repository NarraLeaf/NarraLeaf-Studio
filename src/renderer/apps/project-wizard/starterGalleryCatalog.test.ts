/**
 * The starter template ships the Gallery catalog its EXTRA screen reads, empty.
 *
 * The template declares the Gallery plugin as a dependency and its EXTRA screen runs the plugin's
 * nodes the moment the screen opens. The catalog those nodes read is a file the Gallery panel writes
 * the first time the author edits it - so without one in the template, every new project told its
 * author "No gallery catalog was published with this game" on the first visit to the screen, about a
 * gallery they had not been asked to fill yet. The plugin is right to say that about a build that
 * lost its catalog; a new project has not lost anything.
 *
 * Shipped in the settled shape, so the panel reading it has nothing to normalise and nothing to write
 * back: a new project under version control must not start with a change nobody made.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pluginStoreNamespace } from "@shared/utils/pluginStorage";
import { GALLERY_STORE_NAMESPACE, PLUGIN_ID, normalizeGalleryStore } from "../../../builtin-plugins/gallery/catalog";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");

describe("the starter template's gallery catalog", () => {
    it("is shipped under the name the plugin's runtime data is published from", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "template.json"), "utf-8")) as {
            dependencies?: string[];
        };
        expect(manifest.dependencies).toContain(PLUGIN_ID);

        const file = path.join(
            TEMPLATE,
            "content/editor/services",
            `${pluginStoreNamespace(PLUGIN_ID, GALLERY_STORE_NAMESPACE)}.json`,
        );
        expect(fs.existsSync(file)).toBe(true);
    });

    it("is empty, and already in the shape the panel would normalise it into", () => {
        const file = path.join(
            TEMPLATE,
            "content/editor/services",
            `${pluginStoreNamespace(PLUGIN_ID, GALLERY_STORE_NAMESPACE)}.json`,
        );
        const shipped = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
        const settled = normalizeGalleryStore(shipped);

        expect(settled.items).toEqual([]);
        expect(settled.groups).toEqual([]);
        expect(shipped).toEqual(settled);
    });
});
