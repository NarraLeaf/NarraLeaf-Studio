import { Monitor, Moon, Sun } from "lucide-react";
import { FieldLabel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { ACCENT_PRESETS, ACCENT_SWATCHES } from "@shared/constants/accent";
import type { TranslationKey } from "@shared/i18n";
import { useOnboardingPreferences } from "../onboardingPreferences";
import { OptionList } from "./OptionList";

/**
 * Theme and accent, both applied the instant they are picked.
 *
 * The option names are read from the `settings` namespace rather than restated in this flow's own:
 * these are the same two preferences the Settings window edits, and a second spelling of "Follow
 * system" is how two surfaces end up describing one choice differently.
 *
 * No preview tiles for the theme, and none needed: the theme is applied by the main process to every
 * window's `prefers-color-scheme`, so the window this screen is in - and the sample beside it -
 * repaint on the click. A picture of what the choice would look like, next to the thing already
 * looking like it, is a drawing of the present.
 *
 * Presets only, no custom colour picker. `@shared/constants/accent` calls the presets "the guided
 * path", and a first run is that path; a particular hex stays in Settings, where somebody who wants
 * one has gone looking for it.
 */
const THEME_OPTIONS: { value: string; labelKey: TranslationKey; icon: typeof Monitor }[] = [
    { value: "auto", labelKey: "settings.items.themeMode.options.auto", icon: Monitor },
    { value: "light", labelKey: "settings.items.themeMode.options.light", icon: Sun },
    { value: "dark", labelKey: "settings.items.themeMode.options.dark", icon: Moon },
];

const ACCENT_LABEL_KEYS: Record<string, TranslationKey> = {
    teal: "settings.items.accentColor.options.teal",
    sky: "settings.items.accentColor.options.sky",
    indigo: "settings.items.accentColor.options.indigo",
    rose: "settings.items.accentColor.options.rose",
    slate: "settings.items.accentColor.options.slate",
};

export function AppearanceStep() {
    const { t } = useTranslation();
    const { themeMode, setThemeMode, accentColor, setAccentColor } = useOnboardingPreferences();

    return (
        <div className="space-y-5">
            <div>
                <FieldLabel as="div">{t("settings.items.themeMode.label")}</FieldLabel>
                <OptionList
                    label={t("settings.items.themeMode.label")}
                    value={themeMode}
                    options={THEME_OPTIONS.map(option => ({
                        value: option.value,
                        label: t(option.labelKey),
                        icon: option.icon,
                    }))}
                    onChange={setThemeMode}
                />
            </div>

            <div>
                <FieldLabel as="div">{t("settings.items.accentColor.label")}</FieldLabel>
                {/* The same strip the Settings window draws, down to where the selection ring sits:
                    outside the swatch, so the colour being judged is never painted over. */}
                <div
                    className="flex flex-wrap items-center gap-2.5"
                    role="radiogroup"
                    aria-label={t("settings.items.accentColor.label")}
                >
                    {ACCENT_PRESETS.map(preset => {
                        const selected = preset.id === accentColor;
                        const name = t(ACCENT_LABEL_KEYS[preset.id]);
                        return (
                            <button
                                key={preset.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={name}
                                data-tip={name}
                                onClick={() => setAccentColor(preset.id)}
                                className={`h-5 w-5 rounded-full transition duration-150 ${
                                    selected
                                        ? "ring-2 ring-offset-2 ring-fg/60 ring-offset-surface"
                                        : "ring-1 ring-inset ring-edge-strong hover:scale-110"
                                }`}
                                style={{ backgroundColor: ACCENT_SWATCHES[preset.id] }}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
