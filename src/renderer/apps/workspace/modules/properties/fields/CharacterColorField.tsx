import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { ColorPickerTrigger } from "../framework/fields/ColorPickerField";
import { addRecentColor } from "../framework/fields/recentColors";
import { normalizeHex } from "../framework/utils/colorUtils";
import type { CustomFieldProps } from "../framework/types";
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
 * The value is stored as a plain hex string, which is what every consumer already reads (the story
 * rows, the Dev Mode timeline, the runtime nametag). The framework's `{hex, alpha}` is converted at
 * this boundary and opacity is off: a half-transparent nametag is not a thing any of the three
 * surfaces can honour.
 *
 * Nothing here judges the colour. The readability band (`isReadableAccentColor`) belongs to the
 * surfaces that paint Studio chrome with it, and the runtime nametag deliberately does not apply it
 * — so a colour this field accepts may show in the game and not in the editor's rows.
 */
export function CharacterColorField({ data }: CustomFieldProps<CharacterEditorContext>) {
    const { t } = useTranslation();
    const profile = data.character.profile;
    const [color, setColor] = useState<string | undefined>(() => profile.getColor());
    // Live while the panel is open, committed to the model when it closes: `onChange` fires on every
    // frame of a drag across the colour map, and each one would be a project write.
    const [draft, setDraft] = useState<string | null>(null);

    const commit = (next: string | undefined): void => {
        setDraft(null);
        setColor(next);
        profile.setColor(next);
        if (next) {
            addRecentColor(next);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <ColorPickerTrigger
                value={{ hex: draft ?? color ?? DEFAULT_CHARACTER_COLOR, alpha: 1 }}
                displayMode="icon-hex"
                allowOpacity={false}
                onChange={next => setDraft(normalizeHex(next.hex) ?? next.hex)}
                onCommit={next => commit(normalizeHex(next.hex) ?? undefined)}
            />
            {color && (
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
