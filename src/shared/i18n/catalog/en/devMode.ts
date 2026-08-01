/** `devMode` - the Dev Mode window/overlay: run surface, session status, and the live-debug tools. */
export const devMode = {
    title: "Dev Mode",
    dismiss: "Dismiss",
    surfaceUnavailable: "Surface not available",
    waitingPayload: "Waiting for Dev Mode payload…",
    surfaceNotFound: "Surface not found: {surfaceId}",
    devtools: {
        title: "Blueprint DevTools",
        menuAria: "Preview debug tools",
        openMenu: "Open preview debug tools menu",
        closeMenu: "Close preview debug tools menu",
        panelsAria: "Debug panels",
        skipToNextChoice: "Skip to next choice",
        skipToNextChoiceBusy: "Skipping…",
    },
    tabs: {
        blueprints: "Blueprints",
        output: "Output",
        scope: "Scope",
        variables: "Variables",
        context: "Context",
        timeline: "Timeline",
        scene: "Scenes",
    },
    runtime: {
        title: "Story Runtime",
        panelsAria: "Story runtime panels",
        snapshot: "Snapshot",
        snapshotDefault: "Defaults",
        noStory: "No story is running",
        noVariables: "No variables declared",
        noRows: "No rows in this scene",
        // Execution context: the scene that is running, the containers the play head sits inside, and
        // the branches of a parallel. Headings only - each one is followed by the answer.
        contextScene: "Scene",
        contextInside: "Inside",
        contextRunning: "Running",
        currentScene: "Current",
        // Scene map: the numeric counter the map is labelled against, and the value the RUNNING game
        // currently holds for it (shown only when the runtime can actually answer — a default is not
        // a live value).
        focusNone: "No focus",
        focusLive: "Live value",
    },
    // The debug drawer's dock/float toggle. Each label names what the click will DO, not the state
    // it is in - same shape as `devtools.openMenu` / `devtools.closeMenu` above, and the only thing
    // that tells a reader (or an acceptance run) which mode the panel is currently in.
    panel: {
        float: "Float panel",
        dock: "Dock panel",
    },
    blueprints: {
        empty: "No blueprints",
        openWorkspace: "Workspace",
        cannotOpen: "This blueprint cannot be opened from preview.",
        openFailed: "Unable to open blueprint.",
    },
    output: {
        logLevel: "Log Level",
        empty: "No output",
        level: {
            log: "Log",
            verbose: "Verbose",
        },
    },
    scope: {
        surface: "Surface",
        global: "Global",
        persistence: "Persistence",
        widget: "Widget",
        hover: "hover",
        active: "active",
        focus: "focus",
        variants: "variants",
    },
} as const;
