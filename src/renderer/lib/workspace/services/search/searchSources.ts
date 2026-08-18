import type { SearchSource } from "./searchSource";
import { assetSource } from "./sources/assetSource";
import { blueprintSource } from "./sources/blueprintSource";
import { characterSource } from "./sources/characterSource";
import { localizationKeySource } from "./sources/localizationKeySource";
import { storySource } from "./sources/storySource";
import { surfaceSource } from "./sources/surfaceSource";

/**
 * Everything that is searchable in a project. This array is the whole answer to that question -
 * `SearchService` reads nothing else, and knows nothing about what is in here.
 *
 * To make a new kind of thing searchable: write one descriptor under `sources/`, add one line here.
 * (A brand-new result *group* additionally needs a title in the i18n catalogs and a row in
 * `SearchPanel`'s `SEARCH_GROUP_TITLE_KEYS` - a group heading is a human-written sentence and there
 * is nowhere else it could come from. A source that produces only existing groups needs neither.)
 *
 * Order is presentation-neutral - results are grouped by {@link SEARCH_GROUP_ORDER}, not by source -
 * but it does decide which entry wins a score tie, so it stays as it is unless there is a reason.
 */
export const SEARCH_SOURCES: readonly SearchSource<any>[] = [
  storySource,
  blueprintSource,
  localizationKeySource,
  assetSource,
  characterSource,
  surfaceSource
];
