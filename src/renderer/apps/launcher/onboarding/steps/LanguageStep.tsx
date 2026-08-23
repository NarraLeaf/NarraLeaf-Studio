import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { deviceDefaultLocale } from "@/lib/i18n/deviceLocale";
import { getLocaleMeta, getRegisteredLocales } from "@shared/i18n";
import { OptionList } from "./OptionList";

/**
 * The interface language, which by the time this screen is on screen has already been applied.
 *
 * There is nothing to preselect here: an unset `app.language` resolves to the device's own language
 * before the first paint (`lib/i18n/bootstrap`), so the window someone is reading this in is already
 * in the language the list shows. Changing it re-renders everything immediately - the window, and
 * the sample beside it, down to the words a story command is spelled with - which is what makes this
 * a question worth asking first: the answer proves itself.
 *
 * The list comes from the live registry rather than the static locale table, because a plugin
 * language pack registers at runtime and the settings window reads it the same way.
 */
/**
 * The registry's languages, with this machine's own first.
 *
 * The device's language is the answer for almost everybody, it is already the one applied (an unset
 * `app.language` resolves through the same walk before the first paint), and it is the one entry a
 * reader is scanning for. Putting it at the head of a list rather than wherever the registry
 * happens to file it is what makes the first row the answer.
 *
 * The rest keep the registry's order, which is the order the settings window lists them in.
 */
function orderedLocales(): readonly string[] {
    const device = deviceDefaultLocale();
    const rest = getRegisteredLocales().filter(code => code !== device);
    return getRegisteredLocales().includes(device) ? [device, ...rest] : rest;
}

export function LanguageStep() {
    const { t, locale, setLocale } = useTranslation();

    const options = useMemo(
        () => orderedLocales().map(code => {
            const meta = getLocaleMeta(code);
            return {
                value: code,
                // Endonyms, never translated: someone who cannot read the current language has to be
                // able to find their own in this list.
                label: meta.nativeName,
                // The English name under it, for the same reason in reverse - and, on the entry that
                // matches this machine, a note that it is where an unset preference already landed.
                hint: code === deviceDefaultLocale()
                    ? `${meta.englishName} · ${t("onboarding.language.matchedToDevice")}`
                    : meta.englishName,
            };
        }),
        // Re-read on a language change: that is also when a pack may have been registered.
        [locale, t],
    );

    return (
        <OptionList
            label={t("settings.items.language.label")}
            value={locale}
            options={options}
            onChange={setLocale}
        />
    );
}
