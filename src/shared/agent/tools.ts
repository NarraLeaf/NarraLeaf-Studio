/**
 * Every tool Studio offers an agent, in one table.
 *
 * Both halves read this table: the main process lists it in `tools/list` and validates arguments
 * against it before routing a call, and each half registers a handler for exactly the tools whose
 * `side` is its own. Tests on both sides assert that every row has a handler and every handler has a
 * row, so a tool cannot be advertised and missing, or implemented and invisible.
 *
 * **Names use underscores, never dots.** MCP allows any name, but several model APIs that sit behind
 * MCP clients accept only `[a-zA-Z0-9_-]`, and a dotted name is silently dropped there.
 *
 * Descriptions are written for the model that reads them: what the tool is for, when to reach for
 * it, and the one mistake it most often makes. The workflow they add up to is the guide served as
 * the `make_game` prompt and the `narraleaf://guide/*` resources.
 *
 * Comments in English per project convention.
 */

export type AgentJsonSchema = {
    type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
    description?: string;
    properties?: Record<string, AgentJsonSchema>;
    required?: string[];
    items?: AgentJsonSchema;
    enum?: readonly (string | number)[];
    additionalProperties?: boolean | AgentJsonSchema;
    minimum?: number;
    maximum?: number;
    default?: unknown;
    oneOf?: AgentJsonSchema[];
};

export type AgentToolSide =
    /** Answered by the main process. */
    | "main"
    /** Routed to the workspace window that has the project open. */
    | "workspace";

export type AgentToolDescriptor = {
    name: string;
    title: string;
    description: string;
    side: AgentToolSide;
    /** Changes the project. Refused unless the author enabled writes; refused while paused or frozen. */
    write: boolean;
    inputSchema: AgentJsonSchema & { type: "object" };
};

/** The optional argument every workspace tool takes: which open project the call is for. */
const PROJECT_ARG: AgentJsonSchema = {
    type: "string",
    description:
        "Absolute path of the project directory. Needed only when more than one project is open in Studio; otherwise the open one is used.",
};

const BASE_REVISION: AgentJsonSchema = {
    type: "integer",
    description:
        "The `revision` the matching show call returned. The write is refused with `stale_revision` if the author changed the page or scene since then.",
};

const DRY_RUN: AgentJsonSchema = {
    type: "boolean",
    description: "Check only, write nothing. Defaults to false.",
    default: false,
};

function ws(
    name: string,
    title: string,
    description: string,
    properties: Record<string, AgentJsonSchema> = {},
    required: string[] = [],
    write = false,
): AgentToolDescriptor {
    return {
        name,
        title,
        description,
        side: "workspace",
        write,
        inputSchema: { type: "object", properties: { ...properties, project: PROJECT_ARG }, required, additionalProperties: false },
    };
}

function main(
    name: string,
    title: string,
    description: string,
    properties: Record<string, AgentJsonSchema> = {},
    required: string[] = [],
    write = false,
): AgentToolDescriptor {
    return {
        name,
        title,
        description,
        side: "main",
        write,
        inputSchema: { type: "object", properties, required, additionalProperties: false },
    };
}

export const AGENT_TOOLS: readonly AgentToolDescriptor[] = [
    // ── Session and guide ────────────────────────────────────────────────────────────────────────
    main(
        "agent_status",
        "Studio status",
        "Call this first. Says which projects are open in Studio, whether write access is on, whether the author paused you, and which directories you may import files from.",
    ),
    main(
        "agent_guide",
        "Read the guide",
        "Returns one chapter of the NarraLeaf game-making guide as Markdown: `workflow` (the end-to-end order of work - read it before starting a game), `story-format`, `ui-format`, `blueprint-format`, `ui-design`, `script-adaptation`, `verify-and-ship`, `troubleshooting`. The same text is served as MCP resources `narraleaf://guide/<chapter>`.",
        {
            chapter: {
                type: "string",
                enum: ["workflow", "story-format", "ui-format", "blueprint-format", "ui-design", "script-adaptation", "verify-and-ship", "troubleshooting"],
            },
        },
        ["chapter"],
    ),

    // ── Projects ─────────────────────────────────────────────────────────────────────────────────
    main(
        "project_create",
        "Create a project",
        "Creates a new NarraLeaf project from a template and opens it in Studio. Use the `skeleton` template for a game: it ships a title page, dialogue box, save/load, settings and history that work out of the box, which you then restyle. `dir` is the parent directory; the project is created in `<dir>/<name>`.",
        {
            name: { type: "string", description: "Project (and game) name." },
            dir: { type: "string", description: "Absolute parent directory. Defaults to Studio's default projects directory." },
            template: { type: "string", enum: ["skeleton", "empty"], default: "skeleton" },
            language: { type: "string", description: "Source language of the game text, e.g. `zh-CN`, `en`, `ja`.", default: "en" },
            width: { type: "integer", description: "Design width in pixels.", default: 1920 },
            height: { type: "integer", description: "Design height in pixels.", default: 1080 },
        },
        ["name"],
        true,
    ),
    main(
        "project_open",
        "Open a project",
        "Opens an existing project directory in Studio (or focuses it if already open).",
        { path: { type: "string", description: "Absolute project directory." } },
        ["path"],
    ),
    ws(
        "project_info",
        "Project overview",
        "Name, design resolution, languages, entry page and scene, and counts of stories, scenes, surfaces, assets, characters and variables.",
    ),
    ws(
        "project_settings_set",
        "Change project settings",
        "Changes the project's name or design resolution. Changing the resolution after the interface is built does not rescale it.",
        {
            name: { type: "string" },
            width: { type: "integer" },
            height: { type: "integer" },
        },
        [],
        true,
    ),

    // ── Assets ───────────────────────────────────────────────────────────────────────────────────
    ws(
        "assets_list",
        "List assets",
        "Lists the project's assets with id, name, type and folder. Story lines refer to images and audio by name; interface props refer to them by id.",
        {
            type: { type: "string", enum: ["image", "audio", "video", "font", "json", "text", "model"] },
            query: { type: "string", description: "Substring of the name." },
            limit: { type: "integer", default: 200 },
        },
    ),
    ws(
        "assets_import",
        "Import files",
        "Imports files from disk into the project. Paths must be inside the project or a directory the author allowed (see agent_status). Each asset is named after its file name without extension unless `names` says otherwise - pick names a story line can use (e.g. `bg_classroom_day`).",
        {
            paths: { type: "array", items: { type: "string" }, description: "Absolute file paths." },
            type: { type: "string", enum: ["image", "audio", "video", "font"], description: "Omit to infer from each extension." },
            names: { type: "array", items: { type: "string" }, description: "Optional names, one per path." },
            folder: { type: "string", description: "Asset folder name to put them in; created if missing." },
        },
        ["paths"],
        true,
    ),
    ws(
        "assets_placeholder",
        "Make a placeholder image",
        "Generates a solid-colour PNG with an optional caption and imports it as an image asset. Use it for a background or sprite the author has not supplied yet, so the game is playable end to end; tell the author which ones are placeholders.",
        {
            name: { type: "string" },
            width: { type: "integer", default: 1920 },
            height: { type: "integer", default: 1080 },
            color: { type: "string", description: "CSS colour.", default: "#40a8c4" },
            caption: { type: "string" },
            folder: { type: "string" },
        },
        ["name"],
        true,
    ),

    // ── Characters, variables, audio tracks ─────────────────────────────────────────────────────
    ws("characters_list", "List characters", "Lists characters with id, name, nicknames, name colour and poses (sprite images)."),
    ws(
        "character_upsert",
        "Create or update a character",
        "Creates a character, or updates the one with this `id` or exact `name`. Poses are sprite images already imported as assets. A line `Name: text` in a story resolves to the character with that name or nickname.",
        {
            id: { type: "string" },
            name: { type: "string" },
            nicknames: { type: "array", items: { type: "string" } },
            nameColor: { type: "string", description: "CSS colour of the name in the dialogue box." },
            poses: {
                type: "array",
                description: "Replaces the pose list. Each pose names an image asset by id or name.",
                items: {
                    type: "object",
                    properties: { name: { type: "string" }, asset: { type: "string" } },
                    required: ["name", "asset"],
                },
            },
            defaultPose: { type: "string", description: "Pose name shown when a line names none." },
        },
        [],
        true,
    ),
    ws("variables_list", "List variables", "Lists the project's global variables (saved with the game or persistent across saves)."),
    ws(
        "variable_upsert",
        "Create or update a variable",
        "Declares a global variable. `saved` belongs to one playthrough (affection, flags); `persistent` survives across saves (endings seen, gallery unlocks).",
        {
            name: { type: "string" },
            valueType: { type: "string", enum: ["number", "boolean", "string"] },
            scope: { type: "string", enum: ["saved", "persistent"], default: "saved" },
            defaultValue: { description: "Initial value, of the declared type." },
        },
        ["name", "valueType"],
        true,
    ),
    ws("audio_tracks_list", "List audio tracks", "Lists the audio tracks (Music, Sound, Voice and any custom ones) that `/bgm track=` and sound props can name."),

    // ── Story ────────────────────────────────────────────────────────────────────────────────────
    ws(
        "story_commands",
        "Story command catalogue",
        "Lists the story commands (`/bg`, `/show`, `/bgm`, `/menu`, `/if`, `/jump` …) by category, or searches them. Call `story_command` for the full parameter list before using one for the first time.",
        { query: { type: "string" }, category: { type: "string" } },
    ),
    ws("story_command", "Story command details", "Parameters, positional order, defaults and examples of one story command.", { token: { type: "string", description: "e.g. `say`, `/bg`, `menu`." } }, ["token"]),
    ws(
        "story_targets",
        "Names a story line can use",
        "Lists every name a story line can resolve: characters, images, audio, videos, audio tracks, variables, scenes, pages. A name not in this list does not resolve.",
        { query: { type: "string" } },
    ),
    ws("story_list", "List stories and scenes", "Lists stories, their chapters and scenes in order, with the entry scene marked."),
    ws(
        "story_show",
        "Read a scene as text",
        "Prints one scene in the `.story` text format, with its `revision`. Edit the text and pass it to story_apply.",
        { scene: { type: "string", description: "Scene name or id." }, story: { type: "string", description: "Story name or id; defaults to the first story." } },
        ["scene"],
    ),
    ws(
        "story_apply",
        "Write a scene",
        "Replaces the rows of the scene named in the source's `#scene` header with the rows in `source`. Rows the source does not mention are deleted. Checked first: a source with an error writes nothing. One step of undo in Studio. Write one scene per call so the author can watch it arrive.",
        { source: { type: "string", description: "A `.story` document (one scene)." }, baseRevision: BASE_REVISION, dryRun: DRY_RUN },
        ["source"],
        true,
    ),
    ws(
        "scene_create",
        "Create a scene",
        "Creates an empty scene in a story (and the story itself if `story` names none that exists). Returns its id; then write its rows with story_apply.",
        {
            name: { type: "string" },
            story: { type: "string", description: "Story name or id; defaults to the first story." },
            chapter: { type: "string", description: "Chapter name; created if missing." },
            after: { type: "string", description: "Place after this scene (name or id); defaults to the end." },
        },
        ["name"],
        true,
    ),
    ws("scene_rename", "Rename a scene", "Renames a scene. Jumps that name it follow, because they hold its id.", { scene: { type: "string" }, name: { type: "string" }, story: { type: "string" } }, ["scene", "name"], true),
    ws("scene_set_entry", "Set the entry scene", "Makes a scene the one the game starts on when the player presses Start.", { scene: { type: "string" }, story: { type: "string" } }, ["scene"], true),
    ws(
        "scene_delete",
        "Delete a scene",
        "Deletes a scene and its rows - for clearing the skeleton's demo scenes, say. Refused for the entry scene (set another first) and while any row, blueprint or page still jumps to it; the refusal lists them. One step of undo.",
        { scene: { type: "string", description: "Scene name or id." }, story: { type: "string", description: "Story name or id; defaults to the first story." } },
        ["scene"],
        true,
    ),
    ws(
        "character_delete",
        "Delete a character",
        "Deletes a character - for clearing the skeleton's demo cast, say. Refused while any story row, blueprint or page still names the character; the refusal lists where, so delete or rewrite those scenes first. One step of undo.",
        { character: { type: "string", description: "Character name or id." } },
        ["character"],
        true,
    ),

    // ── Interface ────────────────────────────────────────────────────────────────────────────────
    ws(
        "ui_widgets",
        "Widget catalogue",
        "Lists the interface widget types (`nl.button`, `nl.text`, `nl.container`, `nl.list` …) and where each may be inserted. Call `ui_widget` before using a type for the first time.",
        { insertable: { type: "boolean" }, surfaceKind: { type: "string", enum: ["appSurface", "stageSurface"] }, slot: { type: "string" } },
    ),
    ws("ui_widget", "Widget details", "Everything about one widget type: props with defaults, bindable props, parts it builds, blueprint events, commands and notes.", { type: { type: "string" } }, ["type"]),
    ws(
        "ui_usage",
        "Widget usage examples",
        "Real occurrences of a widget in the shipped skeleton (or this project), printed in the `.ui` format so they can be pasted and edited. The fastest way to learn what looks right.",
        { type: { type: "string" }, prop: { type: "string" }, limit: { type: "integer", default: 3 }, shallow: { type: "boolean" }, fromProject: { type: "boolean", description: "Search this project instead of the skeleton." } },
        ["type"],
    ),
    ws("ui_surfaces", "List pages and components", "Lists pages, game UIs (dialogue box, choice …) and components, with element paths, ids and the blueprints hanging off them.", { query: { type: "string" } }),
    ws(
        "ui_show",
        "Read a page as text",
        "Prints a page or component in the `.ui` text format, ids and props included, with its `revision`. To change something: show, edit, apply. Short by default: an element line ending in `+defaults` holds its widget's default for every prop not written (a `without` line names defaults it does not hold), and a bare key in an appearance's `propertyGroups` is a row repeating that prop. ui_apply restores both exactly, so the short text can be edited and applied as it is.",
        {
            surface: { type: "string", description: "Page name or id." },
            component: { type: "string", description: "Component name or id." },
            compact: { type: "boolean", default: true, description: "Leave out props at their default and appearance rows that repeat a prop. False prints every stored value." },
        },
    ),
    ws(
        "ui_selection",
        "What the author selected",
        "The page and elements the author has selected in the interface editor, with their props. Use it when the author says \"this\" or \"the selected one\".",
    ),
    ws(
        "ui_screenshot",
        "Look at a page",
        "Renders a page (or one element of it) as it looks in the game and returns the image. Do this after every visible change and check alignment, contrast, overlap and text overflow before moving on.",
        {
            surface: { type: "string", description: "Page name or id." },
            component: { type: "string", description: "Component name or id, instead of a page." },
            element: { type: "string", description: "Element id or path; crops to it." },
            maxSize: { type: "integer", description: "Longest edge in pixels.", default: 1280 },
        },
    ),
    ws(
        "ui_apply",
        "Write pages",
        "Applies a `.ui` document. Each `surface` or `component` block replaces that page's whole element tree - elements the block leaves out are deleted (the answer names them). Prefer ui_patch for small edits. One step of undo.",
        { source: { type: "string" }, baseRevision: BASE_REVISION, dryRun: DRY_RUN },
        ["source"],
        true,
    ),
    ws(
        "ui_patch",
        "Edit elements",
        "Small edits to one page without rewriting it: add an element, set props, move/resize, re-parent, rename, delete, place a component. All operations in one call are one step of undo. Prefer several small patches over one big apply when building a page, so the author can watch it come together.",
        {
            surface: { type: "string", description: "Page or component name or id." },
            ops: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        op: { type: "string", enum: ["add", "set", "layout", "move", "rename", "delete", "instantiate"] },
                        element: { type: "string", description: "Target element id or path (all ops but add/instantiate)." },
                        parent: { type: "string", description: "add/instantiate/move: parent element id or path." },
                        index: { type: "integer", description: "add/instantiate/move: position among the parent's children." },
                        type: { type: "string", description: "add: widget type." },
                        name: { type: "string", description: "add/rename: element name." },
                        id: { type: "string", description: "add/instantiate: explicit id to give the new element (for blueprints to refer to)." },
                        component: { type: "string", description: "instantiate: component name or id." },
                        x: { type: "number" },
                        y: { type: "number" },
                        width: { type: "number" },
                        height: { type: "number" },
                        props: { type: "object", description: "add/set: props to merge, `.ui` dotted keys allowed (`imageFill.assetId`)." },
                    },
                    required: ["op"],
                },
            },
            baseRevision: BASE_REVISION,
        },
        ["surface", "ops"],
        true,
    ),
    ws("ui_templates", "Interface templates", "Lists interface templates available to apply (title screens, dialogue boxes, menus) from Studio's template store."),
    ws("ui_template_apply", "Apply a template", "Adds a template's pages to the project.", { template: { type: "string", description: "Template id from ui_templates." } }, ["template"], true),
    ws("brand_get", "Read the palette", "The project's brand palette and fonts. Interface props should refer to palette entries as `nlbrand:<id>` rather than raw colours, so one change restyles the game."),
    ws(
        "brand_set",
        "Change the palette",
        "Sets palette colours (by id; new ids are added) and the project font stack. Every element that refers to an entry changes with it.",
        {
            colors: { type: "object", additionalProperties: { type: "string" }, description: "id → CSS colour." },
            fonts: { type: "array", items: { type: "string" }, description: "Font asset ids or names, first preferred." },
        },
        [],
        true,
    ),

    // ── Blueprints ───────────────────────────────────────────────────────────────────────────────
    ws(
        "blueprint_nodes",
        "Blueprint node catalogue",
        "Searches blueprint nodes (including those of plugins loaded in this project). Call blueprint_node for pins before using one.",
        { query: { type: "string" }, category: { type: "string" }, owner: { type: "string" }, widget: { type: "string" }, limit: { type: "integer", default: 60 } },
    ),
    ws("blueprint_node", "Blueprint node details", "Pins, inspector params, graph kinds and scope of one node type.", { type: { type: "string" } }, ["type"]),
    ws("blueprint_list", "List blueprints", "Lists blueprints with their owner (surface/element) and event heads.", { query: { type: "string" } }),
    ws("blueprint_show", "Read a blueprint as text", "Prints one blueprint (or all of one owner) in the `.bp` text format.", { blueprint: { type: "string", description: "Blueprint name or id." } }, ["blueprint"]),
    ws(
        "blueprint_apply",
        "Write blueprints",
        "Applies a `.bp` document: each `blueprint` block replaces every graph of its owner. One step of undo.",
        { source: { type: "string" }, dryRun: DRY_RUN },
        ["source"],
        true,
    ),

    // ── Verify and ship ──────────────────────────────────────────────────────────────────────────
    ws("lint", "Check the project", "Runs every project lint rule and returns the findings, errors first. Fix every error before a build.", { severity: { type: "string", enum: ["error", "warning", "info"], default: "warning" } }),
    main(
        "test",
        "Run a project test",
        "Runs a built-in test headlessly: `narraleaf-studio:route-coverage` (every scene reachable), `narraleaf-studio:reachable-endings`, `narraleaf-studio:project-diagnostics`.",
        { project: PROJECT_ARG, id: { type: "string" } },
        ["id"],
    ),
    ws(
        "playtest_start",
        "Play the game",
        "Opens the game in Dev Mode, from the start or from a scene (and row). The author sees it too. Then use playtest_advance and playtest_screenshot.",
        { scene: { type: "string" }, row: { type: "integer", description: "1-based row in the scene." } },
    ),
    ws("playtest_advance", "Advance the game", "Clicks through `steps` lines of dialogue (or picks `choice` when a menu is showing).", { steps: { type: "integer", default: 1 }, choice: { type: "integer", description: "1-based option to pick." } }),
    ws("playtest_screenshot", "Look at the game", "Screenshot of the running Dev Mode game.", { maxSize: { type: "integer", default: 1280 } }),
    ws("playtest_stop", "Stop playing", "Closes the Dev Mode game."),
    ws("console_read", "Read Studio's console", "Recent lines from Studio's console (build, story, blueprint, runtime channels).", { channel: { type: "string" }, level: { type: "string", enum: ["debug", "info", "warning", "error"] }, limit: { type: "integer", default: 100 } }),
    main(
        "build",
        "Build the game",
        "Builds a playable package of the project. Runs the same pipeline as Studio's Build menu. Returns the output directory.",
        {
            project: PROJECT_ARG,
            target: { type: "string", enum: ["current", "windows", "macos", "linux", "web"], default: "current" },
            output: { type: "string", description: "Absolute output directory; defaults to the project's build directory." },
        },
        [],
        true,
    ),
];

export const AGENT_TOOLS_BY_NAME: ReadonlyMap<string, AgentToolDescriptor> = new Map(AGENT_TOOLS.map(tool => [tool.name, tool]));

export function agentToolsForSide(side: AgentToolSide): AgentToolDescriptor[] {
    return AGENT_TOOLS.filter(tool => tool.side === side);
}

export const AGENT_GUIDE_CHAPTERS = [
    "workflow",
    "story-format",
    "ui-format",
    "blueprint-format",
    "ui-design",
    "script-adaptation",
    "verify-and-ship",
    "troubleshooting",
] as const;
export type AgentGuideChapter = (typeof AGENT_GUIDE_CHAPTERS)[number];
