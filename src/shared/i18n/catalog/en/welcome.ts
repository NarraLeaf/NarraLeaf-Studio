/**
 * `welcome` - the Welcome editor tab.
 *
 * It used to carry a tagline and a four-step "Getting Started" guide. Both were help text living in
 * a surface (docs/help-system.md §1): the four steps are now the `workspaceLayout`, `assets`,
 * `storyScene` and `runModes` topics, which the tab links to instead of restating.
 */
export const welcome = {
    quickActions: {
        newScene: {
            label: "New Scene",
            description: "Add a scene and start writing.",
        },
        openAssets: {
            label: "Open Assets",
            description: "Bring in images, audio and video.",
        },
        help: {
            label: "Help",
            description: "How the parts of Studio behave.",
        },
    },
    reopenHint: {
        menu: "Reopen this page from Help → Open Welcome.",
        palette: "Reopen this page by searching \"Open Welcome\" in the command palette.",
    },
} as const;
