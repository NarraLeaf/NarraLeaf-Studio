/** `devMode` - the Dev Mode window/overlay: run surface, session status, and the live-debug tools. */
export const devMode = {
    title: "Dev Mode",
    dismiss: "Dismiss",
    surfaceUnavailable: "Surface not available",
    waitingPayload: "Waiting for Dev Mode payload…",
    surfaceNotFound: "Surface not found: {surfaceId}",
    issues: {
        atLine: "Line {line} · {scene}",
        inScene: "In {scene}",
        noLocation: "Could not be traced to a line",
        viaPlayHead: "where playback was",
        openInStudio: "Open in Studio",
        openFailed: "No workspace window is open for this project.",
        stack: "Stack",
        dismissAll: "Dismiss all ({count})",
        summary: "{errors} errors · {warnings} warnings",
    },
    // The drawer's panels are named for their SUBJECT, one word each: Story, Interface, Debugger.
    // They are parallel on purpose - "Story Runtime" and "Blueprint DevTools" beside each other read
    // as two products rather than as two views of one running game, and the drawer only ever shows
    // one at a time. The key groups still carry their old names; the panels do not.
    devtools: {
        title: "Interface",
        menuAria: "Preview debug tools",
        openMenu: "Open preview debug tools menu",
        closeMenu: "Close preview debug tools menu",
        panelsAria: "Interface panels",
        skipToNextChoice: "Skip to next choice",
        skipToNextChoiceBusy: "Skipping…",
    },
    tabs: {
        blueprints: "Blueprints",
        output: "Output",
        // NOT "Scope": the debugger has a tab by that name holding a paused frame's variables, and
        // this one holds the host's own runtime state, which belongs to no frame.
        uiState: "UI state",
        variables: "Variables",
        context: "Context",
        timeline: "Timeline",
        scene: "Scenes",
    },
    runtime: {
        title: "Story",
        panelsAria: "Story panels",
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
    /**
     * The blueprint debugger: breakpoints, the stop, and stepping. Every label here is the DevTools
     * word for the same idea - an author who has debugged JavaScript already knows what "Step over"
     * does, and inventing a different word would only cost them that.
     */
    debugger: {
        title: "Debugger",
        openGraph: "Show graph",
        graphPicker: "Graph",
        pickGraph: "Pick a graph to view.",
        statusRunning: "Running",
        statusPausePending: "Pausing at the next node…",
        statusBreakpoint: "Paused on a breakpoint",
        statusStepped: "Paused",
        resume: "Resume",
        pause: "Pause",
        stepOver: "Step over",
        stepInto: "Step into",
        stepOut: "Step out",
        callStack: "Call stack",
        scope: "Scope",
        scopeEmpty: "No variables in scope",
        eventPayload: "Event",
        nodeOutputs: "Node outputs",
        breakpoints: "Breakpoints",
        breakpointsEmpty: "No breakpoints. Right-click a node in the graph to add one.",
        removeAllBreakpoints: "Remove all breakpoints",
        missingNode: "Missing node",
        syncGraphNotice: "This graph is evaluated synchronously, so breakpoints in it never stop.",
    },
    /**
     * The Saves panel: the slots on disk, what is inside the selected one, and the project-wide
     * persistent store that is inside none of them.
     *
     * The failure wording is deliberately flat. Loading an old save into an edited story is where
     * saves end up, not an accident, so the text names the one fact an author can act on - which
     * element the save still poses - and says what happened to the run, and stops.
     */
    saves: {
        title: "Saves",
        refresh: "Refresh",
        slots: "Slots",
        noSaves: "No saves",
        load: "Load save",
        delete: "Delete save",
        selectSlot: "Select a save to read it",
        unreadable: "This save could not be read",
        contents: "Contents",
        noStory: "No story is running, so namespaces cannot be named",
        savedScope: "Var",
        unclaimed: "Unclaimed keys",
        visited: "Visited",
        visitedScenes: "Scenes",
        visitedOptions: "Options",
        loaded: "Loaded",
        loadedWithLosses: "Loaded, with losses",
        droppedBacklog: "Backlog lines dropped: {count} of {total}. Their rows no longer exist.",
        unclaimedOnLoad: "Keys with no declared variable: {count}",
        missingElement: "This save poses an element the story no longer has: {id}",
        sessionRestored: "The previous run was restarted.",
        sessionLost: "The run could not be restarted.",
        persistent: "Persistent",
        noPersistent: "No persistent variables declared",
        otherKeys: "Other keys",
    },
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
    // Interface ▸ UI state. Host runtime state, not a call frame's scope - the group is named for
    // the tab so the two "scope"s in this drawer stay one word apart in the source as well.
    // No `persistence` key: that block moved to the Saves panel, which shows the same store by name.
    uiState: {
        surface: "Surface",
        global: "Global",
        widget: "Widget",
        hover: "hover",
        active: "active",
        focus: "focus",
        variants: "variants",
    },
} as const;
