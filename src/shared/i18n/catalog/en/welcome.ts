/**
 * `welcome` - the Welcome editor tab.
 *
 * The title names the product and the subtitle names the three ways in. The four-step "Getting Started" guide that used
 * to sit under them was help text living in a surface (docs/help-system.md §1): those steps are the
 * `workspaceLayout`, `assets`, `storyScene` and `runModes` topics, which the tab links to instead of
 * restating.
 */
export const welcome = {
    title: "Welcome to NarraLeaf Studio",
    subtitle: "Start with a scene, the asset library, or the help browser.",
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
