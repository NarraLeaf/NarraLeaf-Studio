/**
 * `help` — the in-Studio topic set, plus the chrome of the surfaces that show it.
 *
 * Copy rules live in `docs/help-system.md` and are not optional here: a topic says what will
 * happen and what the author will see, never how Studio does it or why it was built that way.
 * Bodies use the three constructs `helpBody.ts` understands - a paragraph per line, a blank line
 * between paragraphs, and `- ` for a bullet. Nothing else renders.
 *
 * Keep bodies under about eight lines. A topic that wants a heading is two topics; join them with
 * `related` in `helpTopics.ts` instead.
 */
export const help = {
    /** Left column of the browser, and the grouping in the palette. */
    sections: {
        start: "Getting around",
        story: "Story",
        content: "Content",
        quality: "Checks",
        version: "Versions",
        ship: "Shipping",
    },
    /** Chrome shared by the popover and the browser. */
    ui: {
        title: "Help",
        open: "Help",
        openTopic: "Help: {title}",
        searchPlaceholder: "Search help",
        noResults: "No topic matches",
        allTopics: "All topics",
        related: "See also",
        shortcuts: "Shortcuts",
        learnMore: "Open the full page",
        close: "Close",
        // The browser's second list, below the topics: pages that are deliberately not bundled.
        resources: "On the web",
        // Shown in the reader before a topic is picked.
        pickTopic: "Pick a topic",
    },
    /**
     * Names for the pages under "On the web". They are catalog entries and not strings in
     * `helpResources.ts` because they are shown to the reader like everything else here: hard-coded
     * Chinese titles sat untranslated under English section headings for anyone reading in English.
     * Proper nouns stay as they are - "NarraLeaf" and "GitHub" are not words to translate.
     */
    resourceTitles: {
        docs: "Studio documentation",
        site: "NarraLeaf website",
        github: "GitHub organization",
        engine: "narraleaf-react, the engine",
    },
    topics: {
        workspaceLayout: {
            title: "Workspace layout",
            body:
                "The rail on the left switches the side panel: story, assets, characters, project settings. "
                + "The middle is editor tabs, one per thing you opened. The right side edits whatever is selected.\n"
                + "\n"
                + "- Each project window remembers its panel widths and which panels were open.\n"
                + "- Closing a panel leaves its rail icon in place. Click it to bring the panel back.\n"
                + "- The editor area can be split, and a tab can be dragged into either half.",
        },
        runModes: {
            title: "Running your game",
            body:
                "Dev Mode opens the game in a Studio window with the debug panels: jump to a story row, "
                + "watch variables, reload without leaving the editor.\n"
                + "\n"
                + "Preview runs the game the way a player gets it, in its own window, with none of that.\n"
                + "\n"
                + "Build writes the files you hand to players. It takes minutes; the other two take seconds.\n"
                + "\n"
                + "- Run remembers which of the first two you picked and launches it on one click.\n"
                + "- Preview and Build are unavailable while the project is frozen. Dev Mode still runs, and "
                + "while you are viewing an old version it runs that version.",
        },
        keyboard: {
            title: "Keyboard",
            body:
                "One sheet lists every shortcut Studio has, including the ones that only exist while a "
                + "particular editor is open.\n"
                + "\n"
                + "- Any of them can be changed in Settings, under Editor.\n"
                + "- A shortcut you change is shown changed everywhere: the sheet, the menus and the command palette.",
        },
        search: {
            title: "Finding things",
            body:
                "Search covers story text, scene and character names, assets, blueprint nodes and UI widgets. "
                + "Every result says where it lives, and picking one opens that place.\n"
                + "\n"
                + "- Names of things rank above matches found inside a document.\n"
                + "- The command palette is the other way in: it finds actions and panels by name rather than content.",
        },
        storyScene: {
            title: "Scenes and rows",
            body:
                "A scene is a list of rows. A row is one line of dialogue, one piece of narration, or one command.\n"
                + "\n"
                + "Type to write a line. Type a slash at the start of a row to pick a command instead.\n"
                + "\n"
                + "- The selected row is what the right panel edits.\n"
                + "- Rows can be moved, duplicated, indented and deleted from the keyboard.",
        },
        storyCommands: {
            title: "Commands",
            body:
                "Commands are the rows that are not speech: show a background, move a character, play a sound, "
                + "set a variable, branch.\n"
                + "\n"
                + "The Actions panel beside the editor is the whole list, with the values each command accepts "
                + "and examples that work.\n"
                + "\n"
                + "- The panel shows commands spelled the way you type them. When the editor is in Chinese the "
                + "Chinese words parse, and the English spellings keep working.\n"
                + "- A row missing a required value will not commit.",
        },
        storyVariables: {
            title: "Variables",
            body:
                "Three scopes, differing only in how long a value lasts:\n"
                + "\n"
                + "- Scene: belongs to one scene, kept in the save file.\n"
                + "- Save: belongs to a save file, and has to be something that can be written to one.\n"
                + "- Persistent: application-wide, and shared with blueprints.\n"
                + "\n"
                + "Persistent variables are declared in the blueprint editor. The other two are declared here.",
        },
        storyFlow: {
            title: "Branches and routes",
            body:
                "The flow view reads your scenes and draws where the story can go: which choice leads where, "
                + "which scenes are only reachable through a branch, and where a path stops.\n"
                + "\n"
                + "- A path that stops is not always an ending. It can be a branch with nothing after it yet, "
                + "or a loop back to a scene already visited.",
        },
        assets: {
            title: "Assets",
            body:
                "Everything the game loads is an asset: images, audio and video, data files, fonts and models. "
                + "Studio sorts them into those categories, and you can make your own groups inside one.\n"
                + "\n"
                + "- Drop a folder onto the panel to import everything in it that Studio recognises.\n"
                + "- Replacing an asset's file keeps every reference to it.\n"
                + "- Deleting an asset that is still in use lists where it is used before anything is deleted.",
        },
        characters: {
            title: "Characters",
            body:
                "A character has a name, a colour and a set of appearances. An appearance is what the character "
                + "looks like on stage, and story rows switch between them by name.\n"
                + "\n"
                + "- The portrait shown beside dialogue is made from an appearance.\n"
                + "- A character does not have to be on stage to speak.",
        },
        audio: {
            title: "Audio tracks",
            body:
                "A track is a volume group. It feeds another track or the main output, so turning one down turns "
                + "down everything under it.\n"
                + "\n"
                + "- A clip plays at its own level times every track above it. Tracks only turn sound down.\n"
                + "- Renaming a track is safe. Story rows do not find it by its name.",
        },
        localization: {
            title: "Languages",
            body:
                "Every line can carry a translation per language, and each one is in one of four states: "
                + "untranslated, translated, out of date, or not needed.\n"
                + "\n"
                + "- A line goes out of date when the original text changes after it was translated.\n"
                + "- Export a language as CSV, XLIFF, PO or JSON, translate it anywhere, and import it back. "
                + "The import says how many lines it applied and how many it could not match.\n"
                + "- Export and import are on the language row, under its menu.",
        },
        uiSurfaces: {
            title: "Game screens",
            body:
                "The UI editor is where the game's own screens are built: the main menu, save and load, the "
                + "dialogue box. You place widgets on a surface, and a blueprint says what they do.\n"
                + "\n"
                + "- The surface is drawn at the size the game draws it, so what you place is what players see.\n"
                + "- A surface belongs to the game. Changing one changes the shipped game, not Studio.",
        },
        lint: {
            title: "Project checks",
            body:
                "Checks read the whole project and report what will not work: references to assets that are gone, "
                + "jumps to labels that were never declared, rows the compiler will not accept, media a chosen "
                + "platform cannot play.\n"
                + "\n"
                + "- Every finding names where it came from and opens it when you pick it.\n"
                + "- Running the checks changes nothing. They only report.",
        },
        tests: {
            title: "Tests",
            body:
                "A test plays your game and reports whether something held: that an ending can be reached, that "
                + "nothing failed on the way.\n"
                + "\n"
                + "- A test reports passed, failed or skipped. Cancelled and errored mean the run did not finish, "
                + "not that the game is wrong.\n"
                + "- The report keeps the last run's findings until you run it again.",
        },
        versionControl: {
            // Not "Versions": that is the section heading it sits under, and the list read as a
            // heading followed by itself.
            title: "Version control",
            body:
                "A version is a point you can come back to. History is kept inside the project folder, and nothing "
                + "is recorded unless you record it, apart from the checkpoint taken before a restore.\n"
                + "\n"
                + "- Recording a version adds to the list. It never replaces or removes anything.\n"
                + "- The list does not look for changes by itself. Ask it to check when you want to know.",
        },
        versionViewing: {
            title: "Looking at an old version",
            body:
                "Opening a version from the list shows your editors as they were at that point. The files in your "
                + "project are not touched, and nothing is saved while you look.\n"
                + "\n"
                + "- Stop Viewing History brings your own work back, as you left it.\n"
                + "- Anything you type while looking at a version is dropped when you leave.",
        },
        versionRestore: {
            title: "Restoring a version",
            body:
                "Restoring replaces the files in your project with that version's contents. It is the only thing in "
                + "the version rail that changes what is on disk.\n"
                + "\n"
                + "- Your current state is recorded as a checkpoint first, so a restore can itself be undone.\n"
                + "- No version is removed. The restored state is added as a new one.",
        },
        freeze: {
            title: "Frozen projects",
            body:
                "A frozen project stops being written to. Editors still open, everything can still be read, and "
                + "nothing you change reaches disk.\n"
                + "\n"
                + "- Studio freezes the project while you look at an old version, and while a merge is unfinished. "
                + "You can also freeze it yourself.\n"
                + "- Controls that would write are disabled rather than hidden, so the project looks the same as "
                + "it did.",
        },
        build: {
            title: "Builds",
            body:
                "A build produces the files you give players. Choose the platforms and the formats you want.\n"
                + "\n"
                + "- Web, Android and iOS build on any machine. macOS builds only on a Mac.\n"
                + "- An unsigned build runs, but the first launch shows a security prompt on Windows and macOS.\n"
                + "- Icons come from the project's icon page. A platform whose icon has not been generated builds "
                + "with the NarraLeaf icon.",
        },
        plugins: {
            title: "Plugins",
            body:
                "A plugin adds things to Studio: story commands, blueprint nodes, widgets, tests, whole panels.\n"
                + "\n"
                + "- A plugin declares what it needs before any of its code runs, and you approve that list when "
                + "you install it.\n"
                + "- What a plugin contributes appears in the same places as the built-in equivalents, marked with "
                + "the plugin it came from.",
        },
    },
} as const;
