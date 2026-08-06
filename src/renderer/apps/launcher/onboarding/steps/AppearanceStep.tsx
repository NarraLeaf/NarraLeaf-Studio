import { FieldLabel, Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { ACCENT_COLOR_DEFAULT, ACCENT_PRESETS, ACCENT_SWATCHES } from "@shared/constants/accent";
import type { TranslationKey } from "@shared/i18n";
import { useGlobalPreference } from "../useGlobalPreference";

/**
 * Both option lists are read from the `settings` namespace rather than restated in the onboarding
 * one: these are the same two preferences the Settings window edits, and a second spelling of
 * "Follow system" is how two surfaces end up describing one choice differently.
 */
const THEME_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
    { value: "auto", labelKey: "settings.items.themeMode.options.auto" },
    { value: "light", labelKey: "settings.items.themeMode.options.light" },
    { value: "dark", labelKey: "settings.items.themeMode.options.dark" },
];

const ACCENT_LABEL_KEYS: Record<string, TranslationKey> = {
    teal: "settings.items.accentColor.options.teal",
    sky: "settings.items.accentColor.options.sky",
    indigo: "settings.items.accentColor.options.indigo",
    rose: "settings.items.accentColor.options.rose",
    slate: "settings.items.accentColor.options.slate",
};

/**
 * Theme and accent, both applied the instant they are picked.
 *
 * No preview tiles. The window this screen is in repaints on every click - a picture of what the
 * choice would look like, next to the thing already looking like it, is a drawing of the present.
 *
 * Presets only, no custom color picker. `@shared/constants/accent` calls the presets "the guided
 * path", and a first run is that path; anything else stays in Settings, where someone who wants a
 * particular hex has gone looking for it.
 */
export function AppearanceStep() {
    const { t } = useTranslation();
    const [themeMode, setThemeMode] = useGlobalPreference("ui.themeMode", "auto");
    const [accent, setAccent] = useGlobalPreference("ui.accentColor", ACCENT_COLOR_DEFAULT);

    return (
        <div className="space-y-5">
            <div>
                <FieldLabel as="div">{t("settings.items.themeMode.label")}</FieldLabel>
                <div className="w-56">
                    <Select
                        fullWidth
                        options={THEME_OPTIONS.map(option => ({ value: option.value, labelKey: option.labelKey }))}
                        value={themeMode}
                        onChange={value => setThemeMode(String(value))}
                        ariaLabel={t("settings.items.themeMode.label")}
                    />
                </div>
            </div>

            <div>
                <FieldLabel as="div">{t("settings.items.accentColor.label")}</FieldLabel>
                {/* The same strip the Settings window draws, down to where the selection ring
                    sits: outside the swatch, so the color being judged is never painted over. */}
                <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("settings.items.accentColor.label")}>
                    {ACCENT_PRESETS.map(preset => {
                        const selected = preset.id === accent;
                        const name = t(ACCENT_LABEL_KEYS[preset.id]);
                        return (
                            <button
                                key={preset.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={name}
                                title={name}
                                onClick={() => setAccent(preset.id)}
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
