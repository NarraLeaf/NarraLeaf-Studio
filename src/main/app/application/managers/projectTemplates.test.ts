import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { listProjectTemplates, scaffoldProjectFromTemplate } from "./projectTemplates";

let root: string;
let templatesDir: string;
let projectDir: string;

async function writeFile(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-project-templates-"));
    templatesDir = path.join(root, "templates");
    projectDir = path.join(root, "project");
    await fs.mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("listProjectTemplates", () => {
    it("returns nothing when the build ships no templates directory", async () => {
        expect(await listProjectTemplates(path.join(root, "absent"))).toEqual([]);
    });

    it("reads a manifest, including its per-locale wording", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            description: "A small playable story.",
            version: "1.0.0",
            designSize: { width: 1920, height: 1080 },
            locales: { zh: { name: "骨架", description: "一个可以直接跑的小故事" } },
        }));

        const [template] = await listProjectTemplates(templatesDir);

        expect(template.id).toBe("skeleton");
        expect(template.name).toBe("Skeleton");
        expect(template.designSize).toEqual({ width: 1920, height: 1080 });
        expect(template.locales.zh?.name).toBe("骨架");
    });

    it("drops a malformed template rather than the whole list", async () => {
        await writeFile(path.join(templatesDir, "broken", "template.json"), "{ not json");
        await writeFile(path.join(templatesDir, "nameless", "template.json"), JSON.stringify({ version: "1" }));
        await writeFile(path.join(templatesDir, "good", "template.json"), JSON.stringify({ name: "Good" }));

        expect((await listProjectTemplates(templatesDir)).map(t => t.id)).toEqual(["good"]);
    });
});

describe("scaffoldProjectFromTemplate", () => {
    it("copies the content tree over the project, nested directories included", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({ name: "Skeleton" }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "ui", "uidoc.json"), '{"authored":true}');
        await writeFile(path.join(templatesDir, "skeleton", "content", "assets", "content", "ab", "pic.png"), "PNG");
        // The generated skeleton's empty default, which the template must replace.
        await writeFile(path.join(projectDir, "editor", "ui", "uidoc.json"), '{"authored":false}');

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir);

        expect(result.filesCopied).toBe(2);
        expect(await fs.readFile(path.join(projectDir, "editor", "ui", "uidoc.json"), "utf-8")).toBe('{"authored":true}');
        expect(await fs.readFile(path.join(projectDir, "assets", "content", "ab", "pic.png"), "utf-8")).toBe("PNG");
    });

    it("never copies a project config, which is generated per project", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({ name: "Skeleton" }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "Template.nlproj"), "template config");
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "keep.json"), "{}");
        await writeFile(path.join(projectDir, "MyGame.nlproj"), "the author's own");

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir);

        // Copying one would have added a second config named after the template, and
        // the project would open under the wrong name.
        expect(result.filesCopied).toBe(1);
        await expect(fs.stat(path.join(projectDir, "Template.nlproj"))).rejects.toThrow();
        expect(await fs.readFile(path.join(projectDir, "MyGame.nlproj"), "utf-8")).toBe("the author's own");
    });

    it("produces a plain project for a manifest-only template", async () => {
        await writeFile(path.join(templatesDir, "meta", "template.json"), JSON.stringify({ name: "Meta" }));

        expect(await scaffoldProjectFromTemplate(templatesDir, "meta", projectDir)).toEqual({ filesCopied: 0 });
    });

    it("refuses an id that would read outside the templates directory", async () => {
        await writeFile(path.join(root, "secrets", "content", "key.txt"), "secret");

        await expect(scaffoldProjectFromTemplate(templatesDir, "../secrets", projectDir))
            .rejects.toThrow(/Unsafe project template id/);
        await expect(scaffoldProjectFromTemplate(templatesDir, "..", projectDir))
            .rejects.toThrow(/Unsafe project template id/);
    });
});
