import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { loadGameLocalization, resolveStoryDocumentPathForIndexEntry } from "./bundleAssembler";

const STORY_ID = "00000000-0000-4000-8000-000000000001";

describe("bundleAssembler story documents", () => {
    it("derives story document paths from UUID story ids", () => {
        expect(resolveStoryDocumentPathForIndexEntry("/project", {
            id: STORY_ID,
        })).toBe(path.join("/project", "editor", "story", "stories", STORY_ID, "storydoc.json"));
    });

    it("rejects non-UUID story ids before resolving paths", () => {
        expect(resolveStoryDocumentPathForIndexEntry("/project", {
            id: "../outside",
        })).toBeNull();
    });
});

describe("bundleAssembler game localization", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(localization: unknown): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-loc-test-"));
        tempDirs.push(projectPath);
        const encoded = encodeProjectConfig({
            name: "Test",
            identifier: "test.project",
            metadata: {},
            ...(localization ? { app: { localization } } : {}),
        } as never);
        await writeFile(path.join(projectPath, "project.nlproj"), encoded);
        return projectPath;
    }

    it("returns undefined when the project has no localization setup", async () => {
        const projectPath = await createProject(undefined);
        expect(await loadGameLocalization(projectPath)).toBeUndefined();
    });

    it("loads config and per-locale tables, skipping the source locale and empty targets", async () => {
        const projectPath = await createProject({
            sourceLocale: "zh-CN",
            locales: [
                { code: "zh-CN", displayName: "简体中文" },
                { code: "en", displayName: "English" },
                { code: "ja", displayName: "日本語" },
            ],
        });
        const localizationDir = path.join(projectPath, "editor", "localization");
        await mkdir(localizationDir, { recursive: true });
        await writeFile(path.join(localizationDir, "en.json"), JSON.stringify({
            schemaVersion: 1,
            locale: "en",
            units: {
                "text-1": { target: "Hello.", sourceHash: "fnv1a:1", status: "translated" },
                "text-2": { target: "", sourceHash: "fnv1a:2", status: "untranslated" },
            },
        }));
        await writeFile(path.join(localizationDir, "zh-CN.json"), JSON.stringify({
            schemaVersion: 1,
            locale: "zh-CN",
            units: { "text-1": { target: "不应加载（源语言）", sourceHash: "x", status: "translated" } },
        }));

        const bundle = await loadGameLocalization(projectPath);
        expect(bundle?.sourceLocale).toBe("zh-CN");
        expect(bundle?.locales.map(locale => locale.code)).toEqual(["zh-CN", "en", "ja"]);
        expect(bundle?.tables).toEqual({ en: { "text-1": "Hello." } });
    });

    it("degrades a broken translation file to an absent table", async () => {
        const projectPath = await createProject({
            sourceLocale: "zh-CN",
            locales: [
                { code: "zh-CN", displayName: "简体中文" },
                { code: "en", displayName: "English" },
            ],
        });
        const localizationDir = path.join(projectPath, "editor", "localization");
        await mkdir(localizationDir, { recursive: true });
        await writeFile(path.join(localizationDir, "en.json"), "{ not json");

        const bundle = await loadGameLocalization(projectPath);
        expect(bundle?.tables).toEqual({});
    });
});
