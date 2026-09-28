import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES, type TranslationKey } from "@shared/i18n";
import { BUILTIN_CONSOLE_CHANNELS, type ConsoleChannelDefinition } from "@/lib/workspace/services/core/ConsoleService";
import { BUILD_CONSOLE_SOURCE } from "@/lib/workspace/services/core/BuildService";
import { LINT_CONSOLE_CHANNEL, LINT_CONSOLE_SOURCE } from "@/lib/workspace/services/core/LintService";
import { TEST_CONSOLE_CHANNEL, TEST_CONSOLE_SOURCE } from "@/lib/testing/TestRunService";
import { STORY_CONSOLE_CHANNEL } from "../story/scene-editor/preview/storyPreviewConsole";
import { consoleChannelDescription, consoleChannelLabel, consoleSourceLabel } from "./consoleChannelText";

/**
 * Every channel Studio itself registers, worded as its producer registers it: fixed English, which
 * is what reached the tab strip of every language for the project check ("Lint") and, on hover,
 * for the tests.
 */
const STUDIO_CHANNELS: ConsoleChannelDefinition[] = [
    ...BUILTIN_CONSOLE_CHANNELS,
    STORY_CONSOLE_CHANNEL,
    { id: LINT_CONSOLE_CHANNEL, label: "Lint", description: "Project lint sweeps and their findings" },
    { id: TEST_CONSOLE_CHANNEL, label: "Test", description: "Test runs and their verdicts" },
];

const zh = createTranslator("zh").t as (key: TranslationKey) => string;

describe("console channel tabs", () => {
    it.each(STUDIO_CHANNELS.map(channel => [channel.id, channel] as const))(
        "names the %s tab, and says what it holds, in the interface language",
        (_id, channel) => {
            const label = consoleChannelLabel(zh, channel);
            const description = consoleChannelDescription(zh, channel);
            expect(label).not.toMatch(/[A-Za-z]/);
            expect(description).not.toMatch(/[A-Za-z]/);
        },
    );

    it("leaves a channel it does not know, a plugin's, as registered", () => {
        const plugin = { id: "acme.sync", label: "Acme Sync", description: "Sync jobs" };
        expect(consoleChannelLabel(zh, plugin)).toBe("Acme Sync");
        expect(consoleChannelDescription(zh, plugin)).toBe("Sync jobs");
    });

    // The project check is one feature under one word: the palette category it is listed under is
    // what its tab is called, in every language.
    it.each(SUPPORTED_LOCALES)("calls the project check's tab what the palette calls it, in %s", locale => {
        const t = createTranslator(locale).t as (key: TranslationKey) => string;
        const lint = STUDIO_CHANNELS.find(channel => channel.id === LINT_CONSOLE_CHANNEL)!;
        expect(consoleChannelLabel(t, lint)).toBe(t("lint.command.category"));
    });
});

describe("the part a console line says it came from", () => {
    it("is named with the word that part's tab uses", () => {
        expect(consoleSourceLabel(zh, BUILD_CONSOLE_SOURCE)).toBe(zh("console.channels.build"));
        expect(consoleSourceLabel(zh, LINT_CONSOLE_SOURCE)).toBe(zh("lint.console.channel"));
        expect(consoleSourceLabel(zh, TEST_CONSOLE_SOURCE)).toBe(zh("test.console.channel"));
    });

    it("is printed as given when Studio does not know it", () => {
        expect(consoleSourceLabel(zh, "Acme Sync")).toBe("Acme Sync");
        // A name an object already answers to is still just a name.
        expect(consoleSourceLabel(zh, "constructor")).toBe("constructor");
    });
});
