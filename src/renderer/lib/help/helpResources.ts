import type { TranslationKey } from "@shared/i18n";
import type { HelpBrowserResource } from "./HelpBrowser";

/**
 * The pages that are deliberately not bundled: the site, the repositories.
 *
 * Listed as the last section of the help browser, below the topics, in both windows. Titles come
 * from the `help.resourceTitles` catalog rather than being written here, so they follow the
 * interface language; every URL must be http(s), because the row opens it through
 * `app.openExternal`, which refuses anything else.
 */
export const HELP_RESOURCES: readonly HelpBrowserResource[] = [
  {
    id: "docs-studio",
    titleKey: "help.resourceTitles.docs" as TranslationKey,
    url: "https://www.narraleaf.com/docs/studio"
  },
  {
    id: "docs-website",
    titleKey: "help.resourceTitles.site" as TranslationKey,
    url: "https://www.narraleaf.com"
  },
  {
    id: "docs-github",
    titleKey: "help.resourceTitles.github" as TranslationKey,
    url: "https://github.com/NarraLeaf"
  },
  {
    id: "docs-narraleaf-react",
    titleKey: "help.resourceTitles.engine" as TranslationKey,
    url: "https://github.com/NarraLeaf/narraleaf-react"
  }
];
