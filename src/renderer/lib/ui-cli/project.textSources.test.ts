import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { assertWritableSchema, ProjectIoError, readUiDocument } from "./project";

/**
 * `ui.js` meeting a project whose interface document is still v12: it reads it as Studio will once the
 * project is opened, and refuses to write it, because the step that brings it to v13 also edits the
 * translation files - which is Studio's to do.
 */
describe("ui.js reading an interface document older than v13", () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function project(sourceLocale: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-ui-cli-v12-"));
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, "project.nlproj"), encodeProjectConfig({
            name: "Test",
            identifier: "test.project",
            metadata: {},
            app: sourceLocale
                ? { localization: { sourceLocale, locales: [{ code: sourceLocale, displayName: sourceLocale }] } }
                : {},
        } as never));
        fs.mkdirSync(path.join(dir, "editor", "ui"), { recursive: true });
        fs.mkdirSync(path.join(dir, "editor", "localization"), { recursive: true });
        fs.writeFileSync(path.join(dir, "editor", "localization", "keys.json"), JSON.stringify({
            schemaVersion: 1,
            keys: { "menu.start": { sourceText: "Start" } },
        }));
        const layout = { x: 0, y: 0, width: 10, height: 10 };
        fs.writeFileSync(path.join(dir, "editor", "ui", "uidoc.json"), JSON.stringify({
            schemaVersion: 12,
            id: "doc",
            name: "UI",
            surfaces: [],
            elements: {
                start: { id: "start", type: "nl.button", parentId: null, childrenIds: [], layout, props: { label: "Begin", localizationKey: "menu.start" } },
                title: { id: "title", type: "nl.text", parentId: null, childrenIds: [], layout, props: { text: "Your Game", localizable: true } },
            },
        }));
        return dir;
    }

    it("reads it as v13, against the project's keys and source language", () => {
        const withSource = readUiDocument(project("en"));
        expect(withSource.migratedFrom).toBe(12);
        expect(withSource.document.schemaVersion).toBe(13);
        expect(withSource.document.elements.start.props).toEqual({ localizationKey: "menu.start" });
        expect(withSource.document.elements.title.props).toEqual({ text: "Your Game" });

        // Without a source language the game showed the button's own words, which differ from the key's.
        const withoutSource = readUiDocument(project(""));
        expect(withoutSource.document.elements.start.props).toEqual({ label: "Begin" });
    });

    it("refuses to write it back", () => {
        expect(() => assertWritableSchema(readUiDocument(project("en")))).toThrow(ProjectIoError);
        expect(() => assertWritableSchema(readUiDocument(project("en")))).toThrow(/Open the project in Studio once/);
    });
});
