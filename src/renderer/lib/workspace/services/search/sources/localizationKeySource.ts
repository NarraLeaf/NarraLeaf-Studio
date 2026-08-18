import type { LocalizationKeysDocument } from "@shared/types/localization";
import { Services } from "../../services";
import { LocalizationService } from "../../localization/LocalizationService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

/** Named UI text keys: searchable by key name (title) and by source text (detail). */
export function extractLocalizationKeyEntries(
  document: LocalizationKeysDocument
): SearchIndexEntry[] {
  return Object.entries(document.keys).map(([name, definition]) => ({
    id: `uikey:${name}`,
    group: "uiTextKey" as const,
    text: name,
    detail: definition.sourceText || undefined,
    target: { kind: "localizationKey" as const, keyName: name }
  }));
}

/**
 * The named-key registry, in one slice.
 *
 * No `dedupKey`: the entries come from object keys, so they are unique by construction.
 */
export const localizationKeySource: SearchSource = {
  id: "localizationKey",
  groups: ["uiTextKey"],
  dependsOn: [Services.Localization],
  extract: async (ctx) => {
    const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
    return extractLocalizationKeyEntries(await localizationService.loadKeys());
  },
  watch: (ctx, signal) =>
    ctx.services
      .get<LocalizationService>(Services.Localization)
      .onKeysChanged(() => signal.invalidate())
};
