/**
 * `help` - the in-Studio topic set, plus the chrome of the surfaces that show it.
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
                + "The middle holds editor tabs, one per open item. The right panel edits the current selection.\n"
                + "\n"
                + "- Each project window records its own panel widths and which panels are open.\n"
                + "- Closing a panel keeps its rail icon. Click the icon to reopen the panel.\n"
                + "- The editor area can be split in two, and a tab can be dragged into either half.",
        },
        runModes: {
            title: "Running your game",
            body:
                "Dev Mode opens the game in a Studio window with the debug panels: jump to a story row, "
                + "inspect variables, reload without leaving the editor.\n"
                + "\n"
                + "Preview runs the game in its own window, in the form players receive it, without the "
                + "debug panels.\n"
                + "\n"
                + "Build produces the files handed to players. Dev Mode and Preview take seconds; a build "
                + "takes minutes.\n"
                + "\n"
                + "- Run records the mode chosen last and starts it in one click.\n"
                + "- Preview and Build are unavailable while the project is frozen. Dev Mode still runs, and "
                + "while an old version is open it runs that version.",
        },
        keyboard: {
            title: "Keyboard",
            body:
                "The shortcut sheet lists every shortcut in Studio, including those that apply only while a "
                + "particular editor is open.\n"
                + "\n"
                + "- Every shortcut can be changed in Settings, under Shortcuts.\n"
                + "- A changed shortcut is updated in the sheet, the menus and the command palette.",
        },
        search: {
            title: "Finding things",
            body:
                "Search covers story text, scene and character names, assets, blueprint nodes and UI widgets. "
                + "Every result states where it lives, and selecting one opens that place.\n"
                + "\n"
                + "- Name matches rank above matches inside a document.\n"
                + "- The command palette finds actions and panels by name, not by content.",
        },
        newProject: {
            title: "Adding a project",
            body:
                "The launcher adds a project three ways: create one from a template, unpack a project package, "
                + "or copy one from a version control server.\n"
                + "\n"
                + "- A new project needs a name, an app identifier and a stage size. The identifier cannot be "
                + "changed once the project exists.\n"
                + "- The target folder must be empty. A folder that does not exist yet is created.\n"
                + "- A project copied from a server stays connected to it, and the local copy is editable.\n"
                + "- The bundled template is a short story that already runs: three scenes, one choice, and the "
                + "title, save, load, config and backlog screens already wired.",
        },
        undo: {
            title: "Undoing",
            body:
                "Undo takes back the last change, in the editor that made it. The editor with focus handles it; "
                + "with focus outside every editor, the workspace handles it.\n"
                + "\n"
                + "- Each editor keeps its own steps, so switching tabs does not merge them.\n"
                + "- Undo and redo are also in the Edit menu.\n"
                + "- Undo covers changes inside the project. Files written to disk, build output and submitted "
                + "versions are outside its range.\n"
                + "- A tab closed by accident can be reopened.",
        },
        studioSettings: {
            title: "Studio settings",
            body:
                "Settings belong to Studio on this machine, not to a project. Opening another project leaves "
                + "them unchanged, and they do not travel with a project handed to someone else.\n"
                + "\n"
                + "- Language, theme, editor text and every shortcut are set here.\n"
                + "- Reset returns one setting, or all of them, to its default value.\n"
                + "- Cached files can be listed and cleared. Cleared files are rebuilt when they are next needed.\n"
                + "- Settings can be exported to a file and imported on another machine.",
        },
        storyScene: {
            title: "Scenes and rows",
            body:
                "A scene is a list of rows. A row is one line of dialogue, one piece of narration, or one command.\n"
                + "\n"
                + "Typing writes a line. Typing a slash at the start of a row selects a command instead.\n"
                + "\n"
                + "- The right panel edits the selected row.\n"
                + "- Rows can be moved, duplicated, indented and deleted from the keyboard.",
        },
        storyCommands: {
            title: "Commands",
            body:
                "Commands are the rows that are not speech: show a background, move a character, play a sound, "
                + "set a variable, branch.\n"
                + "\n"
                + "The Actions panel beside the editor lists every command, the values each one accepts, and a "
                + "working example.\n"
                + "\n"
                + "- The panel spells commands the way they are typed. With the editor in Chinese the Chinese "
                + "spellings parse, and the English spellings keep working.\n"
                + "- A row with a required value missing cannot be committed.",
        },
        storyVariables: {
            title: "Variables",
            body:
                "Three scopes, differing in how long a value is kept:\n"
                + "\n"
                + "- Scene: belongs to one scene, stored in the save file.\n"
                + "- Save: belongs to a save file, and must hold a value that can be written to one.\n"
                + "- Persistent: application-wide, and shared with blueprints.\n"
                + "\n"
                + "A scene variable is declared in the scene it belongs to, as a row like any other. Save and "
                + "persistent variables outlive the scene they were written in, so they are declared once for "
                + "the whole project, in the variables panel - any scene and any blueprint can then use them.",
        },
        storyFlow: {
            title: "Branches and routes",
            body:
                "The flow view reads the scenes and draws where the story can go: which choice leads where, "
                + "which scenes are reachable only through a branch, and where a path ends.\n"
                + "\n"
                + "- A path that ends is not always an ending. It can be a branch with nothing written after it, "
                + "or a return to a scene already visited.",
        },
        storyExpressions: {
            title: "Expressions",
            body:
                "Wherever a command takes a value, it also takes an expression: a comparison, an arithmetic "
                + "operation, a call. The row marks what is wrong while you type, and a row whose expression "
                + "does not parse cannot be committed.\n"
                + "\n"
                + "- A bare name is a variable in scope. Prefix it with scene, saved or persis to choose the "
                + "scope.\n"
                + "- visited reports whether a scene or a label has been reached.\n"
                + "- A condition must be a test that evaluates to true or false.",
        },
        storyScript: {
            title: "Editing outside Studio",
            body:
                "A scene can be exported as a text file, edited elsewhere, and imported again.\n"
                + "\n"
                + "Two formats: round-trip carries the scene data and can be imported back; review carries prose "
                + "only, for reading and comparing.\n"
                + "\n"
                + "- The import lists every row it will add, change or remove before writing anything.\n"
                + "- A scene edited in Studio after the export loses those edits on import, and the import states "
                + "this first.\n"
                + "- Pasting several lines at once asks who is speaking, and keeps the answers for the next paste.",
        },
        sceneSnapshot: {
            title: "Playing from a row",
            body:
                "Dev Mode can start at the current row instead of at the beginning of the scene. Nothing before "
                + "that row runs, and the variables it would have set come from a snapshot.\n"
                + "\n"
                + "- A snapshot belongs to one scene and gives every variable in its scope a starting value.\n"
                + "- Starting from a row with no snapshot offers to create one.\n"
                + "- Snapshots do not affect the finished game.",
        },
        storyMotion: {
            title: "Motion",
            body:
                "A motion is a reusable movement: a character sliding in, a picture fading, the camera pushing "
                + "in on the stage. It is defined once and can be used on any row.\n"
                + "\n"
                + "- The library groups ready-made motions by purpose. Choosing one copies it into the project, "
                + "and the copy can be edited.\n"
                + "- A motion describes how something moves, not what moves. The row names the target.\n"
                + "- The preview draws at the size the game draws, so its timing matches the timing at run time.",
        },
        assets: {
            title: "Assets",
            body:
                "Everything the game loads is an asset: images, audio and video, data files, fonts and models. "
                + "Studio sorts them into those categories, and groups can be created inside a category.\n"
                + "\n"
                + "- Drop a folder onto the panel to import every supported file in it.\n"
                + "- Replacing an asset's file keeps every reference to it.\n"
                + "- Deleting an asset that is still in use lists its usages first.",
        },
        mediaConversion: {
            title: "Converting unplayable files",
            body:
                "Some audio and video files cannot play in a game. When one is imported, Studio offers to "
                + "convert it and states what the conversion costs.\n"
                + "\n"
                + "- Converting writes a new file into the project. The source file is not modified.\n"
                + "- Some files come back with picture and sound identical to the original.\n"
                + "- Others must be re-encoded, which takes longer and loses some quality.\n"
                + "- A file with no playable content is skipped and listed with the reason.\n"
                + "\n"
                + "Files already in the project are marked in the asset browser, and the mark converts them in "
                + "place. The file keeps its name and every reference to it keeps working.\n"
                + "\n"
                + "A build stops while any such file remains in the project, and lists them in the console.",
        },
        characters: {
            title: "Characters",
            body:
                "A character has a name, a color and a set of appearances. An appearance is the character's "
                + "form on stage, and story rows switch between appearances by name.\n"
                + "\n"
                + "- The portrait beside dialogue is generated from an appearance.\n"
                + "- A character can speak without being on stage.",
        },
        appearances: {
            title: "How a character is drawn",
            body:
                "A character is drawn one of three ways, chosen in the character editor.\n"
                + "\n"
                + "- Preset sprites: one finished image per pose.\n"
                + "- Layered sprite: layers switched by tags on axes, so a costume and an expression change "
                + "independently.\n"
                + "- Custom runtime: a model, drawn by a runtime installed in this project.\n"
                + "\n"
                + "The dialogue portrait is generated from the drawn result, and can follow one axis so it "
                + "changes with the character.",
        },
        puppetRuntimes: {
            title: "Model runtimes",
            body:
                "A model is drawn by a runtime, and Studio ships none. Each project installs the runtimes it "
                + "needs, once each.\n"
                + "\n"
                + "- Studio does not download a runtime for you. A runtime comes from its vendor, and its terms "
                + "are accepted there.\n"
                + "- Live2D and Spine are licensed by their own companies. Their terms are shown before the "
                + "install starts, and they apply to the game you ship.\n"
                + "- After a runtime is removed, a character keeps the runtime's name and draws an empty box "
                + "until it is installed again.",
        },
        audio: {
            title: "Audio tracks",
            body:
                "A track is a volume group. It feeds the track above it or the main output, so lowering one "
                + "track lowers everything under it.\n"
                + "\n"
                + "- A clip plays at its own level multiplied by every track above it. Tracks only lower volume.\n"
                + "- Renaming a track does not affect playback. Story rows do not reference a track by name.",
        },
        audioClips: {
            title: "Trimming and looping a clip",
            body:
                "Opening an audio asset shows its waveform, where three marks can be set: the start, the point "
                + "a repeat jumps back to, and the end.\n"
                + "\n"
                + "- With a loop mark set, the opening plays once and the part after the mark repeats.\n"
                + "- The marks belong to the asset, so every row that plays it uses them.\n"
                + "- Playback, movement, marking and zooming all have keyboard actions.",
        },
        voice: {
            title: "Voice-over",
            body:
                "A voice language holds one clip per spoken line. The panel lists the voice languages with how "
                + "much of the story each covers, and opening one shows its table of lines.\n"
                + "\n"
                + "- Studio imports clips that already exist. It does not record.\n"
                + "- A whole folder can be matched at once when the file names follow a pattern you set.\n"
                + "- The lines to record can be exported as a spreadsheet file for whoever records them.\n"
                + "- A line whose text changed after its clip was assigned is marked out of date, which is how "
                + "re-recording work is located.",
        },
        localization: {
            title: "Languages",
            body:
                "Every line can carry a translation per language, and each translation is in one of four states: "
                + "untranslated, translated, out of date, or not needed.\n"
                + "\n"
                + "- A translation goes out of date when the original text changes after it was translated.\n"
                + "- A language can be exported as CSV, XLIFF, PO or JSON, translated elsewhere, and imported "
                + "back. The import reports how many lines it applied and how many it could not match.\n"
                + "- Export and import are in the language row's menu.",
        },
        brand: {
            title: "Brand colors",
            body:
                "A color decided here can be used anywhere in the project. A field set to a project color "
                + "follows it, so changing the color here changes every place that uses it.\n"
                + "\n"
                + "- The colors at the top belong to the project. The groups under them are the parts each "
                + "control is painted with, and every part starts out following one of the colors above.\n"
                + "- A part can be pointed at a different color, or given a color of its own.\n"
                + "- Deleting a color does not rewrite the places that used it. Those places fall back to "
                + "their own default color, and project check reports them.",
        },
        uiSurfaces: {
            title: "Game screens",
            body:
                "The UI editor builds the game's own screens: the main menu, save and load, the dialogue box. "
                + "Widgets are placed on a surface, and a blueprint decides what they do.\n"
                + "\n"
                + "- The surface is drawn at the size the game draws it, so the placement matches what players "
                + "see.\n"
                + "- A surface belongs to the game. Changing one changes the shipped game, not Studio.",
        },
        uiComponents: {
            title: "Reusable parts",
            body:
                "Widgets that belong together can be saved as a component and placed on any screen. Every "
                + "placement stays linked to the component, so changing the component changes all of them.\n"
                + "\n"
                + "- A placement can be moved, resized and rotated. Changing anything else requires unlinking it "
                + "first, after which it no longer follows the component.\n"
                + "- The library states how many placements each component has.\n"
                + "- After a component is deleted, its placements show as missing until they are replaced or "
                + "unlinked.",
        },
        blueprints: {
            title: "Blueprints",
            body:
                "A blueprint defines what a screen does: what runs when a button is pressed, what runs when the "
                + "screen opens. Every graph starts from an event.\n"
                + "\n"
                + "Nodes run along the wires between them. One kind of wire sets the order of execution, the "
                + "other carries values from one node into the next.\n"
                + "\n"
                + "- Right-click the canvas to add a node. It follows the cursor until it is placed.\n"
                + "- Each pin takes one wire. Values with no wire are typed on the node itself.\n"
                + "- Problems are listed under the canvas, and selecting one selects what it refers to.",
        },
        uiBindings: {
            title: "Values on a screen",
            body:
                "A widget can show a value that changes at run time instead of fixed text. Bind the property to "
                + "a field, and the widget shows that field's current value.\n"
                + "\n"
                + "- A field belongs to the page, to the application, or to one item of a list, and that decides "
                + "how long its value is kept.\n"
                + "- Blueprints read and write the same fields, so operating one widget can change what another "
                + "widget shows.\n"
                + "- A binding whose field no longer exists is reported as broken, on the surface and in the "
                + "blueprint.",
        },
        networkNodes: {
            title: "Reading data from the internet",
            body:
                "The Fetch node makes an HTTP request while the game runs, for an online notice board or a "
                + "leaderboard. It leaves by one of four paths: the request succeeded, the server answered with an "
                + "error, the network failed, or it took too long.\n"
                + "\n"
                + "- Fetch produces a Response. Read Response Text or Read Response JSON turns it into a value.\n"
                + "- A Response is only readable during the run that fetched it. To keep the data, read it and "
                + "store it in a variable.\n"
                + "- Allow HTTP in project settings decides whether these nodes work at all. With it off, the "
                + "project reports an error and the build is refused.\n"
                + "- Only http and https addresses can be fetched.",
        },
        lint: {
            title: "Project checks",
            body:
                "Checks read the whole project and report what will not run: references to assets that no longer "
                + "exist, jumps to labels that were never declared, rows the compiler will not accept, media "
                + "formats the chosen platform cannot play.\n"
                + "\n"
                + "- Every finding states where it came from, and selecting it opens that place.\n"
                + "- Running the checks modifies nothing. They only report.",
        },
        tests: {
            title: "Tests",
            body:
                "A test runs the game and reports whether a condition held: that an ending can be reached, that "
                + "nothing failed on the way.\n"
                + "\n"
                + "- A test reports passed, failed or skipped. Cancelled and errored mean the run did not finish, "
                + "not that the game is wrong.\n"
                + "- The report keeps the last run's findings until the test runs again.",
        },
        recovery: {
            title: "Recovery mode",
            body:
                "When part of a project cannot be read, Studio offers to open the window read-only and without "
                + "plugins. Nothing is written in this mode, so the parts that loaded cannot overwrite the parts "
                + "that did not.\n"
                + "\n"
                + "- The panel lists every failure, each with the error it reported.\n"
                + "- The load checks read the project one part at a time and report the result. Whatever loads "
                + "can be browsed as usual.\n"
                + "- With a version history in the project, a working version can be restored from here.\n"
                + "- Leaving recovery mode reopens the project the normal way.",
        },
        dashboard: {
            title: "Project statistics",
            body:
                "The dashboard counts what the project holds and what was added recently: scenes, lines, words, "
                + "characters, assets and the days written on.\n"
                + "\n"
                + "- Words are counted from story text, so a day spent only on screens, assets or blueprints "
                + "counts zero.\n"
                + "- Counting starts the first time the project is opened in a Studio that records these numbers. "
                + "There is no data before that.",
        },
        versionControl: {
            // Not "Versions": that is the section heading it sits under, and the list read as a
            // heading followed by itself.
            title: "Version control",
            body:
                "A version is a point that can be returned to. History is kept inside the project folder, and no "
                + "version is created unless you submit one, apart from the checkpoint taken before a restore.\n"
                + "\n"
                + "- Submitting a version appends to the list. It never replaces or removes an existing version.\n"
                + "- The list does not detect changes on its own. Run a check when one is needed.",
        },
        versionChanges: {
            title: "Changes since the last version",
            body:
                "Before a version is submitted, Studio can list the differences from the last one: which files "
                + "changed, and inside them which scenes, rows, characters and assets changed.\n"
                + "\n"
                + "- Differences are computed when a check is run. The list states when it was last checked.\n"
                + "- A row that changed is shown with both sides, before and after.\n"
                + "- Viewing differences writes nothing. The project is left as it is.",
        },
        versionConflicts: {
            title: "Choosing between two versions",
            body:
                "When the same part of a file changed locally and on the server, the merge stops and asks which "
                + "side to keep. The project stays frozen until every conflict has an answer.\n"
                + "\n"
                + "- Both sides are shown side by side, and one side is kept per item.\n"
                + "- Everything that merged automatically is already in place. Only what could not be merged is "
                + "asked about.\n"
                + "- Finishing the merge submits a version, and the result is stored in the history like any "
                + "other.",
        },
        versionServer: {
            title: "Working with a server",
            body:
                "A project can be connected to a version control server so that several people can work on it. "
                + "Nothing is sent or fetched except by an explicit action.\n"
                + "\n"
                + "- Send uploads the versions you submitted to the server.\n"
                + "- Get downloads the versions on the server and merges them into the local project.\n"
                + "- When both sides have new versions, get first and send afterwards.\n"
                + "- Checking the current state contacts the server, so it takes a moment.",
        },
        versionViewing: {
            title: "Looking at an old version",
            body:
                "Opening a version from the list shows the editors as they were at that point. The files in the "
                + "project are not modified, and nothing is saved while a version is open.\n"
                + "\n"
                + "- Stop Viewing History returns the current work unchanged.\n"
                + "- Anything typed while a version is open is discarded on leaving.",
        },
        versionRestore: {
            title: "Restoring a version",
            body:
                "Restoring replaces the files in the project with that version's contents. It is the only action "
                + "in the version rail that modifies what is on disk.\n"
                + "\n"
                + "- The current state is recorded as a checkpoint first, so a restore can itself be undone.\n"
                + "- No version is removed. The restored state is appended as a new one.",
        },
        freeze: {
            title: "Frozen projects",
            body:
                "A frozen project is not written to. Editors still open and content can still be read, but "
                + "changes are not saved to disk.\n"
                + "\n"
                + "- Studio freezes the project while an old version is open and while a merge is unfinished. It "
                + "can also be frozen manually.\n"
                + "- Controls that would write are disabled rather than hidden, so the layout stays the same.",
        },
        build: {
            title: "Builds",
            body:
                "A build produces the files handed to players. Choose the target platforms and formats.\n"
                + "\n"
                + "- Web, Android and iOS build on any machine. macOS builds only on a Mac.\n"
                + "- An unsigned build runs, but the first launch shows a security prompt on Windows and macOS.\n"
                + "- Icons come from the project's icon page. A platform whose icon has not been generated builds "
                + "with the NarraLeaf icon.",
        },
        buildVariant: {
            title: "Which variant a build produces",
            body:
                "A build produces one variant of the project. Release carries the project's own "
                + "application name, identifier and version; another variant carries what it states "
                + "instead.\n"
                + "\n"
                + "- The pages after this one describe the selected variant.\n"
                + "- File names carry the variant, so two variants built into one folder do not replace "
                + "each other.\n"
                + "- This page appears once the project has a variant beside Release.",
        },
        appTags: {
            title: "Build variants",
            body:
                "A variant is one edition of the project, such as a demo. Every project has the Release "
                + "variant, and each variant added beside it starts out identical to Release.\n"
                + "\n"
                + "- A variant stores only what it says differently. A field left empty shows the Release "
                + "value and follows it.\n"
                + "- Restore removes what the variant said, so the field follows Release again.\n"
                + "- Deleting a variant does not rewrite what pointed at it. Those places read Release "
                + "from then on, and the count beside Delete says how many there are.",
        },
        icons: {
            title: "Icons",
            body:
                "One image is the application icon, and each platform's icons are generated from it in the sizes "
                + "and shapes that platform requires. A platform that needs a different image can be given its "
                + "own.\n"
                + "\n"
                + "- Generated icons are stored in the project, so a build on another machine uses the same set.\n"
                + "- An iOS icon cannot contain transparency. It is drawn on a background color, white by "
                + "default.\n"
                + "- A platform with no generated icons builds with the NarraLeaf icon.",
        },
        signing: {
            title: "Signing a build",
            body:
                "A signature states where a build came from. An unsigned build runs, but the first launch shows "
                + "a security prompt on Windows and macOS, and iOS installs nothing unsigned.\n"
                + "\n"
                + "- A credential is chosen per platform and stays on this machine. It does not travel with the "
                + "project.\n"
                + "- Before the build starts, the dialog states whether the chosen credential can be used here "
                + "and what is missing if it cannot.\n"
                + "- Android with no key chosen is signed with a local debug identity, which is only good for "
                + "installing by hand.",
        },
        assetProtection: {
            title: "Protecting what you ship",
            body:
                "With asset protection on, the images, audio, story text and plugin code inside a packaged game "
                + "are encrypted, and so are the player's saves. Dev Mode is unaffected.\n"
                + "\n"
                + "- Web builds always ship without it, because the browser has to read the files directly.\n"
                + "- It prevents the files from being opened with ordinary tools. Reading them from the running "
                + "game is still possible.\n"
                + "- The other switch on this page decides whether the game may use the network.",
        },
        webOptimization: {
            title: "Reducing download size",
            body:
                "The exported site can be reduced two ways. Android and iOS builds serve the same site, so both "
                + "are reduced too.\n"
                + "\n"
                + "- Converting images loses no pixels: each conversion is compared against the original and "
                + "discarded unless it is identical.\n"
                + "- Recompressing images is lossy. It is much smaller, and the detail it drops cannot be "
                + "recovered.\n"
                + "- Precompressed text files are used only by a server configured to serve them. Every other "
                + "host serves the originals.",
        },
        plugins: {
            title: "Plugins",
            body:
                "A plugin adds capabilities to Studio: story commands, blueprint nodes, widgets, tests, and "
                + "whole panels.\n"
                + "\n"
                + "- A plugin declares what it needs before any of its code runs, and that list is approved at "
                + "install time.\n"
                + "- What a plugin contributes appears in the same places as the built-in equivalents, marked "
                + "with the plugin it came from.\n"
                + "- A project records the plugins it depends on. Opened on a machine that is missing one, it "
                + "states which plugin is missing and what in the project uses it.",
        },
    },
} as const;
