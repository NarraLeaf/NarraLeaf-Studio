/**
 * `onboarding` - first-run setup, shown in the launcher window before the home screen.
 *
 * Only the words this flow owns. Every question it asks is a preference that already has a row in
 * Settings, so the labels and the option names are read from the `settings` namespace rather than
 * restated here: a second spelling of "Follow system" is how the setup screen and the Settings
 * window end up describing one choice differently. The same rule applies to the words inside the
 * sample - the story row placeholders come from `story.rows.*`, because that is the sentence the
 * editor itself prints, and the version column's own headings come from `workspace.shell`.
 *
 * Each screen carries one line under its title. That line is the "expectation" layer of
 * docs/help-system.md §1 - what this setting decides - and is the whole reason setup needs no help
 * topics of its own: this is the surface that has to explain itself. It states what the setting is
 * and stops there; a line that argues for the setting is a help topic wearing a screen's clothes.
 */
export const onboarding = {
    /**
     * The title bar, for the whole flow rather than per screen.
     *
     * The one place setup says what it is a setup OF. Each screen's heading is the setting it asks
     * about, which leaves nothing naming the product - and this is the first window anyone sees.
     * `{name}` is `APP_DISPLAY_NAME`, so the two cannot drift apart.
     */
    windowTitle: "Welcome to {name}",
    /**
     * How far into the flow, under the rail that names the screens.
     *
     * A count and not a percentage: the screens are few enough to be named (they are, in the rail),
     * and "3/7" answers "how much is left" without pretending the seventh screen is as much work
     * as the first. Named rather than bare, because it sits below a list of eight things and a bare
     * "3 / 7" beside one of those would read as a count of something in the list.
     *
     * "Progress" rather than "Step", because what it counts is screens behind you and the first
     * screen is none of them - "Step 0 of 7" would be a screen that does not exist.
     */
    progress: "Progress {current}/{total}",
    /**
     * The rail down the left, naming the screens and leading to any of them.
     *
     * Present because the flow is seven screens rather than three: what a rail answers is "how much
     * of this is left", and at three screens with a Skip button on every one of them there was
     * nothing to answer. Same component shape as the project wizard's rail, so the two multi-page
     * flows in this product do not disagree about where "where am I" is written.
     */
    steps: {
        welcome: "Welcome",
        language: "Language",
        appearance: "Appearance",
        zoom: "Zoom",
        identity: "Author",
        team: "Team",
        story: "Story editor",
        done: "Done",
    },
    /**
     * The screen setup opens on.
     *
     * A heading like every other screen's - one word, the thing the screen is - rather than the
     * product name across a title card. The title bar already names the product, and it names it
     * two lines above where a heading would repeat it.
     */
    welcome: {
        title: "Welcome",
        expectation: "Interface and story-editor settings, in six screens. Each one takes effect immediately and remains available in Settings.",
        /** Above the import row, naming what the row is for rather than asking after the reader. */
        haveSettings: "Settings from another installation",
    },
    language: {
        title: "Language",
        expectation: "The language Studio's interface is written in.",
        matchedToDevice: "matched to this device",
    },
    appearance: {
        title: "Appearance",
        expectation: "The theme and accent colour of the interface.",
    },
    zoom: {
        title: "Interface zoom",
        expectation: "The size Studio's interface is drawn at. This window follows the setting.",
        /** The fourth option: the setting's whole 50-200 range, behind one more click. */
        custom: "Custom",
        /** Over the three surfaces the sample can show while this screen is up. */
        surface: "Preview surface",
    },
    identity: {
        title: "Author",
        expectation: "The name recorded on each version, and the author line new projects start with.",
        /** Under the two version-control fields: what an empty pair records. */
        unsigned: "Left empty, versions are recorded as {name}.",
    },
    team: {
        title: "Team server",
        expectation: "Where a shared project is kept. A server is optional.",
        /** The button that opens the ordinary add-a-server dialog. */
        connect: "Connect to a server",
        /** Above the list, once there is one. */
        connected: "Signed in",
        /** Nothing connected, which is the ordinary case and not a problem. */
        none: "No server connected. Projects are kept on this computer.",
    },
    story: {
        title: "Story editor",
        expectation: "How the scene editor is read and typed in.",
    },
    /**
     * The way past every question at once, on the first screen. See `WelcomeStep` for why it is
     * offered there and not at the end.
     */
    import: {
        /** The screen's button. Names the file, because "Import…" beside "Skip setup" names nothing. */
        action: "Import settings…",
        /** In the dialog, under the summary: what applying it does to the flow it was opened from. */
        leaves: "Applying these settings ends setup and opens Studio.",
    },
    done: {
        title: "Setup complete",
        expectation: "Every setting asked for here is in Settings. F1 opens help for whatever is under the cursor.",
        /** The one button under it, which opens the manual on narraleaf.com in a browser. */
        docs: "Open the documentation",
    },
    /**
     * The dialog behind Skip.
     *
     * Skipping is not undoable - the completion marker is written either way, and setup is never
     * offered again - so the press that ends it says what it ends. The message answers the only
     * question worth asking at that moment, which is whether anything is lost by leaving.
     */
    skipConfirm: {
        title: "Skip setup?",
        message: "Studio opens with its default settings. Setup is not shown again; every setting it asks for is in Settings.",
    },
    nav: {
        skip: "Skip setup",
        finish: "Open Studio",
    },
    /**
     * The words inside the sample.
     *
     * A project nobody wrote, written the way an author would write one: a named project, a named
     * chapter, a scene with a place and a time in it, and three lines that read as a scene rather
     * than as instructions to whoever is in setup. The sample exists to show what a *setting* does
     * to a row, so the lines stay short - but a sample addressed to nobody in particular is what
     * separates a window from a placeholder.
     */
    sample: {
        /**
         * In the title bar, where a window names the project it is showing.
         *
         * The same in every language: it is a project's name, and a project's name is whatever its
         * author typed, not a label Studio translates.
         */
        projectName: "Afterlight",
        /** Under the scene's name in the editor header: the story document it belongs to. */
        storyName: "Chapter 1",
        /** The scene in front, named the way a scene is named: a place and a time. */
        scene: "Rooftop, evening",
        /** The sample's one character, named after the engine. A name, so it is not translated. */
        speaker: "Narra",
        line: "The bell went ten minutes ago.",
        lineContinued: "Nobody else came up here.",
        narration: "The stairwell door stayed open behind them.",
        background: "Rooftop",
        placement: "center",
        transition: "fade",
        /** The version column: three recorded versions, and what a version is called. */
        versions: {
            latest: "Rooftop scene, first pass",
            checkpoint: "Checkpoint",
            earlier: "Chapter opening",
        },
        /** The dashboard's two facts, which are dates in the real one and words in a sample. */
        dashboard: {
            lastActive: "a moment ago",
            trackedSince: "this week",
        },
        /** Four lines of a build, which is what the console is usually showing. */
        console: {
            start: "Building the preview…",
            assets: "86 assets, 12 scenes",
            warning: "Scene \"Rooftop, evening\" names a character that has no appearance",
            done: "Preview ready in 3.4s",
        },
    },
} as const;
