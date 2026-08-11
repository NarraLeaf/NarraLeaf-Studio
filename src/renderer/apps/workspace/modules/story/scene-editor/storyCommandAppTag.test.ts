import { describe, expect, it } from "vitest";
import { Package } from "lucide-react";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import { appTagParam, asAppTagId, defineStoryCommand } from "./commands/spec";
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
 * No command declares the slot yet - the ones that will are the content rules - so the def below is
 * built here rather than taken from the registry. What these hold is the pair that has to agree with
 * the variant registry whichever command arrives first: what the menu offers, and what a typed name
 * turns into once the row commits.
 */

const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    appTags: [
        { id: APP_TAG_ID_RELEASE, name: "Release" },
        { id: "tag-demo", name: "Demo" },
        { id: "tag-bonus", name: "Bonus" },
    ],
};

/**
 * A spec built the way a real command is - through `defineStoryCommand`, off the shared
 * `appTagParam()` fragment - and projected onto a def the way the registry projects one
 * (`specToDef`, which is private to it). The registry itself cannot supply one: it lists the
 * commands that exist, and this slot is declared by none of them yet.
 */
const SPEC = defineStoryCommand({
    id: "variant",
    token: "variant",
    category: "flow",
    icon: Package,
    examples: ["/variant Demo"],
    params: { tag: appTagParam() },
    build: (args, ctx) => ({
        id: ctx.generateId(),
        kind: "note" as const,
        parentId: null,
        childrenIds: [],
        // What a real command's `build` does with this slot: read the id out and store that.
        payload: { text: { textId: ctx.generateId(), value: asAppTagId(args.tag) ?? "", role: "note" as const } },
    }),
});

const PARAM: StoryCommandParam = { name: "tag", ...SPEC.params.tag };

const DEF: StoryCommandDef = { token: SPEC.token, commandId: SPEC.id, params: [PARAM] };

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

    it("offers every variant the project has, release first", () => {
        const candidates = candidatesFor("");

        expect(candidates.map(candidate => candidate.value)).toEqual(["Release", "Demo", "Bonus"]);
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

    it("reaches a payload through the real spec path: fragment, resolve, build", () => {
        const { args } = resolveCommandLine(commandLine("Demo"), CONTEXT);
        let next = 0;
        const block = SPEC.build!(args as never, { generateId: () => `id-${++next}` } as never);

        // The fragment declares the slot core and positional, and `asAppTagId` hands `build` the id
        // rather than the name - the two halves a real command would rely on.
        expect(PARAM.core).toBe(true);
        expect(PARAM.positional).toBe(true);
        expect(block.kind === "note" ? block.payload.text.value : null).toBe("tag-demo");
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
