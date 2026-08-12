import { describe, expect, it } from "vitest";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import { getCommandSpec, getDefById } from "./commands/registry";
import { specPaletteCommands, availableSpecCommands } from "./commands/specPalette";
import { buildStoryCommandContext } from "./storyCommandContext";
import { getCommandCandidates } from "./storyCommandCandidates";
import { resolveCommandLine } from "./storyCommandResolution";
import { allowsFreeValue, type StoryCommandDef, type StoryCommandParam } from "./storyCommandGrammar";
import type { StoryCommandLine } from "./storyCommandParser";
import { EMPTY_STORY_COMMAND_CONTEXT, type StoryCommandContext } from "./storyCommandValues";

/**
 * The `appTag` command slot: a closed set of names offered from, and resolved against, the project's
 * build variants.
 *
 * Exercised through `/cut`, the command that declares the slot. What these hold is the pair that has
 * to agree with the variant registry: what the menu offers, and what a typed name turns into once the
 * row commits - plus the two rules that make a written row survive the registry changing under it
 * (a rename keeps resolving, a deletion leaves a row that ends nothing).
 */

const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    appTags: [
        { id: APP_TAG_ID_RELEASE, name: "Release" },
        { id: "tag-demo", name: "Demo" },
        { id: "tag-bonus", name: "Bonus" },
    ],
};

const SPEC = getCommandSpec("cut")!;
const DEF = getDefById("cut") as StoryCommandDef;
const PARAM: StoryCommandParam = DEF.params[0];

function commandLine(value: string): StoryCommandLine {
    return {
        kind: "command",
        token: DEF.token,
        tokenSpan: { start: 1, end: 1 + DEF.token.length },
        def: DEF,
        args: [{ param: PARAM, key: null, value, valueSpan: { start: 0, end: value.length } }],
        issues: [],
    };
}

describe("app tag command slot - candidates", () => {
    const candidatesFor = (query: string) => getCommandCandidates(
        { kind: "positional", param: PARAM, query, replace: { start: 0, end: query.length } },
        CONTEXT,
    );

    it("offers the variants the author created, in the order the project lists them", () => {
        const candidates = candidatesFor("");

        // Release is deliberately absent: it is what every unresolvable reference falls back to, and a
        // line ending it would end the edition every other one is read against.
        expect(candidates.map(candidate => candidate.value)).toEqual(["Demo", "Bonus"]);
        expect(candidates[0].mark).toEqual({ kind: "appTag" });
    });

    it("filters by what has been typed", () => {
        expect(candidatesFor("de").map(candidate => candidate.value)).toEqual(["Demo"]);
    });

    it("takes no free value, so a name matching nothing is an error rather than text", () => {
        expect(allowsFreeValue(PARAM.type as { kind: "appTag" })).toBe(false);
    });
});

describe("app tag command slot - resolution", () => {
    it("stores the variant's id, not the name the author typed", () => {
        const { args, issues } = resolveCommandLine(commandLine("Demo"), CONTEXT);

        expect(issues).toEqual([]);
        expect(args.tag).toEqual({ kind: "appTag", appTagId: "tag-demo" });
    });

    it("matches the name case-insensitively, the way a scene name is matched", () => {
        expect(resolveCommandLine(commandLine("demo"), CONTEXT).args.tag)
            .toEqual({ kind: "appTag", appTagId: "tag-demo" });
    });

    it("reports a variant the project does not have", () => {
        const { issues } = resolveCommandLine(commandLine("Director's Cut"), CONTEXT);

        expect(issues.map(issue => issue.code)).toEqual(["unknownAppTag"]);
    });

    it("reports two variants of one name rather than picking one", () => {
        const twins: StoryCommandContext = {
            ...CONTEXT,
            appTags: [{ id: "a", name: "Demo" }, { id: "b", name: "Demo" }],
        };

        expect(resolveCommandLine(commandLine("Demo"), twins).issues.map(issue => issue.code))
            .toEqual(["ambiguousName"]);
    });

    it("still takes the release variant's name, which is what a stranded row reads as", () => {
        // Not offered, but legal: a deleted variant's id resolves to release, so a row holding it has
        // to be a state the whole seam can express rather than one only the payload can.
        expect(resolveCommandLine(commandLine("Release"), CONTEXT).args.tag)
            .toEqual({ kind: "appTag", appTagId: APP_TAG_ID_RELEASE });
    });

    it("reaches a payload through the real spec path: fragment, resolve, build", () => {
        const { args } = resolveCommandLine(commandLine("Demo"), CONTEXT);
        let next = 0;
        const block = SPEC.build!(args, { generateId: () => `id-${++next}`, context: CONTEXT });

        // The fragment declares the slot core and positional, and `asAppTagId` hands `build` the id
        // rather than the name - the two halves the command relies on.
        expect(PARAM.core).toBe(true);
        expect(PARAM.positional).toBe(true);
        expect(block).toMatchObject({ kind: "control", payload: { control: "cut", appTagId: "tag-demo" } });
        // No children, ever: a cut point is an ending, not a container.
        expect(block.childrenIds).toEqual([]);
    });

    it("keeps resolving a row through a rename, because the row holds the id", () => {
        const renamed: StoryCommandContext = {
            ...CONTEXT,
            appTags: [{ id: APP_TAG_ID_RELEASE, name: "Release" }, { id: "tag-demo", name: "Trial" }],
        };
        const stored = resolveCommandLine(commandLine("Demo"), CONTEXT).args.tag;

        // The stored value names the variant by id, so the rename cannot invalidate it - and the new
        // name is what the line now has to be written with.
        expect(stored).toEqual({ kind: "appTag", appTagId: "tag-demo" });
        expect(resolveCommandLine(commandLine("Trial"), renamed).args.tag).toEqual(stored);
    });
});

describe("app tag command slot - the release variant is always there", () => {
    it("offers release in a project whose variants could not be read at all", () => {
        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document: null,
            sceneId: null,
            scene: null,
        });

        expect(context.appTags).toEqual([{ id: APP_TAG_ID_RELEASE, name: "Release" }]);
    });

    it("spells release the way the surface spells it, not the way the model does", () => {
        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document: null,
            sceneId: null,
            scene: null,
            appTags: [{ id: APP_TAG_ID_RELEASE, name: "Release" }, { id: "tag-demo", name: "Demo" }],
            releaseAppTagName: "正式版",
        });

        expect(context.appTags).toEqual([
            { id: APP_TAG_ID_RELEASE, name: "正式版" },
            { id: "tag-demo", name: "Demo" },
        ]);
    });
});

describe("the cut command is offered only where it has something to name", () => {
    const idsIn = (context: StoryCommandContext) =>
        availableSpecCommands(specPaletteCommands(), context).map(command => command.id);

    it("is listed once the project has a variant of its own", () => {
        expect(idsIn(CONTEXT)).toContain("cut");
    });

    it("is not listed in a project that has only the release variant", () => {
        const bare: StoryCommandContext = {
            ...EMPTY_STORY_COMMAND_CONTEXT,
            appTags: [{ id: APP_TAG_ID_RELEASE, name: "Release" }],
        };

        expect(idsIn(bare)).not.toContain("cut");
        // The gate is per command, not a filter over the catalogue: everything else still lists.
        expect(idsIn(bare).length).toBe(specPaletteCommands().length - 1);
    });

    it("gates the menus and not the parser - a typed line still reaches the command", () => {
        // Hiding a spec must not make its token unknown, or a scene written before the variant was
        // deleted would stop reading back as the command that wrote it.
        expect(getDefById("cut")).not.toBeNull();
    });
});
