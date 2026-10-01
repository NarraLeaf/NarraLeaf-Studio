import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/*
 * Studio's version is written into four manifests, and they move together:
 *
 *  - the root package.json, after which electron-builder names the installers and the update feed,
 *    and which a release tag must match;
 *  - src/main/package.json and src/renderer/apps/package.json, the workspaces that carry it too;
 *  - packages/plugin-types/package.json, the `narraleaf-studio` types package. It is published under
 *    Studio's own version, so that a plugin's devDependency range says which Studio the plugin was
 *    written against, and the release workflow publishes it from the tag - a manifest left behind
 *    here would put the wrong declarations on npm under a number that looks right.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const MANIFESTS = [
    "package.json",
    "src/main/package.json",
    "src/renderer/apps/package.json",
    "packages/plugin-types/package.json",
];

function versionIn(manifest: string): string {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, manifest), "utf8")).version;
}

describe("Studio's version", () => {
    it("is the same number in every manifest that carries it, the plugin types package included", () => {
        const studio = versionIn("package.json");
        expect(MANIFESTS.map(manifest => ({ manifest, version: versionIn(manifest) })))
            .toEqual(MANIFESTS.map(manifest => ({ manifest, version: studio })));
    });
});
