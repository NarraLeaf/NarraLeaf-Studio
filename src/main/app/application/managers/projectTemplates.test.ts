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

    it("reports the languages a template writes its content in", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            // `..` names a directory outside the template; a code that is not a language is not one.
            contentLocales: { zh: { remove: ["editor/localization/zh-CN.json"] }, "../evil": {} },
        }));
        await writeFile(path.join(templatesDir, "plain", "template.json"), JSON.stringify({ name: "Plain" }));

        const [plain, skeleton] = await listProjectTemplates(templatesDir);

        expect(skeleton.contentLocales).toEqual(["zh"]);
        // Absent, not empty: the template says the same thing to everybody.
        expect(plain.contentLocales).toBeUndefined();
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

        expect(await scaffoldProjectFromTemplate(templatesDir, "meta", projectDir))
            .toEqual({ filesCopied: 0, locales: [], dependencies: [] });
    });

    it("hands back the plugin ids the template declares, and drops what is not one", async () => {
        // The project's dependency table is otherwise derived by scanning for types a *loaded*
        // plugin owns, which says nothing about a plugin the author has never switched on. A
        // template that ships graphs built on one declares it here instead.
        await writeFile(path.join(templatesDir, "needs", "content", "keep.txt"), "x");
        await writeFile(
            path.join(templatesDir, "needs", "template.json"),
            JSON.stringify({ name: "Needs", dependencies: ["narraleaf.gallery", "../evil", 7, "narraleaf.gallery"] }),
        );

        const result = await scaffoldProjectFromTemplate(templatesDir, "needs", projectDir);

        expect(result.dependencies).toEqual(["narraleaf.gallery"]);
        expect((await listProjectTemplates(templatesDir)).find(entry => entry.id === "needs")?.dependencies)
            .toEqual(["narraleaf.gallery"]);
    });

    it("reports the languages the template ships a translation for, and only those", async () => {
        const localization = path.join(templatesDir, "spoken", "content", "editor", "localization");
        await writeFile(path.join(localization, "zh-CN.json"), "{}");
        await writeFile(path.join(localization, "ja.json"), "{}");
        // The key catalogue lives beside the translations and is not one of them, and a file whose
        // name does not read as a language belongs to something else entirely.
        await writeFile(path.join(localization, "keys.json"), "{}");
        await writeFile(path.join(localization, "notes.json"), "{}");

        const result = await scaffoldProjectFromTemplate(templatesDir, "spoken", projectDir);

        expect(result.locales).toEqual(["ja", "zh-CN"]);
    });

    it("reports no languages for a template that ships no translations", async () => {
        await writeFile(path.join(templatesDir, "silent", "content", "editor", "story", "index.json"), "{}");

        expect((await scaffoldProjectFromTemplate(templatesDir, "silent", projectDir)).locales).toEqual([]);
    });

    it("hands over the copy written in the author's language, over the base one", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            contentLocales: { zh: { remove: ["editor/localization/zh-CN.json"] } },
        }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "story.json"), '{"line":"You are late."}');
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "localization", "zh-CN.json"), "{}");
        await writeFile(path.join(templatesDir, "skeleton", "content", "assets", "pic.png"), "PNG");
        await writeFile(path.join(templatesDir, "skeleton", "content.zh", "editor", "story.json"), '{"line":"你迟到了。"}');
        await writeFile(path.join(templatesDir, "skeleton", "content.zh", "editor", "localization", "en.json"), "{}");

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir, "zh");

        expect(result.contentLocale).toBe("zh");
        expect(await fs.readFile(path.join(projectDir, "editor", "story.json"), "utf-8")).toBe('{"line":"你迟到了。"}');
        // Structure and assets come from the base tree either way: a variant is the same project
        // said again, not a second one.
        expect(await fs.readFile(path.join(projectDir, "assets", "pic.png"), "utf-8")).toBe("PNG");
        // The language the base was translated INTO is the one the variant is written in, so its
        // translation file leaves with it - and the languages reported are the ones now on disk.
        await expect(fs.stat(path.join(projectDir, "editor", "localization", "zh-CN.json"))).rejects.toThrow();
        expect(result.locales).toEqual(["en"]);
    });

    it("matches a variant on the language, not on the exact code", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            contentLocales: { zh: {} },
        }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "story.json"), '{"line":"en"}');
        await writeFile(path.join(templatesDir, "skeleton", "content.zh", "editor", "story.json"), '{"line":"zh"}');

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir, "zh-CN");

        expect(result.contentLocale).toBe("zh");
        expect(await fs.readFile(path.join(projectDir, "editor", "story.json"), "utf-8")).toBe('{"line":"zh"}');
    });

    it("gives the base content to an author whose language the template does not write", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            contentLocales: { zh: {} },
        }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "story.json"), '{"line":"en"}');
        await writeFile(path.join(templatesDir, "skeleton", "content.zh", "editor", "story.json"), '{"line":"zh"}');

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir, "ko");

        expect(result.contentLocale).toBeUndefined();
        expect(await fs.readFile(path.join(projectDir, "editor", "story.json"), "utf-8")).toBe('{"line":"en"}');
    });

    it("ignores a variant directory the manifest does not declare", async () => {
        // The declaration is the offer; a directory somebody left behind is not one.
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({ name: "Skeleton" }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "story.json"), '{"line":"en"}');
        await writeFile(path.join(templatesDir, "skeleton", "content.zh", "editor", "story.json"), '{"line":"zh"}');

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir, "zh");

        expect(result.contentLocale).toBeUndefined();
        expect(await fs.readFile(path.join(projectDir, "editor", "story.json"), "utf-8")).toBe('{"line":"en"}');
    });

    it("keeps the base content when a declared variant is not there", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            contentLocales: { zh: {} },
        }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "story.json"), '{"line":"en"}');

        // A build that lost the directory costs the author a language, never the project.
        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir, "zh");

        expect(result.contentLocale).toBeUndefined();
        expect(result.filesCopied).toBe(1);
    });

    it("refuses to remove anything outside the project", async () => {
        await writeFile(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({
            name: "Skeleton",
            contentLocales: { zh: { remove: ["../outside.txt", "/etc/hosts", "editor/gone.json"] } },
        }));
        await writeFile(path.join(templatesDir, "skeleton", "content", "editor", "gone.json"), "{}");
        await writeFile(path.join(templatesDir, "skeleton", "content.zh", "editor", "kept.json"), "{}");
        await writeFile(path.join(root, "outside.txt"), "not the project's");

        await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir, "zh");

        expect(await fs.readFile(path.join(root, "outside.txt"), "utf-8")).toBe("not the project's");
        await expect(fs.stat(path.join(projectDir, "editor", "gone.json"))).rejects.toThrow();
    });

    it("refuses an id that would read outside the templates directory", async () => {
        await writeFile(path.join(root, "secrets", "content", "key.txt"), "secret");

        await expect(scaffoldProjectFromTemplate(templatesDir, "../secrets", projectDir))
            .rejects.toThrow(/Unsafe project template id/);
        await expect(scaffoldProjectFromTemplate(templatesDir, "..", projectDir))
            .rejects.toThrow(/Unsafe project template id/);
    });
});
