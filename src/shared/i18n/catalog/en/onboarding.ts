/**
 * `onboarding` - first-run setup, shown in the launcher window before the home screen.
 *
 * Only the words this flow owns. Every question it asks is a preference that already has a row in
 * Settings, so the labels and the option names are read from the `settings` namespace rather than
 * restated here: a second spelling of "Follow system" is how the setup screen and the Settings
 * window end up describing one choice differently. The same rule applies to the words inside the
 * preview - the story row placeholders come from `story.rows.*`, because that is the sentence the
 * editor itself prints.
 *
 * Each screen carries one line under its title. That line is the "expectation" layer of
 * docs/help-system.md §1 - what happens if you touch this - and is the whole reason setup needs
 * no help topics of its own: this is the surface that has to explain itself.
 */
export const onboarding = {
    /**
     * The title bar, for the whole flow rather than per screen.
     *
     * The one place setup says what it is a setup OF. Each screen's heading is the question it
     * asks, which leaves nothing naming the product - and this is the first window anyone sees.
     * `{name}` is `APP_DISPLAY_NAME`, so the two cannot drift apart.
     */
    windowTitle: "Welcome to {name}",
    /**
     * How far into the flow, above every screen's heading.
     *
     * A count and not a percentage: the screens are few enough to be named (they are, in the rail),
     * and "3 / 7" answers "how much is left" without pretending the seventh screen is as much work
     * as the first.
     */
    progress: "{current} / {total}",
    /**
     * The rail down the left, naming the screens.
     *
     * Present because the flow is seven screens rather than three: what a rail answers is "how much
     * of this is left", and at three screens with a Skip button on every one of them there was
     * nothing to answer. Same component shape as the project wizard's rail, so the two multi-page
     * flows in this product do not disagree about where "where am I" is written.
     */
    steps: {
        language: "Language",
        appearance: "Appearance",
        zoom: "Zoom",
        identity: "Author",
        team: "Team",
        story: "Story editor",
        done: "Done",
    },
    language: {
        title: "Language",
        expectation: "The language of Studio's interface. It can be changed in Settings.",
        matchedToDevice: "matched to this device",
    },
    appearance: {
        title: "Appearance",
        expectation: "The theme and the accent, both applied the moment they are picked.",
    },
    zoom: {
        title: "Interface zoom",
        expectation: "How large Studio's interface is drawn. This window is the sample.",
    },
    identity: {
        title: "Who is writing",
        expectation: "The name on your revisions, and the author line each new project starts with.",
        /** Under the two version-control fields: what an empty pair records. */
        unsigned: "Left empty, revisions are recorded as {name}.",
    },
    team: {
        title: "Team server",
        expectation: "Where a shared project lives. Studio works fully without one.",
        /** The button that opens the ordinary add-a-server dialog. */
        connect: "Connect a server",
        /** Above the list, once there is one. */
        connected: "Signed in",
        /** Nothing connected, which is the ordinary case and not a problem. */
        none: "No server. Projects stay on this computer, and one can be added later in Settings.",
    },
    story: {
        title: "Story editor",
        expectation: "How the scene editor reads and what it accepts. Every one of these is in Settings.",
    },
    /**
     * The way past every question at once, on the first screen. See `ImportSettingsRow` for why it
     * is offered there and not at the end.
     */
    import: {
        /** The footer button. Names the file, because "Import…" beside "Skip setup" names nothing. */
        action: "Import settings…",
        /** In the dialog, under the summary: what applying it does to the flow it was opened from. */
        leaves: "Applying these opens Studio; the rest of setup is answered by the file.",
    },
    done: {
        title: "Studio is set up",
        expectation: "Everything asked here, and a good deal more, is in Settings. Press F1 anywhere for help on what is under the cursor.",
        /**
         * Lead-in for the three links under it. Only the label: the links themselves are titled
         * from `help.topics.*`, so setup cannot name a topic differently from the list it opens.
         */
        topics: "Help topics",
    },
    /** The preview at full size, in a window of its own. */
    previewWindow: {
        /** The eye in the sample's own rail, and the window's own name. */
        open: "See the whole window",
        /**
         * Across the top of that window, where a title would be.
         *
         * Said once and plainly: what is under it looks like Studio and answers almost nothing,
         * and somebody who clicks a menu in it and gets nothing deserves to have been told why.
         */
        notice: "A preview of the interface. Nothing here is wired up except the line you can type on.",
    },
    nav: {
        skip: "Skip setup",
        finish: "Open Studio",
    },
    /**
     * The words inside the preview.
     *
     * A scene nobody wrote, standing in for the one the author will. Deliberately generic and
     * deliberately short: the pane exists to show what a *setting* does to a row, and a sample with
     * a story in it would be read instead of looked at.
     */
    sample: {
        /** In the title bar, where a window names the project it is showing. */
        projectName: "Sample project",
        /** Under the scene's name in the editor header: the story document it belongs to. */
        storyName: "Chapter 1",
        scene: "Rooftop, evening",
        speaker: "Anyo",
        line: "The lights came on all at once, the whole way down the hill.",
        lineContinued: "You could see where the road ended.",
        narration: "Below them, the town was already awake.",
        background: "Rooftop",
        placement: "center",
        transition: "fade",
        /** The rail down the miniature's left edge - the three panels the preview can show. */
        rail: {
            story: "Story",
            versions: "Version control",
            team: "Team",
        },
        /** The version-control panel: two recorded revisions, and who they are recorded as. */
        versions: {
            latest: "Rooftop scene, first pass",
            earlier: "Chapter opening",
            checkpoint: "Checkpoint",
        },
        /** The team panel with nothing signed in. */
        teamAlone: "Working on this computer",
    },
} as const;
