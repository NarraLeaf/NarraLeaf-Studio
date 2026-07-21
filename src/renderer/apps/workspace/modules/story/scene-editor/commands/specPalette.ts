import type { TranslationKey } from "@shared/i18n";
import { getActionCommandCategory, type PaletteActionCommand } from "../storyActionCommands";
import { commandDetailKey, commandLabelKey, listCommandSpecs } from "./registry";

/**
 * The command specs projected onto the palette-command shape the slash menu renders.
 *
 * The menu lists LINE commands - one entry per spec, labelled from `story.command.<id>.*` - while
 * the sidebar palette keeps listing block types (`ACTION_COMMANDS`). The `/`-spelled aliases feed
 * `searchActionCommands`' exact tier, so typing a token finds its command by name too.
 */

type SpecCommandTranslate = (key: TranslationKey) => string;

const SPEC_PALETTE: readonly PaletteActionCommand[] = listCommandSpecs().map(spec => ({
    id: spec.id,
    category: spec.category,
    label: spec.id,
    detail: "",
    icon: getActionCommandCategory(spec.category).icon,
    aliases: [spec.token, ...(spec.aliases ?? [])].map(alias => `/${alias}`),
}));

export function specPaletteCommands(): readonly PaletteActionCommand[] {
    return SPEC_PALETTE;
}

/**
 * A spec palette entry with its display strings swapped to the active locale. The label reads the same
 * `story.command.<id>.label` key the parser's localized token table does (`commandLabelKey`), so the
 * word the menu shows and the word the author can type inline are always one and the same.
 */
export function localizeSpecCommand(command: PaletteActionCommand, t: SpecCommandTranslate): PaletteActionCommand {
    return {
        ...command,
        label: t(commandLabelKey(command.id)),
        detail: t(commandDetailKey(command.id)),
    };
}
