import type { HelpBrowserResource } from "./HelpBrowser";

/**
 * The pages that are deliberately not bundled: the site, the repositories.
 *
 * Listed as the last section of the help browser, below the topics, in both windows. Titles are
 * authored strings (Chinese-first, like the audience); every URL must be http(s), because the row
 * opens it through `app.openExternal`, which refuses anything else.
 */
export const HELP_RESOURCES: readonly HelpBrowserResource[] = [
    {
        id: "docs-studio",
        title: "Studio 文档",
        url: "https://www.narraleaf.com/docs/studio",
    },
    {
        id: "docs-website",
        title: "NarraLeaf 官网",
        url: "https://www.narraleaf.com",
    },
    {
        id: "docs-github",
        title: "GitHub 组织",
        url: "https://github.com/NarraLeaf",
    },
    {
        id: "docs-narraleaf-react",
        title: "引擎仓库 narraleaf-react",
        url: "https://github.com/NarraLeaf/narraleaf-react",
    },
];
