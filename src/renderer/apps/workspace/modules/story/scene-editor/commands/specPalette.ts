import type { TranslationKey } from "@shared/i18n";
import type { PaletteActionCommand } from "../storyActionCommands";
import { getCommandGroup } from "../storyCommandCategories";
import { commandDetailKey, commandLabelKey, listCommandSpecs } from "./registry";

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
    icon: getCommandGroup(spec.category).icon,
    aliases: [spec.token, ...(spec.aliases ?? [])].map(alias => `/${alias}`),
}));

export function specPaletteCommands(): readonly PaletteActionCommand[] {
    return SPEC_PALETTE;
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
