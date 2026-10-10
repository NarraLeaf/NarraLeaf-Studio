import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeProjectConfig } from "@shared/utils/nlproj";
import { NEW_PROJECT_DIRECTORIES } from "@shared/project/newProject";
import { suggestAppId, writeAgentProject, type InstalledPluginInfo } from "./agentProjectCreate";

describe("writeAgentProject", () => {
    let root: string;
    let templatesDir: string;
    let parentDir: string;
    const plugins = async (): Promise<InstalledPluginInfo[]> => [
        { pluginId: "narraleaf.gallery", builtIn: true, manifest: { name: "Gallery", publisher: "NarraLeaf", version: "1.2.3" } },
    ];

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-create-"));
        templatesDir = path.join(root, "templates");
        parentDir = path.join(root, "projects");
        const skeleton = path.join(templatesDir, "skeleton");
        fs.mkdirSync(path.join(skeleton, "content", "editor", "localization"), { recursive: true });
        fs.writeFileSync(path.join(skeleton, "template.json"), JSON.stringify({
            name: "Skeleton",
            designSize: { width: 1920, height: 1080 },
            dependencies: ["narraleaf.gallery"],
        }));
        fs.writeFileSync(path.join(skeleton, "content", "editor", "marker.json"), "{\"from\":\"template\"}");
        fs.writeFileSync(path.join(skeleton, "content", "editor", "localization", "ja.json"), "{}");
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const input = (overrides = {}) => ({
        name: "Ghost Story",
        parentDir,
        template: "skeleton" as const,
        language: "en",
        width: 1920,
        height: 1080,
        ...overrides,
    });

    it("writes the skeleton, the config and the template's content, in <parent>/<app id>", async () => {
        const result = await writeAgentProject(input(), { templatesDir, installedPlugins: plugins, createId: () => "id" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.projectPath).toBe(path.join(parentDir, "ghost-story"));
        for (const directory of NEW_PROJECT_DIRECTORIES) {
            expect(fs.statSync(path.join(result.projectPath, ...directory)).isDirectory()).toBe(true);
        }
        expect(fs.readFileSync(path.join(result.projectPath, "editor", "marker.json"), "utf8")).toContain("template");
        const configFile = fs.readdirSync(result.projectPath).find(name => name.endsWith(".nlproj"))!;
        const config = decodeProjectConfig(fs.readFileSync(path.join(result.projectPath, configFile)));
        expect(config).toMatchObject({
            name: "Ghost Story",
            identifier: "ghost-story",
            metadata: { version: "1.0.0", resolution: { width: 1920, height: 1080 } },
        });
        const app = config.app as Record<string, any>;
        expect(app.localization.sourceLocale).toBe("en");
        // The translation the template shipped is registered as a language of the project.
        expect(app.localization.locales.map((entry: { code: string }) => entry.code)).toEqual(["en", "ja"]);
        expect(app.mobile.orientation).toBe("landscape");
        expect(config.dependencies?.plugins).toEqual([
            expect.objectContaining({ id: "narraleaf.gallery", builtIn: true, authoredVersion: "1.2.3", hard: true }),
        ]);
    });

    it("refuses a size the template was not drawn for", async () => {
        const result = await writeAgentProject(input({ width: 1280, height: 720 }), { templatesDir, installedPlugins: plugins });
        expect(result).toMatchObject({ ok: false, code: "invalid_args" });
        expect(fs.existsSync(parentDir)).toBe(false);
    });

    it("accepts any size for the empty template and writes no template content", async () => {
        const result = await writeAgentProject(input({ template: "empty", width: 1080, height: 1920 }), { templatesDir, installedPlugins: plugins });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(fs.existsSync(path.join(result.projectPath, "editor", "marker.json"))).toBe(false);
        expect(fs.existsSync(path.join(result.projectPath, "editor", "ui", "uidoc.json"))).toBe(true);
    });

    it("never writes into a directory that already has something in it", async () => {
        fs.mkdirSync(path.join(parentDir, "ghost-story"), { recursive: true });
        fs.writeFileSync(path.join(parentDir, "ghost-story", "keep.txt"), "mine");
        const result = await writeAgentProject(input(), { templatesDir, installedPlugins: plugins });
        expect(result).toMatchObject({ ok: false, code: "unavailable" });
        expect(fs.readdirSync(path.join(parentDir, "ghost-story"))).toEqual(["keep.txt"]);
    });

    it("refuses a relative parent directory", async () => {
        const result = await writeAgentProject(input({ parentDir: "projects" }), { templatesDir, installedPlugins: plugins });
        expect(result).toMatchObject({ ok: false, code: "invalid_args" });
    });

    it("derives an app id the way the wizard does, with a fallback for names that romanize to nothing", () => {
        expect(suggestAppId("My  Game!")).toBe("my-game");
        expect(suggestAppId("小小的身影")).toMatch(/^[a-z0-9-]+$/);
        expect(suggestAppId("!!!")).toMatch(/^game-[0-9a-f]{6}$/);
    });
});
