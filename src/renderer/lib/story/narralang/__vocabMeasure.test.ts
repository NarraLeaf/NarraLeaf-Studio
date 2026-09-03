import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { printNarralangScene, type NarralangLookups } from "./narralangPrinter";
import { readProjectData, listStories, readStoryDocument, buildContext, orderedScenes } from "@/lib/story-cli/project";
import { buildLookups } from "@/lib/story-cli/lookups";

const PROJECT = process.env.MEASURE_PROJECT ?? "D:/tmp/ts-vocab";

describe("narralang coverage measurement", () => {
    it("counts issues by reason over the whole project", () => {
        expect(fs.existsSync(path.join(PROJECT, "editor"))).toBe(true);
        const data = readProjectData(PROJECT);
        const stories = listStories(PROJECT);
        const byReason = new Map<string, number>();
        const rowsWithIssue = new Set<string>();
        let scenes = 0;
        let cleanScenes = 0;
        let rows = 0;
        for (const summary of stories) {
            const file = readStoryDocument(PROJECT, summary.id);
            const document = file.document;
            for (const scene of orderedScenes(document)) {
                scenes += 1;
                rows += Object.keys(scene.blocks).length;
                const context = buildContext(data, document, scene);
                const lookups = buildLookups(data, document, scene, context).rowLookups as NarralangLookups;
                const result = printNarralangScene(scene, lookups);
                if (result.issues.length === 0) {
                    cleanScenes += 1;
                }
                for (const issue of result.issues) {
                    byReason.set(issue.reason, (byReason.get(issue.reason) ?? 0) + 1);
                    rowsWithIssue.add(`${scene.id}:${issue.blockId}`);
                }
            }
        }
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
            stories: stories.length,
            scenes,
            cleanScenes,
            rows,
            rowsWithIssue: rowsWithIssue.size,
            byReason: Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1])),
        }, null, 2));
        expect(scenes).toBeGreaterThan(0);
    });
});
