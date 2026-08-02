/** `welcome` - the Welcome editor tab (intro header and getting-started guide). */
export const welcome = {
    tagline: "All-in-one IDE for NarraLeaf Projects.",
    quickActions: {
        newScene: {
            label: "New Scene",
            description: "Add a scene to your story and start writing.",
        },
        openAssets: {
            label: "Open Assets",
            description: "Bring in images, audio and video.",
        },
        tutorials: {
            label: "View Tutorials",
            description: "Open the Studio documentation in your browser.",
        },
    },
    reopenHint: {
        menu: "You can reopen this page any time from Help → Open Welcome.",
        palette: "You can reopen this page any time by searching \"Open Welcome\" in the command palette.",
    },
    gettingStarted: {
        title: "Getting Started",
        step1: {
            title: "Explore the Workspace",
            description: "Panels live in the left sidebar; inspectors and other tools go on the right.",
        },
        step2: {
            title: "Manage Assets",
            description: "Import images, audio and video into the Assets panel.",
        },
        step3: {
            title: "Create Story",
            description: "Write scenes and dialogue in the story editor.",
        },
        step4: {
            title: "Test Run",
            description: "Press Run to play the game and see your changes.",
        },
    },
} as const;
