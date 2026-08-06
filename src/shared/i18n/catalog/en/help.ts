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
        interface: "Game interface",
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
        // The popover's back arrow. Names its destination rather than saying "Back", because the
        // one thing worth knowing before pressing it is which topic you land on.
        backTo: "Back to {title}",
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
        newProject: {
            title: "Adding a project",
            body:
                "The launcher adds a project in three ways: start a new one from a template, unpack a project package "
                + "someone sent you, or copy one down from a version control server.\n"
                + "\n"
                + "- A new project needs a name, an app identifier and a stage size. The identifier is fixed once the "
                + "project exists.\n"
                + "- The folder has to be empty. Name one that does not exist yet and it is created for you.\n"
                + "- A project copied from a server stays connected to it, and your copy is yours to edit.",
        },
        undo: {
            title: "Undoing",
            body:
                "Undo takes back the last change you made, in the editor you made it in. The editor with focus answers "
                + "first; with focus outside every editor, the workspace answers.\n"
                + "\n"
                + "- Each editor keeps its own steps, so moving between tabs does not mix them together.\n"
                + "- Undo and redo are in the Edit menu as well.\n"
                + "- It covers what you changed inside the project. A file written to your disk, a build, or a "
                + "version you submitted is not something it takes back.\n"
                + "- A tab you closed by accident can be reopened.",
        },
        studioSettings: {
            title: "Studio settings",
            body:
                "Settings belong to Studio on this machine, not to a project. Opening another project leaves them as "
                + "they are, and they do not travel with a project you hand to someone else.\n"
                + "\n"
                + "- Language, theme, editor text and every shortcut are set here.\n"
                + "- Reset returns one setting, or all of them, to what Studio starts with.\n"
                + "- Cached files can be listed and cleared. What is cleared is built again when it is next needed.\n"
                + "- Settings can be written to a file and read back on another machine.",
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
        storyExpressions: {
            title: "Expressions",
            body:
                "Where a command takes a value, it also takes a small expression: a comparison, a sum, a call. The row "
                + "says what is wrong with one while you type, and will not commit until it reads.\n"
                + "\n"
                + "- A bare name is a variable in scope. Put scene, saved or persis in front of it to say which one "
                + "you mean.\n"
                + "- visited answers whether a scene or a label has been reached.\n"
                + "- A condition has to be a test that comes out true or false.",
        },
        storyScript: {
            title: "Writing outside Studio",
            body:
                "A scene can be written out as a text file, edited anywhere, and brought back in.\n"
                + "\n"
                + "Two kinds of file: round-trip carries the scene and can be imported again, review is prose only and "
                + "is for reading and comparing.\n"
                + "\n"
                + "- The import lists every row it will add, change or remove before it writes anything.\n"
                + "- A scene edited in Studio after the export loses those edits when the file comes back, and the "
                + "import says so first.\n"
                + "- Pasting several lines at once asks who is speaking, and remembers the answers for the next paste.",
        },
        sceneSnapshot: {
            title: "Playing from a row",
            body:
                "Dev Mode can start at the row you are on instead of at the beginning. Nothing before that row runs, so "
                + "the variables it would have set have to come from somewhere: that is what a snapshot is.\n"
                + "\n"
                + "- A snapshot belongs to one scene and gives every variable in scope a value to start from.\n"
                + "- Starting from a row with no snapshot offers to make one.\n"
                + "- Snapshots change nothing about how the finished game plays.",
        },
        storyMotion: {
            title: "Motion",
            body:
                "A motion is a movement written once and used on any row: a character sliding in, a picture fading, the "
                + "camera pushing in on the stage.\n"
                + "\n"
                + "- The library holds ready-made moves grouped by what they are for. Picking one puts a copy in your "
                + "project, which you can then change.\n"
                + "- A motion says how something moves, not what moves. The row names the target.\n"
                + "- The preview draws at the size the game draws, so what you time is what plays.",
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
        mediaConversion: {
            title: "Converting files that will not play",
            body:
                "Not every sound or video file plays in a game. When one is imported that does not, "
                + "Studio offers to convert it and says what the conversion will cost.\n"
                + "\n"
                + "- Converting writes a new file into the project. The file you picked is never changed.\n"
                + "- Some files come back with the picture and sound exactly as they were.\n"
                + "- Others have to be rebuilt, which takes longer and loses a little quality.\n"
                + "- A file with nothing playable in it is listed with the reason and left out.\n"
                + "\n"
                + "Files already in the project are marked in the asset browser, and the mark converts "
                + "them where they are. That file keeps its name and everything using it keeps working.\n"
                + "\n"
                + "A build stops while any of these is still in the project, and names them in the console.",
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
        appearances: {
            title: "How a character is drawn",
            body:
                "A character is drawn in one of three ways, chosen in the character editor.\n"
                + "\n"
                + "- Preset sprites: one finished image per pose.\n"
                + "- Layered sprite: layers turned on by tags on axes, so a costume and an expression change "
                + "independently of each other.\n"
                + "- Custom runtime: a model, drawn by a runtime installed in this project.\n"
                + "\n"
                + "The dialogue portrait is made from what is drawn, and can follow one axis so it changes with the "
                + "character.",
        },
        puppetRuntimes: {
            title: "Model runtimes",
            body:
                "A model is drawn by a runtime, and Studio carries none. The project holds the ones it needs, installed "
                + "once each.\n"
                + "\n"
                + "- Studio never downloads a runtime for you. You get it from its vendor, which is also where you "
                + "accept their terms.\n"
                + "- Live2D and Spine are licensed by their own companies. Their terms are shown before the install "
                + "starts, and they apply to the game you ship.\n"
                + "- A character keeps its runtime's name if the runtime is removed, and draws an empty box until it is "
                + "installed again.",
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
        audioClips: {
            title: "Trimming and looping a clip",
            body:
                "Opening an audio asset shows its waveform, where the clip takes three marks: where it starts, where a "
                + "repeat jumps back to, and where it ends.\n"
                + "\n"
                + "- With a loop mark set, the opening plays once and everything after the mark repeats.\n"
                + "- The marks belong to the asset, so every row that plays it gets them.\n"
                + "- Playing, moving, marking and zooming are all on the keyboard.",
        },
        voice: {
            title: "Voice-over",
            body:
                "A voice language holds one clip per spoken line. The panel lists the languages with how much of the "
                + "story each covers, and opening one shows its table of lines.\n"
                + "\n"
                + "- Studio brings in clips that already exist. It records nothing.\n"
                + "- A whole folder can be assigned at once when the file names follow a pattern you set.\n"
                + "- The lines to record can be written out as a spreadsheet file to hand to whoever records them.\n"
                + "- A line whose text changed after its clip was assigned is marked outdated, so what needs recording "
                + "again can be found.",
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
        uiComponents: {
            title: "Reusable parts",
            body:
                "Widgets that belong together can be kept as a component and placed on any screen. Every placement "
                + "stays linked, so changing the component changes all of them.\n"
                + "\n"
                + "- A placement can be moved, resized and turned. Changing anything else about it means unlinking it "
                + "first, and an unlinked copy stops following the component.\n"
                + "- The library counts how many placements each component has.\n"
                + "- Deleting a component leaves its placements showing as missing until they are replaced or unlinked.",
        },
        blueprints: {
            title: "Blueprints",
            body:
                "A blueprint is what a screen does: what happens when a button is pressed, what runs when the screen "
                + "opens. Every graph starts from an event.\n"
                + "\n"
                + "Nodes run along the wires between them. One kind of wire sets the order things happen in, the other "
                + "carries values from one node into the next.\n"
                + "\n"
                + "- Right-click the canvas to add a node. It follows the cursor until you place it.\n"
                + "- Each pin takes one wire. Values with no wire are typed on the node itself.\n"
                + "- Problems are listed under the canvas, and picking one selects what it is about.",
        },
        uiBindings: {
            title: "Values on a screen",
            body:
                "A widget can show a value that changes while the game runs instead of text you typed. Bind the "
                + "property to a field, and whatever writes that field decides what the widget shows.\n"
                + "\n"
                + "- A field belongs to the page, to the application, or to one item of a list, and that is what "
                + "decides how long its value lasts.\n"
                + "- Blueprints read and write the same fields, so pressing one widget can change what another shows.\n"
                + "- A binding whose field is gone is reported as broken, on the surface and in the blueprint.",
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
        recovery: {
            title: "Recovery mode",
            body:
                "When part of a project cannot be read, Studio offers to open the window read-only and without "
                + "plugins. Nothing is written while you are in it, so what did load cannot be saved over what did not.\n"
                + "\n"
                + "- The panel lists everything that failed, each with the error it failed with.\n"
                + "- The load checks read one part of the project at a time and report what they find. Whatever loads "
                + "can be browsed as usual.\n"
                + "- With a version history in the project, a working version can be restored from here.\n"
                + "- Leaving recovery mode opens the project the normal way again.",
        },
        dashboard: {
            title: "Project statistics",
            body:
                "The dashboard counts what the project holds and what has been added lately: scenes, lines, words, "
                + "characters, assets and the days you wrote on.\n"
                + "\n"
                + "- Words are counted from story text, so a day spent on screens, assets or blueprints shows none.\n"
                + "- Counting starts the first time the project is opened in a Studio that keeps these numbers. There "
                + "is nothing before that.",
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
        versionChanges: {
            title: "What changed",
            body:
                "Before you submit a version, Studio can say what is different from the last one: which files, and "
                + "inside them which scenes, rows, characters and assets.\n"
                + "\n"
                + "- Nothing is looked at until you ask. The list says when it was last checked.\n"
                + "- A row that changed is shown with both sides, so you can read what it was and what it is.\n"
                + "- Looking writes nothing. Your project is left as it is.",
        },
        versionConflicts: {
            title: "Choosing between two versions",
            body:
                "When the same part of a file changed here and on the server, the merge stops and asks which side to "
                + "keep. The project stays frozen until every one of them has an answer.\n"
                + "\n"
                + "- Both sides are shown next to each other, and you keep one of them per item.\n"
                + "- Everything that merged on its own is already in place. Only what could not be settled is asked "
                + "about.\n"
                + "- Finishing the merge submits a version, so the result sits in the history like any other.",
        },
        versionServer: {
            title: "Working with a server",
            body:
                "A project can be connected to a version control server, so more than one person can work on it. "
                + "Nothing leaves this machine and nothing arrives until you ask for it.\n"
                + "\n"
                + "- Send puts the versions you submitted onto the server.\n"
                + "- Get brings down the versions the server has and merges them into yours.\n"
                + "- When both sides have moved on, get first and send afterwards.\n"
                + "- Checking where you stand reaches the server, so it takes a moment to answer.",
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
        icons: {
            title: "Icons",
            body:
                "One image is the application's icon, and each platform's icon is made from it in the sizes and shapes "
                + "that platform wants. A platform that needs a different picture can be given its own.\n"
                + "\n"
                + "- What is generated is kept in the project, so a build on another machine uses the same icons.\n"
                + "- An iOS icon cannot be transparent. It is drawn on a background colour, white until you choose "
                + "another.\n"
                + "- A platform with nothing generated builds with the NarraLeaf icon.",
        },
        signing: {
            title: "Signing a build",
            body:
                "A signature says the build came from you. Unsigned, it still runs, and the first launch shows a "
                + "security warning on Windows and macOS. iOS installs nothing unsigned.\n"
                + "\n"
                + "- A credential is chosen per platform, and stays on this machine. It never travels with the project.\n"
                + "- Before the build starts, the dialog says whether the chosen credential can be used here and what "
                + "is missing if it cannot.\n"
                + "- Android without a chosen key is signed with a local identity that is only good for installing by "
                + "hand.",
        },
        assetProtection: {
            title: "Protecting what you ship",
            body:
                "With asset protection on, the images, audio, story text and plugin code inside a packaged game are "
                + "encrypted, and so are the player's saves. Dev Mode is left alone.\n"
                + "\n"
                + "- Web builds always ship without it, because the browser has to read the files itself.\n"
                + "- It keeps the files closed to ordinary tools. Someone reading the game while it runs can still "
                + "reach them.\n"
                + "- The other switch on this page decides whether the game may use the network at all.",
        },
        webOptimization: {
            title: "Smaller downloads",
            body:
                "The exported site can be made smaller two ways. Android and iOS builds serve that same site, so both "
                + "reach them too.\n"
                + "\n"
                + "- Converting images keeps every pixel: each conversion is compared against the original and thrown "
                + "away unless it comes back identical.\n"
                + "- Recompressing images is the lossy one. Much smaller, and the detail it drops does not come back.\n"
                + "- Precompressed copies of text files are used only by a server set up to serve them. Every other "
                + "host serves the originals.",
        },
        plugins: {
            title: "Plugins",
            body:
                "A plugin adds things to Studio: story commands, blueprint nodes, widgets, tests, whole panels.\n"
                + "\n"
                + "- A plugin declares what it needs before any of its code runs, and you approve that list when "
                + "you install it.\n"
                + "- What a plugin contributes appears in the same places as the built-in equivalents, marked with "
                + "the plugin it came from.\n"
                + "- The project lists the plugins it relies on. Opened on a machine that is missing one, it says "
                + "which, and what in the project was using it.",
        },
    },
} as const;
