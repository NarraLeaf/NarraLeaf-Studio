import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { createTranslator } from "@shared/i18n/translator";
import type { TranslationKey } from "@shared/i18n";
import { createTestLintContext } from "../testContext";
import type { LintStoryEntry } from "../context";
import { STORY_LINT_RULES } from "./story";

/**
 * `story/parallel-same-target`: two branches of one `/parallel` group acting on one stage object.
 *
 * The branches start together and an element runs one animation at a time, so the second branch
 * can cut the first short and leave the group waiting. Rows in one branch run in turn and are fine.
 */

const rule = STORY_LINT_RULES.find(candidate => candidate.id === "story/parallel-same-target")!;

type Spec = { id: string; kind?: string; payload: unknown; children?: Spec[] };

function entry(specs: Spec[]): LintStoryEntry {
    const blocks: Record<string, StoryBlock> = {};
    const walk = (spec: Spec, parentId: string | null): string => {
        const childrenIds = (spec.children ?? []).map(child => walk(child, spec.id));
        blocks[spec.id] = { id: spec.id, kind: spec.kind ?? "action", parentId, childrenIds, payload: spec.payload } as StoryBlock;
        return spec.id;
    };
    const rootBlockIds = specs.map(spec => walk(spec, null));
    const document = {
        id: "story-1",
        name: "Story",
        chapters: [{ id: "ch", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: { "scene-1": { id: "scene-1", name: "Credits", rootBlockIds, blocks } },
    } as unknown as StoryDocument;
    return { id: "story-1", name: "Story", document };
}

const parallel = (id: string, children: Spec[]): Spec => ({ id, kind: "control", payload: { control: "parallel" }, children });
const sequence = (id: string, children: Spec[]): Spec => ({ id, kind: "control", payload: { control: "sequence" }, children });
const createText = (id: string, name: string): Spec => ({ id, payload: { action: "text", operation: "create", objectName: name, text: "Staff" } });
const showText = (id: string, name: string): Spec => ({ id, payload: { action: "text", operation: "show", objectName: name, transform: { to: { opacity: 1 }, durationMs: 500 } } });
const fontText = (id: string, name: string): Spec => ({ id, payload: { action: "text", operation: "setFontSize", objectName: name, fontSize: 48 } });
const enter = (id: string, characterId: string): Spec => ({ id, payload: { action: "character", operation: "enter", characterId } });
const face = (id: string, characterId: string): Spec => ({ id, payload: { action: "character", operation: "expression", characterId } });

async function reported(specs: Spec[]): Promise<string[]> {
    const findings = await rule.run(createTestLintContext({ stories: [entry(specs)] }), {});
    return findings.map(finding => (finding.location.kind === "story" ? finding.location.blockId ?? "" : ""));
}

describe("story/parallel-same-target", () => {
    it("is a warning", () => {
        expect(rule.defaultSeverity).toBe("warning");
    });

    it("reports the later branch that acts on the same text object, naming it", async () => {
        const findings = await rule.run(createTestLintContext({
            stories: [entry([createText("create", "credit"), parallel("group", [showText("show", "credit"), fontText("font", "credit")])])],
        }), {});
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "story/parallel-same-target",
            messageKey: "lint.rule.storyParallelSameTarget.message",
            messageParams: { object: "credit" },
            location: { kind: "story", blockId: "font" },
        });
    });

    it("reports two /char rows on one character in parallel branches", async () => {
        expect(await reported([enter("in", "mio"), parallel("group", [face("a", "mio"), face("b", "mio")])])).toEqual(["b"]);
    });

    it("says nothing about different objects, or rows in a sequence", async () => {
        expect(await reported([
            createText("c1", "credit"),
            createText("c2", "role"),
            parallel("group", [showText("s1", "credit"), showText("s2", "role")]),
            sequence("seq", [showText("s3", "credit"), fontText("f3", "credit")]),
        ])).toEqual([]);
    });

    it("treats a branch as a unit: rows inside one branch run in turn", async () => {
        expect(await reported([
            createText("c", "credit"),
            parallel("group", [sequence("branch", [showText("s", "credit"), fontText("f", "credit")]), enter("e", "mio")]),
        ])).toEqual([]);
        expect(await reported([
            createText("c", "credit"),
            parallel("group", [sequence("branch", [showText("s", "credit")]), sequence("other", [fontText("f", "credit"), showText("again", "credit")])]),
        ])).toEqual(["f"]);
    });

    it.each([
        ["en", "Another branch of this /parallel group also acts on \"credit\""],
        ["zh", "该 /parallel 组的另一个分支也作用于“credit”"],
        ["ja", "この /parallel グループの別の分岐も「credit」を操作している"],
    ] as const)("renders its %s message with the object quoted", (locale, expected) => {
        expect(createTranslator(locale).t("lint.rule.storyParallelSameTarget.message" as TranslationKey, { object: "credit" })).toBe(expected);
    });
});
