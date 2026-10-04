import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { LocalizationUnit } from "@shared/types/localization";
import { applyUITextLocaleEdits, migrateUITextSourcesV13 } from "@shared/types/ui-editor/textSourceMigration";
import { assembleDevModeBundleFromProjectPath } from "./bundleAssembler";

/**
 * A project nobody has opened since its interface document went to v13.
 *
 * A build machine, or an author running the command-line build after upgrading, packages a project
 * whose `uidoc.json` is still v12. The package has to be the one the project builds after Studio has
 * opened it and written the v13 document and the translation edits that come with it - so the same
 * project is assembled both ways here and the two interface payloads compared.
 */
describe("bundleAssembler interface document older than v13", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    const unit = (target: string): LocalizationUnit => ({ target, sourceHash: `fnv1a:${target.length}`, status: "translated" });

    async function createV12Project(): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-v12-bundle-"));
        tempDirs.push(projectPath);
        await writeFile(
            path.join(projectPath, "project.nlproj"),
            encodeProjectConfig({
                name: "Test",
                identifier: "test.project",
                metadata: {},
                app: {
                    localization: {
                        sourceLocale: "en",
                        locales: [
                            { code: "en", displayName: "English" },
                            { code: "zh-CN", displayName: "简体中文" },
                            { code: "ja", displayName: "日本語" },
                        ],
                    },
                },
            } as never),
        );
        for (const dir of ["ui", "story", "localization"]) {
            await mkdir(path.join(projectPath, "editor", dir), { recursive: true });
        }
        const layout = { x: 0, y: 0, width: 100, height: 20 };
        const widget = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
            id, type, name: id, parentId: "root", childrenIds: [], layout, props, ...extra,
        });
        const ids = ["start", "marked", "continue", "title", "stale", "bound"];
        await writeFile(path.join(projectPath, "editor", "ui", "uidoc.json"), JSON.stringify({
            schemaVersion: 12,
            id: "doc",
            name: "UI",
            surfaces: [{
                id: "title-page",
                name: "Title",
                host: "app",
                kind: "appSurface",
                designSize: { width: 100, height: 100 },
                rootElementId: "root",
            }],
            elements: {
                root: { id: "root", type: "nl.root", parentId: null, childrenIds: ids, layout },
                start: widget("start", "nl.button", { label: "Start", localizationKey: "menu.start" }),
                marked: widget("marked", "nl.text", {
                    text: "Start",
                    localizationKey: "menu.start",
                    rich: [{ text: "Start", marks: { bold: true } }],
                }),
                continue: widget("continue", "nl.button", { label: "Continue", localizationKey: "menu.continue" }),
                title: widget("title", "nl.text", { text: "Your Game", localizable: true }),
                stale: widget("stale", "nl.text", { text: "Credits" }),
                bound: widget("bound", "nl.text", { text: "Start", localizationKey: "menu.start" }, {
                    valueBindings: { text: { kind: "blueprintValue", blueprintId: "bp-value", valueType: "string" } },
                }),
            },
        }), "utf-8");
        await writeFile(path.join(projectPath, "editor", "ui", "uigraphs.json"), JSON.stringify({
            schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {} },
        }), "utf-8");
        await writeFile(
            path.join(projectPath, "editor", "story", "index.json"),
            JSON.stringify({ schemaVersion: 1, stories: [] }),
            "utf-8",
        );
        await writeFile(path.join(projectPath, "editor", "localization", "keys.json"), JSON.stringify({
            schemaVersion: 1,
            keys: { "menu.start": { sourceText: "Start" } },
        }), "utf-8");
        await writeFile(path.join(projectPath, "editor", "localization", "zh-CN.json"), JSON.stringify({
            schemaVersion: 1,
            locale: "zh-CN",
            units: {
                "key:menu.start": unit("开始"),
                // The key is gone from the registry; the game still read this for it.
                "key:menu.continue": unit("继续"),
                "ui:title.text": unit("你的游戏"),
                // Words that were never translated, with a translation left behind.
                "ui:stale.text": unit("制作人员"),
            },
        }), "utf-8");
        await writeFile(path.join(projectPath, "editor", "localization", "ja.json"), JSON.stringify({
            schemaVersion: 1,
            locale: "ja",
            units: { "key:menu.start": unit("スタート"), "ui:marked.text": unit("古い") },
        }), "utf-8");
        return projectPath;
    }

    /** What opening the project in Studio writes: the v13 document, and the translation edits. */
    async function openInStudio(projectPath: string): Promise<void> {
        const read = async (relative: string) => JSON.parse(await readFile(path.join(projectPath, relative), "utf-8"));
        const document = await read("editor/ui/uidoc.json");
        const keys = (await read("editor/localization/keys.json")).keys as Record<string, { sourceText: string }>;
        const translations: Record<string, Record<string, LocalizationUnit>> = {
            "zh-CN": (await read("editor/localization/zh-CN.json")).units,
            ja: (await read("editor/localization/ja.json")).units,
        };
        const result = migrateUITextSourcesV13(document, {
            keys: Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, key.sourceText])),
            sourceLocale: "en",
            translations,
        });
        await writeFile(path.join(projectPath, "editor", "ui", "uidoc.json"), JSON.stringify(result.document), "utf-8");
        for (const [locale, units] of Object.entries(applyUITextLocaleEdits(translations, result.localeEdits))) {
            await writeFile(
                path.join(projectPath, "editor", "localization", `${locale}.json`),
                JSON.stringify({ schemaVersion: 1, locale, units }),
                "utf-8",
            );
        }
    }

    it("packages a v12 project as it packages the same project once Studio has opened it", async () => {
        const projectPath = await createV12Project();
        const fromDisk = await assembleDevModeBundleFromProjectPath({ projectPath, bundleId: "b", revision: 1 });
        await openInStudio(projectPath);
        const afterOpen = await assembleDevModeBundleFromProjectPath({ projectPath, bundleId: "b", revision: 1 });

        expect(fromDisk.ui.uidoc).toEqual(afterOpen.ui.uidoc);
        expect(fromDisk.localization).toEqual(afterOpen.localization);
        // And it is the v13 one: no copy under a key, no switch, nothing left behind.
        expect(fromDisk.ui.uidoc.schemaVersion).toBe(13);
        expect(fromDisk.ui.uidoc.elements.start.props).toEqual({ localizationKey: "menu.start" });
        expect(fromDisk.ui.uidoc.elements.continue.props).toEqual({ label: "Continue" });
        expect(fromDisk.ui.uidoc.elements.bound.valueBindings).toBeUndefined();
        expect(fromDisk.localization?.tables["zh-CN"]).toEqual({
            "key:menu.start": "开始",
            "key:menu.continue": "继续",
            "ui:continue.label": "继续",
            "ui:marked.text": "开始",
            "ui:title.text": "你的游戏",
        });
        expect(fromDisk.localization?.tables.ja).toEqual({ "key:menu.start": "スタート", "ui:marked.text": "スタート" });
    });

    it("ships the keys of a project without a source language, and nothing else", async () => {
        const projectPath = await createV12Project();
        await writeFile(
            path.join(projectPath, "project.nlproj"),
            encodeProjectConfig({ name: "Test", identifier: "test.project", metadata: {} } as never),
        );
        const bundle = await assembleDevModeBundleFromProjectPath({ projectPath, bundleId: "b", revision: 1 });
        expect(bundle.localization).toEqual({ sourceLocale: "", locales: [], tables: {}, keys: { "menu.start": "Start" } });
        // The game showed the button's own words; they equal the key's, which shows the same.
        expect(bundle.ui.uidoc.elements.start.props).toEqual({ localizationKey: "menu.start" });
    });
});
