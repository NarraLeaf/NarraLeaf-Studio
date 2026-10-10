/**
 * The agent core says what the command lines say.
 *
 * The core's promise is that Studio's agent bridge and `project/app/{ui,story,blueprint}.js` answer
 * with the same text, because the format guides quote that text. So each check here runs a command
 * line over the shipped skeleton project and the matching core call over the same documents - parsed
 * here from the JSON files and fed through the core's own context builders, the way the bridge feeds
 * them from services - and holds the two outputs equal.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { registerBuiltInPluginBlueprintNodes } from "@/lib/blueprint-cli/builtinPluginNodes";
import { runCli as runUiCli } from "@/lib/ui-cli/cli";
import { runCli as runStoryCli } from "@/lib/story-cli/cli";
import { runCli as runBlueprintCli } from "@/lib/blueprint-cli/cli";
import {
    applyStorySource,
    applyUiSource,
    blueprintListCommand,
    blueprintShowCommand,
    buildBlueprintProjectContext,
    buildStoryProjectContext,
    checkBlueprintProjectText,
    checkUiProjectText,
    publishPageParams,
    publishSaveSchema,
    readableBlueprintDocument,
    readableStoryDocument,
    resolveStory,
    showStoryScene,
    showUi,
    storyScenesCommand,
    storySummariesOf,
    storyTargetsCommand,
    uiSurfacesCommand,
    uiProjectInputOf,
    type StoryAgentContext,
    type UiAgentContext,
} from "./index";

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

function readJson<T>(relative: string): T | null {
    const file = path.join(SKELETON, relative);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

function runSync(run: (argv: string[], io: { out: (t: string) => void; err: (t: string) => void }) => number, argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = run(argv, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out, err };
}

async function runStory(argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runStoryCli(argv, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out, err };
}

let scratch = "";
const uiDocument = () => readJson<UIDocument>("editor/ui/uidoc.json") as UIDocument;
const blueprintDocument = () =>
    readableBlueprintDocument((readJson<{ blueprintDocument: BlueprintDocument }>("editor/ui/uigraphs.json") as { blueprintDocument: BlueprintDocument }).blueprintDocument);

function uiContext(): UiAgentContext {
    return { document: uiDocument(), blueprintDocument: blueprintDocument(), textKeys: null };
}

function storyContext(): StoryAgentContext {
    const summaries = storySummariesOf(readJson("editor/story/index.json"));
    const assets: Record<string, Record<string, never>> = {};
    for (const file of fs.readdirSync(path.join(SKELETON, "assets"))) {
        const match = /^assets\.metadata\.(.+)\.json$/.exec(file);
        if (match) {
            assets[match[1]] = readJson(`assets/${file}`) ?? {};
        }
    }
    return {
        data: buildStoryProjectContext({
            assets,
            characters: readJson<{ characters?: never[] }>("editor/services/character.json")?.characters ?? [],
            variableRegistry: readJson("editor/variables.json"),
            blueprintDocument: blueprintDocument(),
            audioTracks: readJson<{ tracks?: { id: string; name: string }[] }>("editor/audio-tracks.json")?.tracks ?? [],
            appTags: readJson<{ tags?: { id: string; name: string }[] }>("editor/app-tags.json")?.tags ?? [],
            uiDocument: uiDocument(),
        }),
        stories: summaries.map(summary => ({
            ...summary,
            document: readableStoryDocument(readJson<StoryDocument>(`editor/story/stories/${summary.id}/storydoc.json`) as StoryDocument),
        })),
    };
}

beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nls-agent-core-parity-"));
    registerCoreBlueprintNodes();
    registerBuiltInPluginBlueprintNodes();
    commandI18nStore.setPreference(false);
});

afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

describe("ui: the core and the command line agree", () => {
    it("show, whole and one surface", () => {
        const context = uiContext();
        expect(showUi(context).out).toEqual(runSync(runUiCli, ["show", "--project", SKELETON]).out);
        const surface = context.document.surfaces[0].name;
        expect(showUi(context, { surface }).out).toEqual(runSync(runUiCli, ["show", "--project", SKELETON, "--surface", surface]).out);
    });

    it("surfaces and project check", () => {
        const input = uiProjectInputOf(uiContext());
        expect(uiSurfacesCommand(input).out).toEqual(runSync(runUiCli, ["surfaces", "--project", SKELETON]).out);
        const fileName = path.join(SKELETON, "editor", "ui", "uidoc.json");
        const cli = runSync(runUiCli, ["check", "--project", SKELETON]);
        const core = checkUiProjectText(uiContext(), { fileName });
        expect(core.out).toEqual(cli.out);
        expect(core.exitCode).toBe(cli.code);
    });

    it("apply of a surface's own printout, without writing", () => {
        const context = uiContext();
        const surface = context.document.surfaces[0].name;
        const text = showUi(context, { surface }).text as string;
        const file = path.join(scratch, "surface.ui");
        fs.writeFileSync(file, text, "utf8");
        const cli = runSync(runUiCli, ["apply", file, "--project", SKELETON]);
        const core = applyUiSource(text, context, { fileName: file });
        expect(core.out).toEqual(cli.out);
        expect(core.err).toEqual(cli.err);
        expect(core.exitCode).toBe(cli.code);
    });
});

describe("story: the core and the command line agree", () => {
    it("scenes, targets and show", async () => {
        const context = storyContext();
        const resolved = resolveStory(context, undefined);
        if (!("story" in resolved)) {
            throw new Error(resolved.error);
        }
        const story = resolved.story;
        expect(storyScenesCommand(story.document).out).toEqual((await runStory(["scenes", "--project", SKELETON])).out);
        expect(storyTargetsCommand(context.data, story.document).out).toEqual((await runStory(["targets", "--project", SKELETON])).out);
        expect(showStoryScene(context, story).out).toEqual((await runStory(["show", "--project", SKELETON])).out);
    });

    it("apply of a scene's own printout, without writing", async () => {
        const context = storyContext();
        const story = context.stories[0];
        const text = showStoryScene(context, story).text as string;
        const file = path.join(scratch, "scene.story");
        fs.writeFileSync(file, text, "utf8");
        const cli = await runStory(["apply", file, "--project", SKELETON]);
        // The stored version is what the reader saw before migrating; the bridge knows it the same way.
        const stored = readJson<{ schemaVersion: number }>(`editor/story/stories/${story.id}/storydoc.json`);
        const core = await applyStorySource(text, context, story, { fileName: file, storedSchemaVersion: stored?.schemaVersion });
        expect(core.out).toEqual(cli.out);
        expect(core.err).toEqual(cli.err);
        expect(core.exitCode).toBe(cli.code);
    });
});

describe("blueprint: the core and the command line agree", () => {
    it("list, show and project check", () => {
        publishPageParams(uiDocument());
        publishSaveSchema(readJson("editor/save-schema.json"));
        const document = blueprintDocument();
        expect(blueprintListCommand(document, { withGraphs: true }).out)
            .toEqual(runSync(runBlueprintCli, ["list", "--project", SKELETON, "--with-graphs"]).out);
        const shown = blueprintShowCommand(document, { blueprint: "Config" });
        const cli = runSync(runBlueprintCli, ["show", "--project", SKELETON, "--blueprint", "Config"]);
        expect(shown.out).toEqual(cli.out);
        expect(shown.err).toEqual(cli.err);

        const context = buildBlueprintProjectContext({
            blueprintDocument: document,
            uiDocument: uiDocument(),
            variableRegistry: readJson("editor/variables.json"),
            stories: storyContext().stories.map(story => ({ name: story.name, document: story.document })),
        });
        const fileName = path.join(SKELETON, "editor", "ui", "uigraphs.json");
        const checkCli = runSync(runBlueprintCli, ["check", "--project", SKELETON]);
        const checkCore = checkBlueprintProjectText(context, { fileName });
        expect(checkCore.out).toEqual(checkCli.out);
        expect(checkCore.exitCode).toBe(checkCli.code);
    });
});
