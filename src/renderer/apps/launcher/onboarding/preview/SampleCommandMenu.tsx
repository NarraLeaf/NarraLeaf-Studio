import { useMemo } from "react";
import { useCommandTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SOURCE_LOCALE, type TranslationKey } from "@shared/i18n";
import {
    getCommandGroup,
    type StoryCommandGroupId,
} from "@/apps/workspace/modules/story/scene-editor/storyCommandCategories";

/**
 * The action creator, as it opens on a line that has just been started with the trigger.
 *
 * **A short sample of the catalogue, not the catalogue.** The real menu is built from the command
 * registry, which is fifty files of specs that resolve against a loaded project - what is available
 * depends on what the project has. Eight entries are enough to show what the menu IS: what a
 * command looks like when it is named, which glyph and hue its subject carries, and that the words
 * are in the command language rather than the interface one.
 *
 * The words come from the same two catalog keys the registry reads (`story.command.<id>.label` and
 * `.detail`) through the command translator, so a preference that puts the vocabulary back into
 * English puts this menu back into English with it.
 *
 * Matching mirrors the parser's own order: the canonical ASCII token first, then this locale's
 * word. That is what lets an author type `bg` on a Chinese interface and be understood.
 */

export interface SampleCommand {
    /** The canonical token - what the line stores, and what an English author types. */
    token: string;
    /** The subject the verb acts on, which decides the glyph and its hue. */
    group: StoryCommandGroupId;
}

/** Eight verbs, spread across four subjects so the column is not one hue repeated. */
export const SAMPLE_COMMANDS: readonly SampleCommand[] = [
    { token: "bg", group: "scene" },
    { token: "show", group: "character" },
    { token: "hide", group: "character" },
    { token: "say", group: "character" },
    { token: "bgm", group: "sound" },
    { token: "sound", group: "sound" },
    { token: "wait", group: "scene" },
    { token: "jump", group: "scene" },
];

/** The spec id each token is filed under in the catalog, where token and id differ. */
const COMMAND_IDS: Record<string, string> = {
    bg: "background",
};

function labelKey(token: string): TranslationKey {
    return `story.command.${COMMAND_IDS[token] ?? token}.label` as TranslationKey;
}

function detailKey(token: string): TranslationKey {
    return `story.command.${COMMAND_IDS[token] ?? token}.detail` as TranslationKey;
}

export interface SampleCommandMenuProps {
    /** What has been typed after the trigger, unfolded and lowercased by the caller. */
    query: string;
    /** The token currently under the cursor, if any. */
    activeToken: string | null;
    onHighlight: (token: string) => void;
    onChoose: (token: string) => void;
}

/**
 * The words a token is offered under: this locale's, or the canonical one in the source locale -
 * the same rule `localizedCommandToken` applies when the menu writes a word into the line.
 */
export function useSampleCommandLabels(): (token: string) => string {
    const tc = useCommandTranslation();
    return (token: string) => (tc.locale === SOURCE_LOCALE ? token : tc.t(labelKey(token)).trim().toLowerCase());
}

/** The entries a half-typed line still matches, in catalogue order. */
export function filterSampleCommands(query: string, label: (token: string) => string): readonly SampleCommand[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return SAMPLE_COMMANDS;
    }
    return SAMPLE_COMMANDS.filter(command =>
        command.token.startsWith(needle) || label(command.token).includes(needle));
}

export function SampleCommandMenu({ query, activeToken, onHighlight, onChoose }: SampleCommandMenuProps) {
    const tc = useCommandTranslation();
    const label = useSampleCommandLabels();
    const items = useMemo(() => filterSampleCommands(query, label), [query, tc.locale]);

    if (items.length === 0) {
        return null;
    }

    return (
        <div
            role="listbox"
            /*
             * Opens upward, and no taller than the room above the line.
             *
             * Both are forced by where this line sits: the insert slot is the last thing in the
             * scroll region, so there is nothing under it to open into, and the setup screen shows
             * only the left 288px of the editor's text column - a menu at the real one's 320 would
             * have its far edge cut off by the screen rather than by the window it belongs to.
             */
            className="nl-no-scrollbar absolute bottom-full left-0 z-10 mb-1 max-h-56 w-[288px] overflow-auto rounded-xl border border-edge bg-surface-raised p-1 shadow-xl"
            // The menu is an extension of the line being typed, so a press inside it must not take
            // the caret out of the field.
            onMouseDown={event => event.preventDefault()}
        >
            {items.map(command => {
                const group = getCommandGroup(command.group);
                const Icon = group.icon;
                const active = command.token === activeToken;
                return (
                    <button
                        key={command.token}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                            active ? "bg-primary/15 text-fg" : "hover:bg-fill",
                        )}
                        onMouseEnter={() => onHighlight(command.token)}
                        onMouseDown={() => onChoose(command.token)}
                    >
                        <Icon className="h-4 w-4 shrink-0" style={{ color: group.iconColor }} strokeWidth={1.6} />
                        <span className="truncate text-sm text-fg">{tc.t(labelKey(command.token))}</span>
                        <span className="ml-auto min-w-0 shrink truncate text-2xs text-fg-subtle">
                            {tc.t(detailKey(command.token))}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
