import { useState } from "react";
import { isBrandLink } from "@shared/brand/brandLink";
import { useTranslation } from "@/lib/i18n";
import { ColorPickerTrigger } from "../framework/fields/ColorPickerField";
import { addRecentColor } from "../framework/fields/recentColors";
import { parseColorValue, serializeColorValue } from "../framework/utils/colorUtils";
import type { ColorValue, CustomFieldProps } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * What the picker opens on for a character that has none yet. Only ever a starting point for the
 * eye — it is never written on its own, so "no colour" and "this colour" stay different states.
 */
const DEFAULT_CHARACTER_COLOR = "#40A8C4";

/**
 * The character's accent colour — the tint its nametag carries.
 *
 * A `custom` field rather than the framework's `colorPicker` for one reason: the model's `color` is
 * *optional*, and a `colorPicker` has no way to express "none". Its `getValue` must return a
 * `ColorValue`, so the panel would open on some colour and the author would have no way back to the
 * unset state — a set accent would be unremovable. So the picker is paired with a clear.
 *
 * **Three states, not two.** No colour, a literal, and a `nlbrand:` link at the project palette; the
 * third is why the value goes through `parseColorValue` / `serializeColorValue` rather than
 * `normalizeHex` in both directions. Storing the link is the whole point of picking one: a character
 * whose accent is `nlbrand:primary` follows the brand when the author changes it, where a hex frozen
 * out of the palette today would not. Clearing still writes `undefined`, which is neither.
 *
 * Opacity is off. A half-transparent nametag is not a thing any of the surfaces that read this can
 * honour, and the picker's own alpha for a link is left exactly as the palette entry's, so
 * `serializeColorValue` writes the short `nlbrand:<id>` form rather than pinning a number the author
 * never chose. A link to a *translucent* entry therefore resolves to `rgba(...)`, which the readable
 * band and the runtime nametag both refuse — the same answer they have always given a colour they
 * cannot spell as a hex.
 *
 * Nothing here judges the colour otherwise. The readability band (`readableAccentColor`) belongs to
 * the surfaces that paint Studio chrome with it, and the runtime nametag deliberately does not apply
 * it — so a colour this field accepts may show in the game and not in the editor's rows.
 */
export function CharacterColorField({ data }: CustomFieldProps<CharacterEditorContext>) {
    const { t } = useTranslation();
    const profile = data.character.profile;
    const [stored, setStored] = useState<string | undefined>(() => profile.getColor());
    // Live while the panel is open, committed to the model when it closes: `onChange` fires on every
    // frame of a drag across the colour map, and each one would be a project write.
    const [draft, setDraft] = useState<ColorValue | null>(null);

    const commit = (next: string | undefined): void => {
        setDraft(null);
        setStored(next);
        profile.setColor(next);
        // Literals only — a link is not recorded at all, and the resolved literal is not recorded in
        // its place. The strip paints each entry by dropping the string straight into
        // `backgroundColor` (`ProjectPalette`), so the token itself would paint nothing; and a
        // resolved copy would sit there as a bare square indistinguishable from the palette's own,
        // except that picking it hands back a hex that has stopped following the brand. Recents
        // exist to bring back a colour that is otherwise hard to find again, and a palette entry has
        // its own labelled row in this very picker.
        if (next && !isBrandLink(next)) {
            addRecentColor(next);
        }
    };

    // A link is resolved for display and its id kept on the result, which is what carries it back
    // out through `serializeColorValue` when the author only nudges the opacity or reopens the panel.
    const parsed = stored
        ? parseColorValue(stored, { hex: DEFAULT_CHARACTER_COLOR, alpha: 1 })
        : null;

    return (
        <div className="flex items-center gap-2">
            <ColorPickerTrigger
                value={draft ?? parsed ?? { hex: DEFAULT_CHARACTER_COLOR, alpha: 1 }}
                displayMode="icon-hex"
                allowOpacity={false}
                brandPalette
                onChange={setDraft}
                onCommit={next => commit(serializeColorValue(next))}
            />
            {stored && (
                <button
                    type="button"
                    className="text-xs text-danger hover:text-danger/80"
                    onClick={() => commit(undefined)}
                >
                    {t("common.clear")}
                </button>
            )}
        </div>
    );
}
