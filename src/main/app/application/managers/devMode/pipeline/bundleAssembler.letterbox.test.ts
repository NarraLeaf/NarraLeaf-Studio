import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { collectReferencedAssetIds } from "@shared/build/variantPayload";
import { DEFAULT_LETTERBOX_CONFIGURATION } from "@shared/types/letterbox";
import { loadLetterboxConfiguration } from "./bundleAssembler";

/**
 * The letterbox travels in the bundle, and that is what makes its picture ship: a package carries the
 * library assets its bundle names and no others (`planShippedAssets`), and `.nlproj` is not part of
 * the bundle. These pin both halves - that the setting is read into the bundle, and that a picture
 * named only there is one the package sweep keeps.
 */

const PICTURE = "6f0e8f7c-1d2b-4c3a-9e8f-7a6b5c4d3e2f";
const UNUSED = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";

describe("bundleAssembler letterbox", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(letterbox: unknown): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-letterbox-test-"));
        tempDirs.push(projectPath);
        const encoded = encodeProjectConfig({
            name: "Test",
            identifier: "test.project",
            metadata: {},
            ...(letterbox ? { app: { letterbox } } : {}),
        } as never);
        await writeFile(path.join(projectPath, "project.nlproj"), encoded);
        return projectPath;
    }

    it("gives a project that never opened the setting black bars", async () => {
        const projectPath = await createProject(undefined);
        expect(await loadLetterboxConfiguration(projectPath)).toEqual(DEFAULT_LETTERBOX_CONFIGURATION);
    });

    it("bakes the authored colour and picture", async () => {
        const projectPath = await createProject({ color: "#202830", image: { assetId: PICTURE, fillMode: "stretch" } });
        expect(await loadLetterboxConfiguration(projectPath)).toEqual({
            color: "#202830",
            image: { assetId: PICTURE, fillMode: "stretch" },
        });
    });

    it("falls back to black bars when the project cannot be read", async () => {
        expect(await loadLetterboxConfiguration(path.join(os.tmpdir(), "nls-missing-project")))
            .toEqual(DEFAULT_LETTERBOX_CONFIGURATION);
    });

    it("keeps a picture named only by the letterbox in a package", async () => {
        const projectPath = await createProject({ color: "#000000", image: { assetId: PICTURE, fillMode: "cover" } });
        const letterbox = await loadLetterboxConfiguration(projectPath);
        const shipped = collectReferencedAssetIds(
            { ui: { uidoc: { surfaces: [], elements: {} } }, letterbox },
            new Set([PICTURE, UNUSED]),
        );
        expect([...shipped]).toEqual([PICTURE]);
    });
});
