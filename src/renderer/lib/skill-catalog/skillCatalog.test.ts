/**
 * The generated catalogue under the agent skill, held to the code it is generated from.
 *
 * A failure means a node, a field, a command, a shortcut or a help topic changed and the catalogue
 * did not. Regenerate it with
 *
 *     node node_modules/vitest/vitest.mjs run src/renderer/lib/skill-catalog -u
 *
 * and send the changed files to the NarraLeaf/Skills repository as well: Studio's copy is a mirror.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSkillCatalog, type SkillCatalog } from "./index";

const CATALOG_DIR = path.resolve(__dirname, "../../../../resources/agent/skills/narraleaf-make-game/references/catalog");

function filesOnDisk(dir: string, prefix = ""): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? filesOnDisk(path.join(dir, entry.name), relative) : [relative];
    });
}

let catalog: SkillCatalog;

beforeAll(async () => {
    catalog = await buildSkillCatalog();
}, 300_000);

describe("the skill catalogue", () => {
    it("matches the code it is generated from", async () => {
        for (const [file, text] of catalog) {
            await expect(text).toMatchFileSnapshot(path.join(CATALOG_DIR, file));
        }
    });

    it("has no file the generator no longer writes", () => {
        const stale = filesOnDisk(CATALOG_DIR).filter(file => !catalog.has(file));
        expect(stale).toEqual([]);
    });

    it("names every node page in its index", () => {
        const index = catalog.get("README.md") ?? "";
        const pages = [...catalog.keys()].filter(file => file.startsWith("blueprint-nodes/"));
        expect(pages.length).toBeGreaterThan(10);
        expect(pages.filter(file => !index.includes(`(${file})`))).toEqual([]);
    });
});
