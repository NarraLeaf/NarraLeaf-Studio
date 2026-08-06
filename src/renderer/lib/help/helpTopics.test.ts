import { describe, expect, it } from "vitest";
import { flattenCatalog } from "@shared/i18n/flatten";
import { en } from "@shared/i18n/catalog/en";
import { zh } from "@shared/i18n/catalog/zh";
import { KEYBINDING_CATALOG } from "../workspace/services/ui/keybindingCatalog";
import { parseHelpBody } from "./helpBody";
import {
    HELP_SECTIONS,
    HELP_TOPIC_IDS,
    HELP_TOPICS,
    helpBodyKey,
    helpSectionKey,
    helpTitleKey,
    helpTopicsBySection,
} from "./helpTopics";

/**
 * The registry's cross-references, checked against the things they point at.
 *
 * Every one of these can only fail by someone adding a topic and stopping halfway - a shortcut id
 * that was renamed in the keybinding catalog, a `related` pointing at a topic that was never
 * registered, a catalog key spelled differently from the id. None of them throws at runtime: the
 * popover would render a blank row, an inert link, or the key itself.
 */

const enKeys = flattenCatalog(en);
const zhKeys = flattenCatalog(zh);
const catalogIds = new Set(KEYBINDING_CATALOG.map(entry => entry.id));
const registeredIds = new Set<string>(HELP_TOPICS.map(topic => topic.id));

describe("help topic registry", () => {
    it("registers exactly the declared ids, once each", () => {
        expect(HELP_TOPICS.map(topic => topic.id).sort()).toEqual([...HELP_TOPIC_IDS].sort());
        expect(registeredIds.size).toBe(HELP_TOPICS.length);
    });

    it("files every topic under a known section", () => {
        for (const topic of HELP_TOPICS) {
            expect(HELP_SECTIONS, `${topic.id} has an unknown section`).toContain(topic.section);
        }
    });

    it("lists every topic in the grouped view", () => {
        const grouped = helpTopicsBySection().flatMap(group => group.topics.map(topic => topic.id));
        expect(grouped.sort()).toEqual([...HELP_TOPIC_IDS].sort());
    });

    it("points `related` at registered topics, never at itself", () => {
        for (const topic of HELP_TOPICS) {
            for (const related of topic.related ?? []) {
                expect(registeredIds, `${topic.id} relates to unknown topic ${related}`).toContain(related);
                expect(related, `${topic.id} relates to itself`).not.toBe(topic.id);
            }
        }
    });

    it("points `shortcuts` at keybinding catalog entries", () => {
        for (const topic of HELP_TOPICS) {
            for (const shortcut of topic.shortcuts ?? []) {
                expect(catalogIds, `${topic.id} names unknown keybinding ${shortcut}`).toContain(shortcut);
            }
        }
    });

    it("uses http(s) for `learnMore`", () => {
        for (const topic of HELP_TOPICS) {
            if (topic.learnMore) {
                expect(topic.learnMore, `${topic.id}`).toMatch(/^https?:\/\//);
            }
        }
    });
});

describe("help topic content", () => {
    for (const [locale, keys] of [["en", enKeys], ["zh", zhKeys]] as const) {
        it(`gives every ${locale} topic a title and a body that parses`, () => {
            for (const topic of HELP_TOPICS) {
                const title = keys.get(helpTitleKey(topic.id));
                const body = keys.get(helpBodyKey(topic.id));
                expect(title, `${locale} is missing help.topics.${topic.id}.title`).toBeTruthy();
                expect(body, `${locale} is missing help.topics.${topic.id}.body`).toBeTruthy();
                expect(
                    parseHelpBody(body!).length,
                    `${locale}: help.topics.${topic.id}.body parses to nothing`,
                ).toBeGreaterThan(0);
            }
        });

        it(`names every ${locale} section`, () => {
            for (const section of HELP_SECTIONS) {
                expect(keys.get(helpSectionKey(section)), `${locale} is missing ${section}`).toBeTruthy();
            }
        });

        /**
         * The copy rules that can be checked mechanically (docs/help-system.md §3). Dashes and
         * exclamation marks are the two the reviewer keeps catching by hand, and both are absolute:
         * there is no help sentence that needs either.
         */
        it(`keeps ${locale} help copy free of dashes and exclamation marks`, () => {
            const offenders: string[] = [];
            for (const [key, value] of keys) {
                if (!key.startsWith("help.")) {
                    continue;
                }
                if (/[—–]|——|[!！]/.test(value)) {
                    offenders.push(`${key} = ${JSON.stringify(value)}`);
                }
            }
            expect(offenders, `${locale} help copy breaks docs/help-system.md §3:\n  ${offenders.join("\n  ")}`)
                .toEqual([]);
        });
    }
});

describe("help body parser", () => {
    it("reads a paragraph per line and joins consecutive bullets", () => {
        expect(parseHelpBody("One.\n\nTwo.\n\n- a\n- b\n\nThree.")).toEqual([
            { kind: "paragraph", text: "One." },
            { kind: "paragraph", text: "Two." },
            { kind: "list", items: ["a", "b"] },
            { kind: "paragraph", text: "Three." },
        ]);
    });

    it("starts a new list after a paragraph interrupts one", () => {
        expect(parseHelpBody("- a\nmid\n- b")).toEqual([
            { kind: "list", items: ["a"] },
            { kind: "paragraph", text: "mid" },
            { kind: "list", items: ["b"] },
        ]);
    });

    it("drops empty bullets and empty bodies", () => {
        expect(parseHelpBody("- \n-  ")).toEqual([]);
        expect(parseHelpBody("   \n\n  ")).toEqual([]);
    });
});
