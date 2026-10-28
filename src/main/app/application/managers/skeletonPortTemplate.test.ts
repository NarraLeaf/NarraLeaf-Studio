import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listProjectTemplates } from "./projectTemplates";

const TEMPLATES_DIR = path.resolve(__dirname, "../../../../../resources/templates");

/**
 * `skeleton-port` is the skeleton's working screens without its sample game, for a port to start
 * from. It is generated from the skeleton by `scripts/gen-skeleton-port.mjs`, and this is what keeps
 * it from falling behind: the skeleton changes often, and a copy that missed a change would hand a
 * port screens the skeleton has already fixed.
 *
 * Run `node scripts/gen-skeleton-port.mjs` to make it pass again after changing the skeleton (after
 * `gen-skeleton-locale.mjs`, whose trees it reads).
 */
describe("the skeleton-port template", () => {
    it("is what the generator produces from the skeleton", () => {
        const script = path.resolve(__dirname, "../../../../../scripts/gen-skeleton-port.mjs");

        expect(() => execFileSync(process.execPath, [script, "--check"], { encoding: "utf-8", stdio: "pipe" }))
            .not.toThrow();
    });

    it("is offered beside the skeleton, at the skeleton's size and with its plugin", async () => {
        const templates = await listProjectTemplates(TEMPLATES_DIR);
        const skeleton = templates.find(entry => entry.id === "skeleton");
        const port = templates.find(entry => entry.id === "skeleton-port");

        expect(port).toBeDefined();
        expect(port!.designSize).toEqual(skeleton!.designSize);
        expect(port!.dependencies).toEqual(skeleton!.dependencies);
        expect(port!.contentLocales).toEqual(skeleton!.contentLocales);
    });

    it.each(["content", "content.zh", "content.ja"])("carries no sample story, characters or art in %s", tree => {
        const dir = path.join(TEMPLATES_DIR, "skeleton-port", tree);
        const read = (relative: string) => JSON.parse(fs.readFileSync(path.join(dir, relative), "utf-8"));

        const index = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, "skeleton-port/content/editor/story/index.json"), "utf-8"));
        const story = read(index.stories[0].documentPath);
        const scenes = Object.values(story.scenes) as { id: string; blocks: object; defaultBackgroundAssetId?: string }[];
        expect(scenes.map(scene => scene.id)).toEqual([story.entrySceneId]);
        expect(scenes[0].blocks).toEqual({});
        expect(scenes[0].defaultBackgroundAssetId).toBeUndefined();
        expect(read("editor/services/character.json").characters).toEqual([]);
    });
});
