import type { TranslationKey } from "@shared/i18n";
import type { PaletteActionCommand } from "../storyActionCommands";
import type { StoryCommandContext } from "../storyCommandValues";
import { commandDetailKey, commandLabelKey, getCommandSpec, listCommandSpecs } from "./registry";

/**
 * The command specs projected onto the palette-command shape every menu renders.
 *
 * Since A1 this is the ONLY catalogue: the `/` menu lists these entries one per spec, and the sidebar
 * lists the same entries re-filed by subject (see `specSidebar.ts`). The `/`-spelled aliases feed
 * `searchActionCommands`' exact tier, so typing a token finds its command by name too.
 */

type SpecCommandTranslate = (key: TranslationKey) => string;

const SPEC_PALETTE: readonly PaletteActionCommand[] = listCommandSpecs().map(spec => ({
    id: spec.id,
    group: spec.category,
    label: spec.id,
    detail: "",
    // The spec's own glyph, not its group's: the icon says the verb while the group's colour still
    // says the subject (see `StoryCommandSpec.icon`).
    icon: spec.icon,
    aliases: [spec.token, ...(spec.aliases ?? [])].map(alias => `/${alias}`),
}));

export function specPaletteCommands(): readonly PaletteActionCommand[] {
    return SPEC_PALETTE;
}

/**
 * Whether this project has anything for the command to name - `StoryCommandSpec.available`, read
 * through the palette id.
 *
 * Applied by the surfaces rather than inside {@link specPaletteCommands}, which is a module constant
 * built once with no project in sight. An id with no spec is a plugin action, which declares no rule
 * and is therefore always available.
 */
export function isSpecCommandAvailable(commandId: string, context: StoryCommandContext): boolean {
    return getCommandSpec(commandId)?.available?.(context) ?? true;
}

/** The entries this project can act on. Every browse surface filters through this one call. */
export function availableSpecCommands(
    commands: readonly PaletteActionCommand[],
    context: StoryCommandContext,
): readonly PaletteActionCommand[] {
    return commands.filter(command => isSpecCommandAvailable(command.id, context));
}

/**
 * A spec palette entry with its display strings swapped to the active locale. The label reads the same
 * `story.command.<id>.label` key the parser's localized token table does (`commandLabelKey`), so the
 * word the menu shows and the word the author can type inline are always one and the same.
 *
 * Callers pass the COMMAND-language translator (`useCommandTranslation`), not the interface one — the
 * menu is the vocabulary's own surface, and it has to agree with the table the parser consults, which
 * is keyed on that same locale.
 */
export function localizeSpecCommand(command: PaletteActionCommand, t: SpecCommandTranslate): PaletteActionCommand {
    return {
        ...command,
        label: t(commandLabelKey(command.id)),
        detail: t(commandDetailKey(command.id)),
    };
}
