import { useMemo } from "react";
import { Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { deviceDefaultLocale } from "@/lib/i18n/deviceLocale";
import { getLocaleMeta, getRegisteredLocales } from "@shared/i18n";

/**
 * The interface language, which by the time this screen is on screen has already been applied.
 *
 * There is nothing to preselect here: an unset `app.language` resolves to the device's own
 * language before the first paint (`lib/i18n/bootstrap`), so the window someone is reading this
 * in is already in the language the picker shows. Changing it re-renders everything immediately,
 * which is what makes this a question worth asking first - the answer proves itself.
 *
 * The option list comes from the live registry rather than the static locale table, because a
 * plugin language pack registers at runtime and the settings window reads it the same way.
 */
export function LanguageStep() {
    const { t, locale, setLocale } = useTranslation();

    const options = useMemo(
        () => getRegisteredLocales().map(code => ({
            value: code,
            // Endonyms, never translated: someone who cannot read the current language has to be
            // able to find their own in this list.
            label: getLocaleMeta(code).nativeName,
        })),
        // Re-read on a language change: that is also when a pack may have been registered.
        [locale],
    );

    // A statement about the value, not about how it got there - true whether it was resolved from
    // the device or picked here a moment ago, which is the only reading that stays honest.
    const matchesDevice = locale === deviceDefaultLocale();

    return (
        <div className="flex items-center gap-3">
            <div className="w-56">
                <Select
                    fullWidth
                    options={options}
                    value={locale}
                    onChange={value => setLocale(String(value))}
                    ariaLabel={t("settings.items.language.label")}
                />
            </div>
            {matchesDevice && (
                <span className="text-xs text-fg-subtle">
                    {t("onboarding.language.matchedToDevice")}
                </span>
            )}
        </div>
    );
}
