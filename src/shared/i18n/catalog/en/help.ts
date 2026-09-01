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
        // First in the list, so it is what the browser opens on and what `F1` reaches when
        // nothing under the pointer has a topic of its own.
        gettingHelp: {
            title: "Getting help",
            body:
                "Press F1 for help on whatever has focus, or whatever the pointer is over. The topic "
                + "opens beside it and closes on Escape.\n"
                + "\n"
                + "Panel headers and dialogs show a question mark under the pointer. It opens the topic "
                + "for that panel.\n"
                + "\n"
                + "- See also moves to a related topic, and the back arrow in the header returns to the "
                + "previous one.\n"
                + "- This list holds every topic. The search field above it matches titles and bodies.\n"
                + "- The command palette lists every topic by name under Help.\n"
                + "- Where there is no topic, F1 opens this list.",
        },
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
            title: "Running the game",
            body:
                "Dev Mode opens the game in a Studio window with the debug panels: jump to a story row, "
                + "inspect variables, reload without leaving the editor.\n"
                + "\n"
                + "Preview runs the game in its own window, in the form players receive it, without the "
                + "debug panels.\n"
                + "\n"
                + "Build produces the files delivered to players. Dev Mode and Preview take seconds; a build "
                + "takes minutes.\n"
                + "\n"
                + "- Dev Mode opens the line that is playing in the story editor, from its debug menu.\n"
                + "- Run starts the mode chosen last.\n"
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
            title: "Search",
            body:
                "Search covers story text, scene and character names, assets, blueprint nodes and UI widgets. "
                + "Every result states where it is, and selecting one opens that place.\n"
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
                + "- The bundled template is a short story that runs as delivered: three scenes, one choice, "
                + "and the title, save, load, config and backlog screens.",
        },
        undo: {
            title: "Undo and redo",
            body:
                "Undo reverses the last change, in the editor that made it. The editor with focus performs it. "
                + "With focus outside every editor, the workspace performs it.\n"
                + "\n"
                + "- Each editor keeps its own steps, so switching tabs does not merge them.\n"
                + "- Undo and redo are also in the Edit menu.\n"
                + "- Undo covers changes inside the project. Files written to disk, build output and submitted "
                + "versions are outside its range.\n"
                + "- A closed tab can be reopened.",
        },
        studioSettings: {
            title: "Studio settings",
            body:
                "Settings belong to Studio on this machine, not to a project. Opening another project leaves "
                + "them unchanged, and a project given to someone else does not carry them.\n"
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
                + "spellings parse, and the English spellings remain valid.\n"
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
                + "the whole project, in the variables panel. Any scene and any blueprint can then use them.",
        },
        storyFlow: {
            title: "Branches and routes",
            body:
                "The flow view reads the scenes and draws the paths the story can take: which choice leads where, "
                + "which scenes are reachable only through a branch, and where a path ends.\n"
                + "\n"
                + "- A path that ends is not always an ending. It can be a branch with nothing written after it, "
                + "or a return to a scene already visited.",
        },
        storyExpressions: {
            title: "Expressions",
            body:
                "Wherever a command takes a value, it also takes an expression: a comparison, an arithmetic "
                + "operation, a call. The row marks what is wrong as it is typed, and a row whose expression "
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
                + "that row runs, and the variables it would have set hold the values the project declares for "
                + "them.\n"
                + "\n"
                + "- A snapshot belongs to one scene and gives every variable in its scope a starting value.\n"
                + "- A snapshot is optional. Starting from a row without one uses the declared values.\n"
                + "- A row start uses the snapshot selected in the Scene Snapshots panel.\n"
                + "- Snapshots do not affect the finished game.",
        },
        dictionary: {
            title: "Project dictionary",
            body:
                "The dictionary holds the words this project writes on purpose: character names, place names, "
                + "invented vocabulary. It is part of the project and is available to everyone who opens it.\n"
                + "\n"
                + "An entry is a term, and three fields that may be left empty:\n"
                + "\n"
                + "- Reading: the ruby the term is annotated with.\n"
                + "- Variant spellings: spellings that mean the term but are not how this project writes it.\n"
                + "- Note: what the term is, for whoever reads the list later.\n"
                + "\n"
                + "A term is added in the dictionary panel, or from a story row: select the words and choose Add "
                + "to dictionary, or right-click a marked word.",
        },
        dictionaryMarks: {
            title: "Dictionary marks",
            body:
                "Every spelling in the dictionary is accepted when the source text is checked, terms and variant "
                + "spellings alike.\n"
                + "\n"
                + "Two marks of its own appear in the row being edited. Both are switched on and off for the whole "
                + "project at the foot of the dictionary panel.\n"
                + "\n"
                + "- An amber wave marks a variant spelling. Right-clicking it writes the term instead.\n"
                + "- A dotted line marks a term the dictionary holds a reading for, where the row carries no ruby. "
                + "Right-clicking it applies the reading.\n"
                + "\n"
                + "Check project reads every story for variant spellings and lists each place under the term it "
                + "belongs to. Selecting one opens that row. Readings are left out of it: a term with a reading "
                + "occurs wherever it appears.",
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
                + "- The preview is drawn at the size the game draws, so its timing matches playback.",
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
        assetSets: {
            title: "Asset sets",
            body:
                "An asset set is one library entry standing for several files that differ by language or by "
                + "build variant. A story row names the set instead of a file, and the game uses the file "
                + "that matches.\n"
                + "\n"
                + "A set stays in the folder it was created in, and its files are listed inside it rather "
                + "than beside the other files.\n"
                + "\n"
                + "- Select two or more files of one type and choose New Set from Selection. In a folder's "
                + "menu, New Asset Set starts one from files chosen in the dialog.\n"
                + "- The dialog asks what the set varies by, then which file each value uses.\n"
                + "- Choosing a file for a value in the Variants list adds that file to the set.\n"
                + "- Dissolve Set removes the set and leaves its files in the folder it stood in. "
                + "Delete removes the set and the files in it. Both first list the places that reference the set.\n"
                + "- Where a field accepts a set, the picker lists them under Asset sets. Character "
                + "appearances and interface widgets accept a file.",
        },
        assetSetAxes: {
            title: "What a set varies by",
            body:
                "A set varies by one of two things, chosen when it is created:\n"
                + "\n"
                + "- Language: every file is in the package, and the game uses the file for the language it "
                + "is running in.\n"
                + "- Variant: the build uses the file for the variant being built, and the other files are "
                + "left out of the package.\n"
                + "\n"
                + "One value is the fallback, and it is the only value that requires a file. A value with no "
                + "file of its own uses the fallback's file. A language that has a fallback language uses "
                + "that language's file first.\n"
                + "\n"
                + "To vary by both, make a second set under one value: select its files, right-click the "
                + "value, and choose New Set from Selection, Here.\n"
                + "\n"
                + "The project check reports a value with no file, and a value that more than one file "
                + "matches. Under Build variants, each variant states which value it takes, and a build "
                + "stops while the variant being built states none.",
        },
        mediaConversion: {
            title: "Converting unplayable files",
            body:
                "Some audio and video files cannot play in a game. When one is imported, Studio offers to "
                + "convert it and states the effect of the conversion.\n"
                + "\n"
                + "- Converting writes a new file into the project. The source file is not modified.\n"
                + "- Some files convert with picture and sound identical to the original.\n"
                + "- Others must be re-encoded, which takes longer and loses some quality.\n"
                + "- A file with no playable content is skipped and listed with the reason.\n"
                + "\n"
                + "Files already in the project are marked in the asset browser, and the mark starts the same "
                + "conversion in place. The file keeps its name, and every reference to it remains valid.\n"
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
            title: "Character appearances",
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
                "A model is drawn by a runtime, and Studio includes none. Each project installs the runtimes it "
                + "needs, once each.\n"
                + "\n"
                + "- Studio does not download runtimes. A runtime comes from its vendor, and its terms "
                + "are accepted there.\n"
                + "- Live2D and Spine are licensed by their own companies. Their terms are shown before the "
                + "install starts, and they apply to the shipped game.\n"
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
                "Opening an audio asset shows its waveform, where three marks can be set: the start, the loop "
                + "point and the end.\n"
                + "\n"
                + "- With a loop point set, the opening plays once and the part after it repeats.\n"
                + "- The marks belong to the asset, so every row that plays it uses them.\n"
                + "- Playback, movement, marking and zooming all have keyboard actions.",
        },
        voice: {
            title: "Voice-over",
            body:
                "A voice language holds one clip per spoken line. The panel lists the voice languages with how "
                + "much of the story each covers, and opening one shows its table of lines.\n"
                + "\n"
                + "- Studio imports existing clips. It does not record.\n"
                + "- A whole folder can be matched at once when the file names follow a pattern.\n"
                + "- The lines to record can be exported as a spreadsheet file for the person recording them.\n"
                + "- A line whose text changed after its clip was assigned is marked out of date.\n"
                + "- Choice options become lines to record only when the panel includes them.",
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
                + "- Export and import are in the language row's menu.\n"
                + "- Changing language during a game restarts it and returns the player to the line they "
                + "were on. Project settings offer two alternatives: restart without "
                + "keeping the playthrough, or apply the next time the game is started.",
        },
        brand: {
            title: "Colors and fonts",
            body:
                "A color or a font decided here can be used anywhere in the project. A field set to a "
                + "project color follows it, so changing the color here changes every place that uses it.\n"
                + "\n"
                + "- The colors at the top belong to the project. The groups under them are the parts each "
                + "control is painted with, and every part follows one of the colors above by default.\n"
                + "- A part can be pointed at a different color, or given a color of its own.\n"
                + "- Deleting a color does not rewrite the places that used it. Those places fall back to "
                + "their own default color, and the project check reports them.\n"
                + "- The fonts are a list in priority order: text is set in the first of them that has the "
                + "character. A widget that names no font of its own is set in this list, and one that "
                + "names a font falls back to the list for the characters that font does not have.\n"
                + "- A font in the list can be limited to some of the project's languages. A language "
                + "then uses the list with the fonts limited to other languages left out, so one list "
                + "serves every language and adding a language asks for nothing. A font that is not "
                + "limited is used for every language, which is how every font starts.\n"
                + "- Limits appear only once the project has a second language. When a font is added, "
                + "Studio reads the font file and fills the limit in if the font states which language "
                + "it was made for; it leaves it empty otherwise.\n"
                + "- The project check reports characters the script uses that no font in the list can "
                + "draw, for each language.",
        },
        inputActions: {
            title: "Input actions",
            body:
                "An input action is a name for something a player wants to do, together with the gestures "
                + "that trigger it. A blueprint answers the name, so the gestures can change without the "
                + "graph changing with them.\n"
                + "\n"
                + "Three steps put one on screen.\n"
                + "\n"
                + "- Name the action in the Input Actions panel and give it its bindings.\n"
                + "- Open the interface that reacts to it, and switch the action on in its Input section.\n"
                + "- Add an On Action node to that interface's blueprint and pick the action.\n"
                + "\n"
                + "An interface answers nothing until it is switched on, so naming an action does not make "
                + "every screen react to it.",
        },
        inputActionBindings: {
            title: "Bindings and devices",
            body:
                "A binding is one way to trigger an action. An action takes as many as it needs, so the same "
                + "action can be a key on a desktop and a gesture on a phone.\n"
                + "\n"
                + "The picker is grouped by device, and each device names the gesture the way it produces it.\n"
                + "\n"
                + "- Mouse: click, double click, right click, middle click, and the wheel.\n"
                + "- Trackpad: sliding left and right, which a wheel cannot do.\n"
                + "- Touch screen: tap, long press, and sliding in four directions.\n"
                + "- Keyboard: press the combination to record it.\n"
                + "\n"
                + "A gesture that more than one device produces is added once and works on all of them. Each "
                + "binding is marked with the devices that reach it.\n"
                + "\n"
                + "A long press comes only from a finger, so an action bound to it alone does nothing on a "
                + "desktop.",
        },
        inputActionAnswering: {
            title: "Answering an action",
            body:
                "An interface's Input section lists every action the project names. Each one is off until "
                + "the interface answers it.\n"
                + "\n"
                + "After an action fires, the input either stops at that interface or carries on to what is "
                + "drawn behind it. It stops unless the action says otherwise.\n"
                + "\n"
                + "A control under the pointer takes the input first, so an action bound to a click does not "
                + "fire when the player clicked a button inside the interface.\n"
                + "\n"
                + "A scrolling list is the one exception, and only for a scroll: it keeps the scroll while it "
                + "has somewhere left to travel and lets it through once it does not. That is what lets one "
                + "more pull at the bottom of a list close the page the list is in.",
        },
        inputActionsInBlueprints: {
            title: "Actions in blueprints",
            body:
                "Three nodes read input actions.\n"
                + "\n"
                + "- On Action runs when the action fires. It reports which device raised it and where the "
                + "pointer was. It belongs to an interface or to the global blueprint, not to one widget.\n"
                + "- Is Action Held answers whether the action is held at this moment. A key, a mouse button "
                + "and a long press can be held; a scroll is an instant and a double click is a sequence, so "
                + "both read false.\n"
                + "- Get Input Device answers which device the player is using, for a line that has to read "
                + "differently on a phone.\n"
                + "\n"
                + "A widget that reacts to being clicked uses its own Mouse Click head instead. An action is "
                + "what the interface does with an input nothing on it wanted.",
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
                + "Execution follows the wires between the nodes. One kind of wire sets the order of execution, the "
                + "other carries values from one node into the next.\n"
                + "\n"
                + "- Right-click the canvas to add a node. It follows the cursor until it is placed.\n"
                + "- The toolbar sets what a drag on empty canvas does: selecting, or moving the view.\n"
                + "- A selection can be framed as a group that moves as one, and the whole graph can be "
                + "arranged from left to right.\n"
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
            title: "Network requests",
            body:
                "The Fetch node makes an HTTP request while the game runs, for an online notice board or a "
                + "leaderboard. It leaves by one of four paths: the request succeeded, the server answered with an "
                + "error, the network failed, or the request timed out.\n"
                + "\n"
                + "- Fetch produces a Response. Read Response Text or Read Response JSON turns it into a value.\n"
                + "- A Response is only readable during the run that fetched it. To keep the data, read it and "
                + "store it in a variable.\n"
                + "- The network policy in project settings decides whether these nodes run. With no "
                + "network access, the project reports an error and the build is refused.\n"
                + "- Only http and https addresses can be fetched.",
        },
        spellcheck: {
            title: "Spelling",
            body:
                "The source text of a story is checked for spelling. Translations are not.\n"
                + "\n"
                + "The language follows the project's source language, and can be set to another one, or to none, "
                + "in Settings. A language is checked once its dictionary has been downloaded, under Spelling "
                + "dictionaries in the same place. Until then nothing is marked.\n"
                + "\n"
                + "- A red wave marks a misspelling. Right-clicking it offers replacements, and offers to add the "
                + "word to the project dictionary.\n"
                + "- Chinese and Japanese are read a word at a time against the dictionary of the language. What "
                + "is marked is a run of characters that spells no word in it. A mistyped character that spells "
                + "another word is not found.",
        },
        lint: {
            title: "Project checks",
            body:
                "Checks read the whole project and report what will not run: references to assets that no longer "
                + "exist, jumps to labels that were never declared, rows the compiler will not accept, media "
                + "formats the chosen platform cannot play.\n"
                + "\n"
                + "- Every finding states where it came from, and selecting it opens that place.\n"
                + "- Running the checks modifies nothing.",
        },
        tests: {
            title: "Tests",
            body:
                "A test runs the game and reports whether a condition held: that an ending can be reached, that "
                + "nothing failed during the run.\n"
                + "\n"
                + "- The list contains Studio's own tests and the tests added by plugins. A windowed test opens "
                + "a game window, a headless test runs without one.\n"
                + "- A test can ask for a value before it starts, such as which ending to play to. It opens on "
                + "what that test was last run with in this project.\n"
                + "- A test that cannot start remains in the list, disabled, with the reason beside it.\n"
                + "- Starting a test closes this dialog. The output appears in the console, and the report "
                + "opens when the run finishes.\n"
                + "- A test reports passed, failed or skipped. Cancelled and errored mean the run did not finish, "
                + "not that the game failed the test.\n"
                + "- The report retains the findings of the last run until the test runs again.",
        },
        recovery: {
            title: "Recovery mode",
            body:
                "When part of a project cannot be read, Studio offers to open the window read-only and without "
                + "plugins. Nothing is written in this mode.\n"
                + "\n"
                + "- The panel lists every failure, each with the error it reported.\n"
                + "- The load checks read the project one part at a time and report the result. The parts that load "
                + "can be browsed as usual.\n"
                + "- With a version history in the project, a working version can be restored from here.\n"
                + "- Leaving recovery mode reopens the project normally.",
        },
        dashboard: {
            title: "Project statistics",
            body:
                "The dashboard counts what the project holds and what was added recently: scenes, lines, words, "
                + "characters, assets and the days with writing.\n"
                + "\n"
                + "- Words are counted from story text, so a day spent only on screens, assets or blueprints "
                + "records no words.\n"
                + "- Counting starts the first time the project is opened in a Studio version that records them. "
                + "Work before that is not counted.",
        },
        versionControl: {
            // Not "Versions": that is the section heading it sits under, and the list read as a
            // heading followed by itself.
            title: "Version control",
            body:
                "A version is a point that can be returned to. History is kept inside the project folder, and no "
                + "version is created except by submitting one, apart from the checkpoint taken before a restore.\n"
                + "\n"
                + "- Submitting a version appends to the list. It never replaces or removes an existing version.\n"
                + "- Changes are not detected automatically. Run a check to list them.",
        },
        versionChanges: {
            title: "Changes since the last version",
            body:
                "Before a version is submitted, Studio can list the differences from the last one: which files "
                + "changed, and inside them which scenes, rows, characters and assets changed.\n"
                + "\n"
                + "- Differences are computed when a check is run. The list states when it was last checked.\n"
                + "- A row that changed is shown with both sides, before and after.\n"
                + "- Viewing differences writes nothing. The project is not modified.",
        },
        versionConflicts: {
            title: "Merge conflicts",
            body:
                "When the same part of a file changed locally and on the server, the merge stops and asks which "
                + "side to keep. The project stays frozen until every conflict has an answer.\n"
                + "\n"
                + "- Both sides are shown side by side, and one side is kept per item.\n"
                + "- Everything that merged automatically is already in place. Only the parts that "
                + "could not be merged require an answer.\n"
                + "- Finishing the merge submits a version, and the result is stored in the history like any "
                + "other.",
        },
        versionServer: {
            title: "Working with a server",
            body:
                "A project can be connected to a version control server so that several people can work on it. "
                + "Nothing is sent or fetched except by an explicit action.\n"
                + "\n"
                + "- Send uploads submitted versions to the server.\n"
                + "- Get downloads the versions on the server and merges them into the local project.\n"
                + "- When both sides have new versions, Get first and Send afterwards.\n"
                + "- Checking the current state contacts the server.\n"
                + "- The server, and the account versions are recorded under, are set from NarraLeaf Team "
                + "in the bottom-left corner of the window.",
        },
        versionViewing: {
            title: "Viewing an old version",
            body:
                "Opening a version from the list shows the editors as they were at that point. The files in the "
                + "project are not modified, and nothing is saved while a version is open.\n"
                + "\n"
                + "- Stop Viewing History returns to the current work, unchanged.\n"
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
                "A frozen project is not written to. Editors open and content can be read, but changes are "
                + "not saved to disk.\n"
                + "\n"
                + "- Studio freezes the project while an old version is open and while a merge is unfinished. It "
                + "can also be frozen manually.\n"
                + "- Controls that would write are disabled rather than hidden, so the layout stays the same.",
        },
        build: {
            title: "Builds",
            body:
                "A build produces the files delivered to players. Choose the target platforms and formats.\n"
                + "\n"
                + "- Web, Android and iOS build on any machine. macOS builds only on a Mac.\n"
                + "- An unsigned build runs, but the first launch shows a security prompt on Windows and macOS.\n"
                + "- Icons come from the project's icon page. A platform whose icon has not been generated builds "
                + "with the NarraLeaf icon.",
        },
        saveLocation: {
            title: "Where saves are kept",
            body:
                "A shipped desktop game writes the player's files to one of two places, answered "
                + "here for Windows and Linux and again for macOS.\n"
                + "\n"
                + "- The game's folder: the files travel with the player's copy of the game. Copying "
                + "that folder to another machine carries their progress; removing the game removes "
                + "them; everyone using that computer shares one set.\n"
                + "- The user folder: every person using the computer has their own, and removing "
                + "the game leaves them in place. A storefront's save synchronisation can be pointed "
                + "at this one.",
        },
        // The three states a save can be in against the build in front of it, and which of the two
        // settings answers for each. A parent topic rather than a preamble repeated on both rows.
        olderSaves: {
            title: "Older saves",
            body:
                "A player's save falls into one of three cases. The settings on this page decide two of "
                + "them.\n"
                + "\n"
                + "- Written by this build: restored in full. Neither setting applies.\n"
                + "- Same story, another project version: decided by the first setting.\n"
                + "- Written before the story changed: decided by the second setting.\n"
                + "\n"
                + "A save that is not restored is absent from the save list. The player is never offered a "
                + "slot that cannot be read.",
        },
        saveSameStory: {
            title: "Saves from another project version",
            body:
                "The story is unchanged, and the line the save records is still in it.\n"
                + "\n"
                + "- Restore progress: play continues from that line.\n"
                + "- Do not restore progress: the slot is absent from the save list, and a load request "
                + "fails.",
        },
        saveStoryChanged: {
            title: "Saves from before a story change",
            body:
                "The story was edited after the save was written. The line the save records may no longer "
                + "be present.\n"
                + "\n"
                + "- Restore progress anyway: play continues from that line, and fails when the story "
                + "lacks what the save requires.\n"
                + "- Return to where it stopped: play starts again on that line, at the start of its scene "
                + "when the line is absent, and fails when the scene is absent as well. Variables and "
                + "visited scenes are kept. The stage and the backlog are not.\n"
                + "- Do not restore progress: the slot is absent from the save list, and a load request "
                + "fails.",
        },
        patches: {
            title: "Patches",
            body:
                "A patch delivers later changes to an installed game: the story, the pages, the translations, "
                + "the voice lines and the assets. Application files and the engine version remain as the "
                + "installed build produced them.\n"
                + "\n"
                + "- A patch opens only in builds of the variant it was exported for, and only in builds "
                + "produced after the project has a distribution key.\n"
                + "- The build a patch updates is either built as part of the export, or named as a build "
                + "folder an earlier build produced. Building it compares two variants of the project as it "
                + "stands now; an edition upgrade and a DLC are made this way. Naming a folder compares "
                + "against that build; a fix to something already released is made this way.\n"
                + "- The content comes from the variant selected below the build, and it need not be the "
                + "same variant. A patch that installs into the demo and carries the full game's content "
                + "turns that demo into the full game.\n"
                + "- The patch is limited to the files that differ from the build it updates, and to the "
                + "changes it makes to that build\u2019s content. Where no build is named and none is "
                + "built, the patch includes the whole game and replaces the content of any patch "
                + "installed below it.\n"
                + "- Several patches installed together each apply. Where two of them change the same scene, "
                + "page, entry or file, the higher layer applies over the lower one.\n"
                + "- The export produces a folder named patch. Placing that folder in the game's folder "
                + "installs the patch, and deleting it restores the installed build. A DLC is written to a "
                + "folder named DLC instead, under the name its own record states.\n"
                + "- The checks that precede a build also precede an export, and both report in the build "
                + "console.\n"
                + "- Where there is a build to compare against, the export also reports which saves made "
                + "against it will no longer load. That report is a warning and does not stop the export.",
        },
        // `main` is the release variant's name, and it is the same word in every language: a story
        // expression compares it as a string inside the shipped game, where no catalog is reached.
        // Written out here rather than interpolated because a topic body is one static string.
        buildVariant: {
            title: "Variant selection",
            body:
                "A build produces one variant of the project. The variant named main carries the "
                + "project's own application name, identifier and version; another variant carries "
                + "what it states instead.\n"
                + "\n"
                + "- The pages after this one describe the selected variant.\n"
                + "- File names carry the variant, so two variants built into one folder do not replace "
                + "each other.\n"
                + "- This page appears once the project has a variant beside main.",
        },
        appTags: {
            title: "Build variants",
            body:
                "A variant is one edition of the project, such as a demo. Every project has the variant "
                + "named main, and each variant added beside it begins identical to main. The name "
                + "main is the same in every language.\n"
                + "\n"
                + "- A variant stores only the values it changes. A field left empty shows the main "
                + "value and follows it.\n"
                + "- Restore removes the variant's own value, and the field follows main again.\n"
                + "- A variant lists the links the game can open. A build opens the addresses its "
                + "variant lists and no others, matched exactly, so a page at a different address needs a "
                + "line of its own.\n"
                + "- Deleting a variant does not rewrite what pointed at it. Those places read main "
                + "from then on, and the count beside Delete states how many.",
        },
        variantContent: {
            title: "Variant build contents",
            body:
                "A cut point row ends one variant's story at that row. A build of that variant carries "
                + "nothing written after it, and a scene left unreachable is dropped from the package. "
                + "Builds of every other variant carry the row as written.\n"
                + "\n"
                + "- A cut point sits at the top level of a scene. One inside a condition or a group "
                + "stops the build.\n"
                + "- A comparison against AppTag is settled before the build, so only the branch that "
                + "runs is packaged. A comparison that cannot be settled stops the build and names the row.\n"
                + "- Text, voice and images used only by the removed rows are left out with them.\n"
                + "- A variant can name the page shown after its story ends. With no page named, the "
                + "last frame stays on screen.",
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
                + "- Android with no key chosen is signed with a local debug identity, which stores do not "
                + "accept.",
        },
        networkAllowlist: {
            title: "Network request allowlist",
            body:
                "The network policy in project settings has three positions: no network access, allowlisted addresses only, and any address. The middle one narrows the project to the addresses it lists; every other request is refused, in the editor preview and in the built game.\n"
                + "\n"
                + "- A host written alone covers every path under it. Write https://api.example.com/v1/* to cover one part of a host.\n"
                + "- * can replace the first host label, as in https://*.example.com/*.\n"
                + "- The scheme, the host and the port must match exactly. https://example.com does not cover http://example.com.\n"
                + "- Addresses a plugin declared are listed under the allowlist and are also reachable. They are the addresses approved when the plugin was installed.\n"
                + "- A Fetch node whose address is written out and not covered is reported by project checks, and the build is refused. An address a blueprint computes is refused while the game runs.\n"
                + "- A program a plugin ships runs outside the game process. The allowlist does not cover it.",
        },
        assetProtection: {
            title: "Asset protection",
            body:
                "With asset protection enabled, the images, audio, story text and plugin code inside a packaged game "
                + "are encrypted, and so are the player's saves. Dev Mode is unaffected.\n"
                + "\n"
                + "- Web builds always ship without it.\n"
                + "- It prevents the files from being opened with ordinary tools. Reading them from the running "
                + "game is still possible.\n"
                + "- The other switch on this page decides whether the game may use the network.",
        },
        screenEffects: {
            title: "Screen effect frame rate",
            body:
                "Snow, rain and sakura are baked for the project, and the rate set on Project ▸ App is how "
                + "many frames a second each one holds.\n"
                + "\n"
                + "30 is smooth for falling particles. A higher rate is more frames, so the bake takes "
                + "proportionally longer and the effect adds proportionally more to the download: 120 costs "
                + "four times what 30 does.\n"
                + "\n"
                + "A new rate applies to the next bake. Effects already baked at another rate stay in the "
                + "cache and are used again if the rate is set back.\n"
                + "\n"
                + "Ambience clips imported as assets keep the frame rate they were made at.",
        },
        assetCompression: {
            title: "Reducing download size",
            body:
                "Every build converts images to a smaller format where that loses no detail, removes the "
                + "metadata a file carries about who made it, and writes precompressed copies of the text files a "
                + "browser export serves. None of that changes the game, and none of it is a setting.\n"
                + "\n"
                + "Compression does change the game, and each kind of material has a switch of its own.\n"
                + "\n"
                + "- Compression is lossy. It produces much smaller files, and what it drops cannot be recovered.\n"
                + "- Each switch applies to every package the project builds, on every platform.\n"
                + "- A track can be set by one quality or by the encoder's own values. Switching to the second starts from what the first was already producing.\n"
                + "- The project keeps the files as they were imported. Only the shipped copy is compressed.\n"
                + "- A file that would not come out meaningfully smaller ships unchanged, as does video carrying "
                + "transparency.\n"
                + "- Precompressed text files are used only by a server configured to serve them. Every other host "
                + "serves the originals.",
        },
        plugins: {
            title: "Plugins",
            body:
                "A plugin adds capabilities to Studio: story commands, blueprint nodes, widgets, tests and "
                + "panels.\n"
                + "\n"
                + "- A plugin declares what it needs, and that list is approved at install time.\n"
                + "- What a plugin contributes appears in the same places as the built-in equivalents, marked "
                + "with the plugin it came from.\n"
                + "- A project records the plugins it depends on. Opened on a machine that is missing one, it "
                + "states which plugin is missing and what in the project uses it.",
        },
    },
} as const;
