import { describe, expect, it } from "vitest";
import type { LocalizationDocument, LocalizationUnit } from "@shared/types/localization";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION } from "@shared/types/localization";
import { hashSourceText } from "@shared/utils/localizationText";
import type { StoryBlock } from "@shared/types/story";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { createTestLintContext } from "../testContext";
import type { LintContext } from "../context";
import type { LintFinding, LintRuleId } from "../types";
import { LOCALIZATION_LINT_RULES } from "./localization";
import {
    choiceBlock,
    choiceOptionBlock,
    dialogueBlock,
    narrationBlock,
    singleSceneStories,
    textSegment,
} from "./text/testFixtures";

/**
 * The three localization rules, and the one thing they must never do: speak when the project has no
 * localization configured (ruling R5 - silent, not off).
 */

async function run(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = LOCALIZATION_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return await rule.run(ctx, {});
}

function unit(target: string, sourceText: string, status: LocalizationUnit["status"] = "translated"): LocalizationUnit {
    return { target, sourceHash: hashSourceText(sourceText), status };
}

function documentOf(locale: string, units: Record<string, LocalizationUnit>): LocalizationDocument {
    return { schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, locale, units };
}

function contextOf(blocks: StoryBlock[], units: Record<string, LocalizationUnit>): LintContext {
    return createTestLintContext({
        stories: singleSceneStories(blocks),
        localization: {
            sourceLocale: "en",
            // "en" is listed deliberately: the source locale must be filtered out, not translated.
            targetLocales: ["ja", "en"],
            documents: new Map([["ja", documentOf("ja", units)]]),
        },
    });
}

const LINE = "We should go home.";

describe("localization/missing", () => {
    it("reports an absent unit and an empty one, once per target locale", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {}),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.localizationMissing.message");
        expect(findings[0].messageParams).toEqual({ locale: "ja" });
        expect(findings[0].location).toMatchObject({ kind: "story", blockId: "b1" });

        const empty = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("", LINE) }),
        );
        expect(empty.map(entry => entry.messageKey)).toEqual(["lint.rule.localizationMissing.message"]);
    });

    /**
     * `deriveUnitState` is the authority (see the rule's doc comment): both of these units render as
     * *translated* in the localization editor, so lint does not get to call them missing. The stale
     * flag left on an imported row is outranked by the target being there; a whitespace-only target
     * is a target as far as that function is concerned.
     */
    it("defers to deriveUnitState on a unit whose status is still untranslated", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE, "untranslated"),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("defers to deriveUnitState on a whitespace-only target", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("  ", LINE) }),
        );
        expect(findings).toEqual([]);
    });

    it("leaves a stale unit to localization/stale", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a translated line, a blank line or a disabled row", async () => {
        const findings = await run(
            "localization/missing",
            contextOf(
                [
                    dialogueBlock("b1", textSegment("t-1", LINE, "dialogue")),
                    narrationBlock("b2", textSegment("t-2", "   ", "narration")),
                    dialogueBlock("b3", textSegment("t-3", "Untranslated but disabled", "dialogue"), {
                        disabled: true,
                    }),
                ],
                { "t-1": unit("家に帰ろう。", LINE) },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("covers choice prompts and options as well as spoken lines", async () => {
        const findings = await run(
            "localization/missing",
            contextOf(
                [
                    choiceBlock("c1", textSegment("t-c", "Stay or go?", "choicePrompt"), ["o1"]),
                    choiceOptionBlock("o1", textSegment("t-o", "Stay", "choiceText"), "c1"),
                ],
                {},
            ),
        );
        expect(findings.map(entry => entry.location)).toMatchObject([{ blockId: "c1" }, { blockId: "o1" }]);
    });

    it("is silent when the project has no localization", async () => {
        const ctx = createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))]),
        });
        expect(ctx.localization).toBeNull();
        expect(await run("localization/missing", ctx)).toEqual([]);
    });
});

describe("localization/markup", () => {
    /** The same line, with the emphasis a translation is expected to put back. */
    const MARKED = [
        { text: "We should go " },
        { text: "home", marks: { emphasis: "dot" as const } },
        { text: "." },
    ];

    it("reports a translation that renders a styled line plainly", async () => {
        const findings = await run(
            "localization/markup",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue", MARKED))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ ruleId: "localization/markup", messageParams: { locale: "ja" } });
    });

    it("is silent once the translation carries the tag", async () => {
        const findings = await run(
            "localization/markup",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue", MARKED))], {
                "t-1": unit("‹1›家‹/1›に帰ろう。", LINE),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("reports a tag naming a run the line does not have", async () => {
        const findings = await run(
            "localization/markup",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue", MARKED))], {
                "t-1": unit("‹1›家‹/1›に‹7›帰ろう‹/7›。", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
    });

    it("says nothing about a line with no styling, or one with no translation at all", async () => {
        expect(await run(
            "localization/markup",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("家に帰ろう。", LINE) }),
        )).toEqual([]);
        expect(await run(
            "localization/markup",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue", MARKED))], {}),
        )).toEqual([]);
    });

    it("is silent when the project has no localization", async () => {
        const ctx = createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue", MARKED))]),
        });
        expect(await run("localization/markup", ctx)).toEqual([]);
    });
});

describe("localization/stale", () => {
    it("reports a translation hashed against text that has since changed", async () => {
        const findings = await run(
            "localization/stale",
            contextOf([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.localizationStale.message");
        expect(findings[0].messageParams).toEqual({ locale: "ja" });
    });

    it("leaves a current translation, an empty unit and a disabled row alone", async () => {
        const findings = await run(
            "localization/stale",
            contextOf(
                [
                    dialogueBlock("b1", textSegment("t-1", LINE, "dialogue")),
                    // Empty target: `localization/missing`'s finding, not a second one here.
                    dialogueBlock("b2", textSegment("t-2", "Rewritten line", "dialogue")),
                    dialogueBlock("b3", textSegment("t-3", "Rewritten line", "dialogue"), { disabled: true }),
                ],
                {
                    "t-1": unit("家に帰ろう。", LINE),
                    "t-2": unit("", "the old text"),
                    "t-3": unit("古い訳", "the old text"),
                },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("is silent when the project has no localization", async () => {
        expect(await run("localization/stale", createTestLintContext())).toEqual([]);
    });
});

describe("localization/orphan", () => {
    it("reports a unit whose line is gone and ignores the non-story namespaces", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
                "t-deleted": unit("消えた行", "a line that no longer exists"),
                "key:menu.start": unit("はじめる", "Start"),
                "char:char-1": unit("あおい", "Aoi"),
                "scene:scene-1": unit("廊下", "The corridor"),
                "ui:element-1.text": unit("設定", "Settings"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.localizationOrphan.message");
        expect(findings[0].messageParams).toEqual({ count: 1, locale: "ja" });
        expect(findings[0].location).toEqual({ kind: "project" });
    });

    it("aggregates a locale's orphans into one counted finding", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
                "t-gone-1": unit("消えた行", "one"),
                "t-gone-2": unit("消えた行", "two"),
                "t-gone-3": unit("消えた行", "three"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ count: 3, locale: "ja" });
    });

    it("says nothing at all about a locale with no orphans", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("treats a disabled row's unit as orphaned - the row is not in the game", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"), { disabled: true })], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ count: 1, locale: "ja" });
    });

    it("is silent when the project has no localization", async () => {
        expect(await run("localization/orphan", createTestLintContext())).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Interface text: widgets reading their words through a named key or their own unit
// ---------------------------------------------------------------------------

function widget(id: string, type: string, props: Record<string, unknown>, name?: string): UIElement {
    return {
        id,
        type,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        ...(name ? { name } : {}),
        props,
    } as UIElement;
}

/** One page per entry, each holding the given widgets under its own root, plus any components. */
function interfaceDocument(
    pages: Record<string, UIElement[]>,
    components: UIDocument["components"] = [],
): UIDocument {
    const elements: Record<string, UIElement> = {};
    const surfaces = Object.entries(pages).map(([name, children], index) => {
        const rootId = `root-${index}`;
        elements[rootId] = {
            id: rootId,
            type: "nl.root",
            parentId: null,
            childrenIds: children.map(child => child.id),
            layout: { x: 0, y: 0, width: 10, height: 10 },
        } as UIElement;
        for (const child of children) {
            elements[child.id] = child;
        }
        return { id: index === 0 ? MAIN_APP_SURFACE_ID : `page-${index}`, kind: "appSurface", name, rootElementId: rootId };
    });
    return { surfaces, elements, components } as unknown as UIDocument;
}

function interfaceContext(
    document: UIDocument,
    units: Record<string, LocalizationUnit>,
    keys: Record<string, string> | null = {},
): LintContext {
    return createTestLintContext({
        uiDocument: document,
        localizationKeys: keys ? new Map(Object.entries(keys)) : null,
        localization: {
            sourceLocale: "en",
            targetLocales: ["en", "ja"],
            documents: new Map([["ja", documentOf("ja", units)]]),
        },
    });
}

const TITLE_ID = "title";
const TITLE_UNIT = `ui:${TITLE_ID}.text`;

describe("localization/missing on interface text", () => {
    it("reports a widget's own unit and a named key the target locale has no row for", async () => {
        const document = interfaceDocument({
            Title: [
                widget(TITLE_ID, "nl.text", { text: "Summer Rain" }, "Game title"),
                widget("save", "nl.button", { label: "Save", localizationKey: "nav.save" }),
            ],
        });
        const findings = await run("localization/missing", interfaceContext(document, {}, { "nav.save": "Save" }));
        expect(findings.map(entry => [entry.messageKey, entry.messageParams])).toEqual([
            ["lint.rule.localizationMissing.messageInterface", { locale: "ja", text: "Summer Rain" }],
            ["lint.rule.localizationMissing.messageInterface", { locale: "ja", text: "Save" }],
        ]);
        expect(findings[0].location).toMatchObject({ kind: "surface", elementId: TITLE_ID, elementName: "Game title" });
        expect(findings[0].target).toEqual({ kind: "uiSurface", surfaceId: MAIN_APP_SURFACE_ID });
        // The key's translation is written in the key's row, so that is where the finding leads.
        expect(findings[1].target).toEqual({ kind: "localizationKey", keyName: "nav.save" });
    });

    it("is quiet once both rows are translated", async () => {
        const document = interfaceDocument({
            Title: [
                widget(TITLE_ID, "nl.text", { text: "Summer Rain" }),
                widget("save", "nl.button", { label: "Save", localizationKey: "nav.save" }),
            ],
        });
        const findings = await run(
            "localization/missing",
            interfaceContext(
                document,
                { [TITLE_UNIT]: unit("夏の雨", "Summer Rain"), "key:nav.save": unit("セーブ", "Save") },
                { "nav.save": "Save" },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("charges a key shared by several pages once, at the first widget that reads it", async () => {
        const document = interfaceDocument({
            Save: [widget("save-back", "nl.button", { label: "Back", localizationKey: "nav.back" })],
            Load: [widget("load-back", "nl.button", { label: "Back", localizationKey: "nav.back" })],
        });
        const findings = await run("localization/missing", interfaceContext(document, {}, { "nav.back": "Back" }));
        expect(findings).toHaveLength(1);
        expect(findings[0].location).toMatchObject({ kind: "surface", elementId: "save-back" });
    });

    it("leaves out words with no letter in them, a key with no registered words, and keys it could not read", async () => {
        const document = interfaceDocument({
            Title: [
                widget("plain", "nl.text", { text: "1.0" }),
                widget("blank", "nl.text", { text: "  " }),
                widget("dangling", "nl.button", { label: "Gallery", localizationKey: "nav.gallery" }),
                widget("save", "nl.button", { label: "Save", localizationKey: "nav.save" }),
            ],
        });
        expect(await run("localization/missing", interfaceContext(document, {}, {}))).toEqual([]);
        expect(await run("localization/missing", interfaceContext(document, {}, null))).toEqual([]);
    });

    it("files a component definition's widget under the definition", async () => {
        const card = {
            id: "card",
            name: "Slot card",
            rootElementId: "card-empty",
            elements: {
                "card-empty": widget("card-empty", "nl.text", { text: "Empty", localizationKey: "slot.empty" }),
            },
        };
        const document = interfaceDocument({ Title: [] }, [card] as unknown as UIDocument["components"]);
        const findings = await run("localization/missing", interfaceContext(document, {}, { "slot.empty": "Empty" }));
        expect(findings).toHaveLength(1);
        expect(findings[0].location).toMatchObject({ kind: "component", componentId: "card", elementId: "card-empty" });
    });

    it("is silent when the project has no second language", async () => {
        const document = interfaceDocument({
            Title: [widget(TITLE_ID, "nl.text", { text: "Summer Rain" })],
        });
        expect(await run("localization/missing", createTestLintContext({ uiDocument: document }))).toEqual([]);
    });
});

describe("localization/stale on interface text", () => {
    it("reports a translation made before the words were rewritten, and not an absent one", async () => {
        const document = interfaceDocument({
            Title: [
                widget(TITLE_ID, "nl.text", { text: "Summer Rain, Again" }),
                widget("load", "nl.button", { label: "Load", localizationKey: "nav.load" }),
                widget("save", "nl.button", { label: "Save", localizationKey: "nav.save" }),
            ],
        });
        const findings = await run(
            "localization/stale",
            interfaceContext(
                document,
                { [TITLE_UNIT]: unit("夏の雨", "Summer Rain"), "key:nav.load": unit("ロード", "Load game") },
                { "nav.load": "Load", "nav.save": "Save" },
            ),
        );
        expect(findings.map(entry => [entry.messageKey, entry.messageParams])).toEqual([
            ["lint.rule.localizationStale.messageInterface", { locale: "ja", text: "Summer Rain, Again" }],
            ["lint.rule.localizationStale.messageInterface", { locale: "ja", text: "Load" }],
        ]);
    });

    it("hashes a named key against its registered words, not the literal left on the button", async () => {
        // The button still says "Save game" from before it was bound; the game shows the key's words.
        const document = interfaceDocument({
            Title: [widget("save", "nl.button", { label: "Save game", localizationKey: "nav.save" })],
        });
        const findings = await run(
            "localization/stale",
            interfaceContext(document, { "key:nav.save": unit("セーブ", "Save") }, { "nav.save": "Save" }),
        );
        expect(findings).toEqual([]);
    });
});
