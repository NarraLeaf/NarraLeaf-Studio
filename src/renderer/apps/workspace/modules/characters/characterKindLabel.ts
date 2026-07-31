import type { TranslationKey } from "@shared/i18n";
import type { CharacterAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import { knownPuppetRuntimeFor } from "@shared/utils/puppetRuntimes";

/**
 * Written out rather than interpolated so the keys stay statically checkable against the catalogue.
 *
 * `live2d` and `spine` are absent on purpose: what to call them is the product's own name, which is a
 * trademark and therefore never enters the i18n catalogue — it reads the same in every language and
 * translating it would be wrong rather than merely unnecessary.
 */
const KIND_LABELS = {
    preset: "characters.editor.kind.preset",
    layered: "characters.editor.kind.layered",
    puppet: "characters.editor.kind.puppet",
} as const satisfies Partial<Record<CharacterAppearanceKind, TranslationKey>>;

/**
 * What to call an appearance kind in the UI: a translated phrase for the kinds Studio draws itself,
 * and the runtime's own product name for the kinds it does not.
 *
 * Shared by the creation menu and the editor header so the author sees the same word in both — the
 * menu is where they pick a kind and the header is where they confirm what they picked, and those
 * disagreeing is how "External runtime" became unrecognisable in the first place.
 */
export function characterKindLabel(
    kind: CharacterAppearanceKind,
    t: (key: TranslationKey) => string,
): string {
    const runtime = knownPuppetRuntimeFor(kind);
    if (runtime) {
        return runtime.productName;
    }
    // Every remaining kind has a key; the cast is the price of a table that deliberately omits some.
    return t(KIND_LABELS[kind as keyof typeof KIND_LABELS]);
}
