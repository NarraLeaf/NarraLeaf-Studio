/**
 * `welcome` - the Welcome editor tab.
 *
 * The title and subtitle greet; they do not explain. The four-step "Getting Started" guide that used
 * to sit under them was help text living in a surface (docs/help-system.md §1): those steps are the
 * `workspaceLayout`, `assets`, `storyScene` and `runModes` topics, which the tab links to instead of
 * restating.
 */
export const welcome = {
    title: "Nice to meet you",
    subtitle: "Welcome to NarraLeaf Studio. Ready to begin?",
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
