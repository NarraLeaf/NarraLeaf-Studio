import type { TranslationKey } from "@shared/i18n";
import {
    BLUEPRINT_CONSOLE_SOURCE,
    BLUEPRINT_LOG_CONSOLE_SOURCE,
    DEV_MODE_CONSOLE_SOURCE,
    type ConsoleChannelDefinition,
    type ConsoleChannelId,
} from "@/lib/workspace/services/core/ConsoleService";
import { BUILD_CONSOLE_SOURCE } from "@/lib/workspace/services/core/BuildService";
import { LINT_CONSOLE_CHANNEL, LINT_CONSOLE_SOURCE } from "@/lib/workspace/services/core/LintService";
import { TEST_CONSOLE_CHANNEL, TEST_CONSOLE_SOURCE } from "@/lib/testing/TestRunService";

type Translate = (key: TranslationKey) => string;

/**
 * Translation keys for the channels Studio itself registers. A channel a plugin registers is not in
 * here and shows the label it registered with.
 *
 * Looked up when a tab is drawn rather than when its channel is registered, so the tab follows the
 * interface language the moment it changes. The project check and test channels are registered by
 * their services with fixed English wording, and without an entry here that wording was what their
 * tabs showed in every language.
 */
const CHANNEL_LABEL_KEYS: Partial<Record<ConsoleChannelId, TranslationKey>> = {
    blueprint: "console.channels.blueprint",
    build: "console.channels.build",
    story: "console.channels.story",
    storage: "console.channels.storage",
    [LINT_CONSOLE_CHANNEL]: "lint.console.channel",
    [TEST_CONSOLE_CHANNEL]: "test.console.channel",
};

/** What hovering a tab says - also its accessible name. Same table, same reason. */
const CHANNEL_DESCRIPTION_KEYS: Partial<Record<ConsoleChannelId, TranslationKey>> = {
    blueprint: "console.channels.blueprintDescription",
    build: "console.channels.buildDescription",
    story: "console.channels.storyDescription",
    storage: "console.channels.storageDescription",
    [LINT_CONSOLE_CHANNEL]: "lint.console.channelDescription",
    [TEST_CONSOLE_CHANNEL]: "test.console.channelDescription",
};

/**
 * The part of Studio a line says it came from, keyed by the `source` its producer stamps on it.
 *
 * A source is stored as the producer's own fixed English word - the command-line runs print the same
 * entries to a terminal - so it is named in the interface language where the line is drawn, with the
 * word that part's own tab uses where there is one. A source Studio does not know, a plugin's or one
 * Dev Mode passes through, is printed as given.
 */
const SOURCE_LABEL_KEYS: ReadonlyMap<string, TranslationKey> = new Map<string, TranslationKey>([
    [BUILD_CONSOLE_SOURCE, "console.channels.build"],
    [LINT_CONSOLE_SOURCE, "lint.console.channel"],
    [TEST_CONSOLE_SOURCE, "test.console.channel"],
    [BLUEPRINT_CONSOLE_SOURCE, "console.channels.blueprint"],
    [BLUEPRINT_LOG_CONSOLE_SOURCE, "console.sources.blueprintLog"],
    [DEV_MODE_CONSOLE_SOURCE, "devMode.title"],
]);

export function consoleChannelLabel(t: Translate, channel: ConsoleChannelDefinition): string {
    const key = CHANNEL_LABEL_KEYS[channel.id];
    return key ? t(key) : channel.label;
}

export function consoleChannelDescription(t: Translate, channel: ConsoleChannelDefinition): string | undefined {
    const key = CHANNEL_DESCRIPTION_KEYS[channel.id];
    return key ? t(key) : channel.description;
}

export function consoleSourceLabel(t: Translate, source: string): string {
    const key = SOURCE_LABEL_KEYS.get(source);
    return key ? t(key) : source;
}
