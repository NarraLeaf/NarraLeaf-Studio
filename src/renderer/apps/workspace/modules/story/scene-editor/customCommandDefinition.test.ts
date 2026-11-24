import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { customCommandLibrary, expandCustomCommandCall } from "@shared/story/customCommands";
import { buildCustomCommandRow, findCustomCommandPlaceholders } from "./customCommandDefinition";
import { CUSTOM_COMMAND_BODY_COMMAND_IDS, customCommandParamType, publishCustomStoryCommands } from "./commands/customCommands";
import { getCommandDef, getCommandSpec } from "./commands/registry";
import { specGroupIds } from "./commands/specSidebar";
import { canCommit, parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine } from "./storyCommandResolution";
import { EMPTY_STORY_COMMAND_CONTEXT, type StoryCommandContext } from "./storyCommandValues";

const context: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    characters: [{ id: "anyo-id", name: "Anyo" }, { id: "bea-id", name: "Bea" }],
};

let nextId = 0;
const generateId = () => `row${++nextId}`;

/** What a built-in line builds, for comparing against an expanded call. */
function builtIn(line: string): StoryBlock["payload"] {
    const parsed = parseCommandLine(line);
    if (parsed.kind !== "command" || !parsed.def || !canCommit(parsed)) {
        throw new Error(`not a command: ${line}`);
    }
    const { args, issues } = resolveCommandLine(parsed, context);
    expect(issues).toEqual([]);
    return getCommandSpec(parsed.def.commandId)!.build!(args, { generateId: () => "x", context }).payload;
}

/** Commit a call line the way the editor would: through the command's own spec. */
function callBlock(line: string): StoryBlock {
    const parsed = parseCommandLine(line);
    if (parsed.kind !== "command" || !parsed.def) {
        throw new Error(`not a command: ${line}`);
    }
    const { args, issues } = resolveCommandLine(parsed, context);
    expect(issues).toEqual([]);
    return getCommandSpec(parsed.def.commandId)!.build!(args, { generateId: () => "call", context });
}

describe("reading a custom command's line", () => {
    it("finds parameters, their negation and their default", () => {
        expect(findCustomCommandPlaceholders("/transform <角色> xoffset=-<力度=5>").map(({ name, negate, defaultText }) => ({ name, negate, defaultText })))
            .toEqual([{ name: "角色", negate: false, defaultText: undefined }, { name: "力度", negate: true, defaultText: "5" }]);
    });

    it("names only commands that exist", () => {
        for (const id of CUSTOM_COMMAND_BODY_COMMAND_IDS) {
            expect(getCommandSpec(id), id).not.toBeNull();
        }
    });

    it("refuses a command a custom command cannot hold, and a parameter in a slot it cannot stand for", () => {
        expect(buildCustomCommandRow("/note hello", context, { generateId })).toEqual({ ok: false, problem: { code: "notAllowed" } });
        expect(buildCustomCommandRow("/transform <角色> nosuchkey=<力度>", context, { generateId }))
            .toMatchObject({ ok: false });
        expect(buildCustomCommandRow("/transform Anyo xoffset=<a b>", context, { generateId }).ok).toBe(false);
    });

    it("plays back exactly what the same line typed out would build", () => {
        const first = buildCustomCommandRow("/transform <角色> pos=center xoffset=-<力度> d=0.1", context, { generateId });
        const second = buildCustomCommandRow("/transform <角色> pos=center xoffset=<力度> d=<时长=0.1>", context, { generateId, known: first.ok ? first.params : [] });
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) {
            return;
        }
        const params = [...first.params, ...second.params.filter(param => !first.params.some(known => known.name === param.name))];
        expect(params.map(param => param.name)).toEqual(["角色", "力度", "时长"]);
        expect(params.find(param => param.name === "时长")?.default).toEqual({ kind: "number", value: 0.1 });
        const command = { id: "cmd", name: "左右摇晃", params, rows: [first.row, second.row] };
        publishCustomStoryCommands([command]);
        try {
            // The command menu hands back the spec id; the pick resolves it like any built-in's.
            expect(getCommandDef("custom:cmd")?.params.map(param => param.name)).toEqual(["角色", "力度", "时长"]);
            expect(getCommandDef("左右摇晃")?.commandId).toBe("custom:cmd");
            // Filed under 自定义 in the menu, not under the 角色 its subject slot takes.
            expect(specGroupIds(getCommandSpec("custom:cmd")!)).toEqual(["custom"]);
            // The subject takes characters alone: no stage singleton is offered for it.
            expect(customCommandParamType(params[0])).toMatchObject({ kind: "target", accepts: ["character"], reserved: [] });
            const call = callBlock("/左右摇晃 Anyo 力度=10");
            expect(call.payload).toMatchObject({ action: "customCommand", commandId: "cmd" });
            const { blocks } = expandCustomCommandCall(call, customCommandLibrary([command]));
            expect(blocks.map(block => block.payload)).toEqual([
                builtIn("/transform Anyo pos=center xoffset=-10 d=0.1"),
                builtIn("/transform Anyo pos=center xoffset=10 d=0.1"),
            ]);
            const slower = expandCustomCommandCall(callBlock("/左右摇晃 Bea 力度=3 时长=0.5"), customCommandLibrary([command])).blocks;
            expect(slower.map(block => block.payload)).toEqual([
                builtIn("/transform Bea pos=center xoffset=-3 d=0.1"),
                builtIn("/transform Bea pos=center xoffset=3 d=0.5"),
            ]);
        } finally {
            publishCustomStoryCommands([]);
        }
    });

    it("places an option and a switch by what each of their values writes", () => {
        const result = buildCustomCommandRow("/transform <角色> flip=<翻转> pos=<位置>", context, { generateId });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const command = { id: "cmd2", name: "站位", params: result.params, rows: [result.row] };
        publishCustomStoryCommands([command]);
        try {
            const { blocks } = expandCustomCommandCall(callBlock("/站位 Anyo 翻转=on 位置=right"), customCommandLibrary([command]));
            expect(blocks[0].payload).toEqual(builtIn("/transform Anyo flip=on pos=right"));
        } finally {
            publishCustomStoryCommands([]);
        }
    });
});

describe("showing a custom command's row", () => {
    it("puts each parameter back where it was written", async () => {
        const { customCommandRowLine } = await import("./customCommandDefinition");
        const result = buildCustomCommandRow("/transform <角色> pos=center xoffset=-<力度> d=0.1", context, { generateId });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(customCommandRowLine("/transform NlsProbeCharacterA pos=center xoffset=1 d=0.1", result.row.bindings))
            .toBe("/transform <角色> pos=center xoffset=-<力度> d=0.1");
    });
});
