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

/** A character's entrance defaults, as the layered character tools take them (see character_upsert). */
const LAYERED_ENTRANCE: AgentJsonSchema = {
    description:
        "Entrance defaults, as on character_upsert: `\"standing\"` fits them to the canvas (feet on the bottom edge), null clears them, an object `{ zoom, scaleX, scaleY, position: { xalign, yalign, xoffset, yoffset } }` replaces them. A new character, or one whose canvas changed, gets a standing entrance when it has none.",
    oneOf: [
        { type: "string", enum: ["standing"] },
        { type: "null" },
        { type: "object" },
    ],
};

const CONFIRM_SWITCH: AgentJsonSchema = {
    type: "boolean",
    description:
        "Required to turn a character of another kind (preset poses, or a Live2D/Spine model) into this one. The switch DISCARDS its current looks - nothing is converted - and the story rows that chose one fall back to the default; call without it first to read which rows.",
    default: false,
};

/** Image assets named `<prefix>_<layer>` / `<prefix>_<layer>_<tag>`, read by character_layers_import. */
const LAYER_IMPORT_SOURCE = {
    prefix: { type: "string", description: "What every file name starts with; defaults to the character's name." },
    assets: { type: "array", items: { type: "string" }, description: "Image assets (names or ids) to build from. Default: every image named `<prefix>_…`." },
    folder: { type: "string", description: "Take the images from this asset-library folder instead." },
    psd: { type: "string", description: "Absolute path of a .psd/.psb (inside the project or an allowed directory) to build from instead of images: each top-level group of 2+ layers becomes an axis (its layers the tags), every other layer a fixed layer; layers are baked full-canvas and imported as assets." },
    blendModes: {
        type: "object",
        additionalProperties: { type: "string", enum: ["merge", "skip"] },
        description: "PSD only: for each layer whose blend mode the stage cannot draw (multiply, screen, ...), keyed `\"<group>/<layer>\"`: merge it onto the layer below, or skip it. The refusal lists the ones to decide.",
    },
    order: { type: "array", items: { type: "string" }, description: "Images only: every layer name, bottom to top. Required with more than one layer - stacking cannot be read off file names." },
    axes: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string" } },
        description: "Images only: axis name -> the layers it drives, e.g. `{ \"expression\": [\"brows\", \"eyes\", \"mouth\"] }`. A varying layer not listed follows an axis of its own name.",
    },
    defaults: { type: "object", additionalProperties: { type: "string" }, description: "Images only: axis name -> default tag. Otherwise `normal`/`default`/`neutral` if present, else the first." },
} satisfies Record<string, AgentJsonSchema>;

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
        "Returns one chapter of the NarraLeaf game-making guide as Markdown: `workflow` (the end-to-end order of work - read it before starting a game), `story-format`, `ui-format`, `blueprint-format`, `ui-design`, `script-adaptation`, `layered-sprites` (characters built from layer images: axes, layers, /char), `verify-and-ship`, `localization-and-voice` (translating the game and wiring voice-over), `troubleshooting`. A plugin that offers its own tools may ship a chapter too, named `plugin:<pluginId>` (`plugin:narraleaf.gallery` for the Gallery's EXTRA page). Without a chapter, lists every chapter there is. The same text is served as MCP resources `narraleaf://guide/<chapter>` and `narraleaf://guide/plugin/<pluginId>`.",
        {
            chapter: {
                type: "string",
                description: "A chapter id from the list above, or `plugin:<pluginId>`. Leave it out to list the chapters.",
            },
        },
    ),

    main(
        "request_folder_access",
        "Ask for folder access",
        "Asks the author, in one Studio dialog, to let you read files outside the project - call it before a big import from the author's own folders (asset packs, recordings, a PSD) so the import does not stop to ask. Pass the files or folders you will read; Studio asks for the folders that hold them (at most 5 per dialog; a file-system root, the home folder itself and Studio's own folders are never allowed). Answers `granted`, `denied` and `pending` (the author has not answered yet - call again later; do not repeat a denied request). Folders already allowed come back granted at once; agent_status lists them. Under the author's Full access setting every other folder is granted without a dialog.",
        {
            paths: { type: "array", items: { type: "string" }, description: "Absolute paths of the files or folders you will read." },
            reason: { type: "string", description: "One sentence on what you will do with them; shown in the dialog as your stated purpose." },
            project: PROJECT_ARG,
        },
        ["paths"],
    ),

    // ── Projects ─────────────────────────────────────────────────────────────────────────────────
    main(
        "project_create",
        "Create a project",
        "Creates a new NarraLeaf project from a template and opens it in Studio. Use the `skeleton` template for a game: it ships a title page, dialogue box, save/load, settings and history that work out of the box, which you then restyle. `dir` is the PARENT directory: the project folder is created inside it, named after a lower-case ASCII slug of `name` (末班车 becomes `mo-ban-che`); the result gives the full path. The skeleton's pages, scenes, variables and folders are named in `language`. The game carries `language` only, plus any `languages` you list (the skeleton's sample translations of other languages are not kept).",
        {
            name: { type: "string", description: "Project (and game) name." },
            dir: { type: "string", description: "Absolute PARENT directory; the project folder is created inside it. Defaults to Studio's default projects directory." },
            template: { type: "string", enum: ["skeleton", "empty"], default: "skeleton" },
            language: { type: "string", description: "Source language of the game text, e.g. `zh-CN`, `en`, `ja`.", default: "en" },
            languages: { type: "array", items: { type: "string" }, description: "Further languages the game offers, untranslated at first. Defaults to none; project_settings_set can add or remove languages later." },
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
        "Changes the project's name, design resolution or game languages. Changing the resolution after the interface is built does not rescale it. `languages` is the full list the game offers (the source language must be in it); a language that holds translations is dropped only when `removeLanguages` names it, and its translation file stays on disk. Translate with localization_list / localization_set; voice-over languages are separate (voice_settings_set).",
        {
            name: { type: "string" },
            width: { type: "integer" },
            height: { type: "integer" },
            languages: { type: "array", items: { type: "string" }, description: "Every language the game offers, e.g. `[\"zh-CN\", \"en\"]`. Languages not listed and holding no translations are removed; new ones are added untranslated." },
            removeLanguages: { type: "array", items: { type: "string" }, description: "Languages to drop even though they hold translations. Never the source language." },
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
        "Imports files from disk into the project. Paths must be absolute. A path outside the project and the folders the author allowed (see agent_status) makes Studio ask the author for its folder first; for a big import, call request_folder_access up front. Each asset is named after its file name without extension unless `names` says otherwise - pick names a story line can use (e.g. `bg_classroom_day`). `warnings` flags a portrait-shaped image with no transparency: as a sprite it would show as a rectangle.",
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
        "asset_delete",
        "Delete an asset",
        "Deletes an asset from the project - for clearing the skeleton's leftover demo pictures and music once nothing uses them, say. Refused while anything still refers to it (a story row, a scene's `#background`/`#music`, a character pose, a page or blueprint); the refusal lists where. One step of undo; the file goes to the project's recycle bin.",
        {
            asset: { type: "string", description: "Asset name or id (assets_list)." },
            type: { type: "string", enum: ["image", "audio", "video", "font", "json", "model", "other"], description: "Only needed when two assets of different types share the name." },
        },
        ["asset"],
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
    ws(
        "characters_list",
        "List characters",
        "Lists characters with id, name, nicknames, name colour, `kind` and their looks: a `preset` character's `poses` (one sprite image each); a `layered` character's `layered` block (canvas, axes with their tags and default, and the layer stack bottom to top with what each layer draws per tag - the exact shape character_layered_set takes, so edit it and send it back); a `live2d`/`spine`/`puppet` character's model (read-only: those are set up in Studio). Also `entranceTransform` (how big the sprite is drawn and where it stands). `spriteSize` is the default look's pixels (a layered character's canvas) and `drawnAtCenter` the box it occupies on a `/show <name> pos=center` row, in design pixels from the stage's top-left - check it instead of guessing from a screenshot.",
    ),
    ws(
        "character_upsert",
        "Create or update a character",
        "Creates a character, or updates the one with this `id` or exact `name`. Poses are sprite images already imported as assets. A line `Name: text` in a story resolves to the character with that name or nickname. A sprite is drawn at its own pixel size times `zoom`, its centre placed by `position`; a character that gets poses and has no `entranceTransform` yet is given a standing one (feet on the bottom edge, own pixel size, scaled down only if taller than the stage). A reused character keeps the entrance its old art was tuned for - the answer warns; pass `entranceTransform: \"standing\"` to refit. Warns when a pose image has no transparency. Name, colour, nicknames and entrance work on a layered character too; its looks are written with character_layered_set. One step of undo.",
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
            confirmSwitch: CONFIRM_SWITCH,
            entranceTransform: {
                description:
                    "What every entrance (`/show`) falls back to - the Entrance section of the character panel. `\"standing\"` fits it to the default pose (feet on the bottom edge); null clears it; an object replaces it. `position` places the sprite's CENTRE: `xalign`/`yalign` are shares of the stage from the left and up from the bottom, `xoffset`/`yoffset` design pixels (+ is up). `pos=left|center|right` on a row writes `xalign` and `yalign: 0.5`, so set the baseline with `yoffset` (drawn height / 2 - stage height / 2), not `yalign`. `scaleX: -1` mirrors.",
                oneOf: [
                    { type: "string", enum: ["standing"] },
                    { type: "null" },
                    {
                        type: "object",
                        properties: {
                            zoom: { type: "number", description: "Multiplies the sprite's pixel size; 1 = drawn at its own pixels." },
                            scaleX: { type: "number" },
                            scaleY: { type: "number" },
                            position: {
                                type: "object",
                                properties: { xalign: { type: "number" }, yalign: { type: "number" }, xoffset: { type: "number" }, yoffset: { type: "number" } },
                                additionalProperties: false,
                            },
                        },
                        additionalProperties: false,
                    },
                ],
            },
        },
        [],
        true,
    ),
    ws(
        "character_layered_set",
        "Lay out a layered character",
        "Creates a layered character, or replaces the looks of one (by `character` name or id): its AXES - named choices such as expression (normal/smile/angry) or outfit (school/casual) - and its LAYERS, the image stack bottom to top. A layer either always draws one `asset`, or follows one `axis` and gives `options`: an image per tag of that axis, `null` where it draws nothing for that tag (a jacket only the casual outfit has). Every tag of the axis must appear in each layer that follows it. One axis may drive several layers (expression moves brows, eyes and mouth together). Images are assets already imported, all the SAME pixel size (the canvas - each layer is drawn centred at its own size, so a cropped part would land off-register; refused with the sizes). Tag names must be unique across the character's axes, because a story row names a tag alone: `/char Mei smile` changes the expression and keeps the outfit, `/show Mei casual` shows her with every other axis at its default. Restating keeps the ids of every axis, tag and layer whose name is unchanged, so existing rows keep their looks; a removed tag is reported with the rows that chose it. Checked like Studio's character editor (a look that draws nothing is an error). One step of undo. Read the `layered-sprites` guide chapter first.",
        {
            character: { type: "string", description: "Character name or id. Created (as layered) when there is none." },
            axes: {
                type: "array",
                description: "The axes, each with its tags in order; `default` is the tag a /show uses when the row names none (first tag otherwise).",
                items: {
                    type: "object",
                    properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } }, default: { type: "string" } },
                    required: ["name", "tags"],
                    additionalProperties: false,
                },
            },
            layers: {
                type: "array",
                description: "Bottom to top. `{ name, asset }` for a layer that always draws, `{ name, axis, options: { <tag>: <image or null> } }` for one that follows an axis.",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        axis: { oneOf: [{ type: "string" }, { type: "null" }] },
                        asset: { oneOf: [{ type: "string" }, { type: "null" }] },
                        options: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "null" }] } },
                    },
                    required: ["name"],
                    additionalProperties: false,
                },
            },
            entranceTransform: LAYERED_ENTRANCE,
            confirmSwitch: CONFIRM_SWITCH,
            dryRun: DRY_RUN,
        },
        ["character", "axes", "layers"],
        true,
    ),
    ws(
        "character_layers_import",
        "Build a layered character from files",
        "Builds a layered character's stack from image assets named by convention - `<prefix>_<layer>` for a layer that always draws, `<prefix>_<layer>_<tag>` for one tag of a varying layer (e.g. mei_body, mei_eyes_smile, mei_mouth_smile, mei_outfit_casual; a layer name has no `_`, use `back-hair`) - or from a PSD (top-level groups become axes). Then writes it exactly as character_layered_set would (same checks, one step of undo); the answer includes the derived stack, which you can adjust and send to character_layered_set. With images, state the stacking `order` (bottom to top) and group layers that change together into one axis with `axes`. Import the files with assets_import first, naming them by the convention.",
        {
            character: { type: "string", description: "Character name or id. Created (as layered) when there is none." },
            ...LAYER_IMPORT_SOURCE,
            entranceTransform: LAYERED_ENTRANCE,
            confirmSwitch: CONFIRM_SWITCH,
            dryRun: DRY_RUN,
        },
        ["character"],
        true,
    ),
    ws(
        "character_preview",
        "Look at a character",
        "Returns a picture of one of a character's looks, composited the way Studio's editor draws it (the sprite alone, transparent around it, not placed on the stage). For a layered character pass `look`: `{ \"expression\": \"smile\", \"outfit\": \"casual\" }` or a tag list `[\"smile\", \"casual\"]`; axes you leave out take their default. For a preset character pass `pose`. Use it to check a combination before writing scenes that use it. Live2D/Spine characters only render in the running game (playtest_screenshot).",
        {
            character: { type: "string", description: "Character name or id." },
            look: {
                oneOf: [
                    { type: "object", additionalProperties: { type: "string" } },
                    { type: "array", items: { type: "string" } },
                ],
                description: "Layered: axis -> tag, or a list of tag names.",
            },
            pose: { type: "string", description: "Preset: the pose to show; defaults to the default pose." },
            maxSize: { type: "integer", minimum: 64, maximum: 2048, default: 768, description: "Longest edge of the picture, in pixels." },
        },
        ["character"],
    ),
    ws("variables_list", "List variables", "Lists the project's global variables (saved with the game or persistent across saves)."),
    ws(
        "variable_upsert",
        "Create or update a variable",
        "Declares a global variable, or updates one: by `id` (the way to rename one - rows and nodes hold the id, so they follow) or by exact `name`. `name` and `valueType` are required only to create. `saved` belongs to one playthrough (affection, flags); `persistent` survives across saves (endings seen, gallery unlocks); the scope cannot change later. One step of undo.",
        {
            id: { type: "string", description: "The variable to update or rename (variables_list)." },
            name: { type: "string", description: "Name to create under, or the new name when `id` is given." },
            valueType: { type: "string", enum: ["number", "boolean", "string"] },
            scope: { type: "string", enum: ["saved", "persistent"], default: "saved" },
            defaultValue: { description: "Initial value, of the declared type." },
            description: { type: "string", description: "Note shown in the Variables panel; \"\" clears it." },
        },
        [],
        true,
    ),
    ws(
        "variable_delete",
        "Delete a variable",
        "Deletes a global variable - for clearing the skeleton's demo variables, say. Refused while any story row, blueprint or page still uses it; the refusal lists where, so rewrite those first (or rename it with variable_upsert instead). One step of undo.",
        { variable: { type: "string", description: "Variable name or id." } },
        ["variable"],
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
        "Lists every name a story line can resolve: characters, images, audio, videos, audio tracks, variables, scenes, pages - and, under \"scene settings\", the background and music each scene opens on (`#background` / `#music`), which no row names. A name not in this list does not resolve.",
        { query: { type: "string" } },
    ),
    ws("story_list", "List stories and scenes", "Lists stories, their chapters and scenes in order, with the entry scene marked."),
    ws(
        "story_show",
        "Read a scene as text",
        "Prints one scene in the `.story` text format, with its `revision`. The header names the scene's own settings - `#background` (the image it opens on before its first row) and `#music` - or `none`. Edit the text and pass it to story_apply.",
        { scene: { type: "string", description: "Scene name or id." }, story: { type: "string", description: "Story name or id; defaults to the first story." } },
        ["scene"],
    ),
    ws(
        "story_apply",
        "Write a scene",
        "Replaces the rows of the scene named in the source's `#scene` header with the rows in `source`. Rows the source does not mention are deleted. The scene's own settings change only when the header states them: `#background none` / `#music none` clear them (do this when reusing a skeleton demo scene, or its old picture shows before your first /bg), and a header without them keeps them - the answer says what the scene still opens with. Checked first: a source with an error writes nothing. One step of undo in Studio. Write one scene per call so the author can watch it arrive.",
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
    ws("scene_rename", "Rename a scene", "Renames a scene. Jumps that name it follow, because they hold its id. A rename changes the scene's revision; the result returns the new one for story_apply's baseRevision.", { scene: { type: "string" }, name: { type: "string" }, story: { type: "string" } }, ["scene", "name"], true),
    ws(
        "story_rename",
        "Rename a story",
        "Renames a story - the skeleton's is called \"Skeleton\", which the author sees in Studio's story list. Nothing refers to a story by its name, so nothing else changes. One step of undo.",
        { story: { type: "string", description: "Story name or id; defaults to the first story." }, name: { type: "string" } },
        ["name"],
        true,
    ),
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
        "Renders a page (or one element of it) as it looks in the game and returns the image. Do this after every visible change and check alignment, contrast, overlap and text overflow before moving on. Elements are drawn at rest; pass `element` with `state: \"hovered\"` or `\"active\"` to see a button's hover or pressed look.",
        {
            surface: { type: "string", description: "Page name or id." },
            component: { type: "string", description: "Component name or id, instead of a page." },
            element: { type: "string", description: "Element id or path; crops to it." },
            state: {
                type: "string",
                enum: ["hovered", "active", "focused", "selected", "disabled"],
                description: "Draw `element` (and what is inside it) as it looks in this state - `hovered` under the pointer, `active` pressed - to check its hover and pressed looks. Needs `element`.",
            },
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
        "Small edits to one page without rewriting it: add an element, set props, move/resize, re-parent, rename, delete, place a component. All operations in one call are one step of undo, and all or nothing: an operation that would change nothing (a prop the widget does not know, a value already held) refuses the whole call, so \"Applied N operation(s)\" means N real changes. Hide an element with `set` `{\"layout.visible\": false}`. Prefer several small patches over one big apply when building a page, so the author can watch it come together.",
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
                        props: {
                            type: "object",
                            description:
                                "add/set: props to merge, `.ui` dotted keys allowed (`imageFill.assetId`). As in the `.ui` format the first segment picks the bag: `layout.visible`/`layout.opacity`/`layout.rotation` (or `{\"layout\": {\"visible\": false}}`) write the element's layout, `style.*` its CSS overrides, `extra.*` its extra record; every other key is a widget prop and must be one the widget knows (ui_widget lists them).",
                        },
                    },
                    required: ["op"],
                },
            },
            baseRevision: BASE_REVISION,
            dryRun: DRY_RUN,
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
    ws(
        "blueprint_show",
        "Read a blueprint as text",
        "Prints one blueprint (or all of one owner) in the `.bp` text format, with each blueprint's `revision`. Blueprint names are in the project's language (the skeleton's title Start button's is `开始` in a Chinese project), so find one by its owner: ui_show prints `# blueprint: <name>` after the element that owns it, and an owner key `widgetMain:<surfaceId>:<elementId>` shows all of that element's blueprints.",
        { blueprint: { type: "string", description: "Blueprint name or id, or an owner key `widgetMain:<surfaceId>:<elementId>`." } },
        ["blueprint"],
    ),
    ws(
        "blueprint_apply",
        "Write blueprints",
        "Applies a `.bp` document: each `blueprint` block replaces every graph of its owner. One step of undo in that blueprint's editor (each blueprint's, when the source holds several).",
        {
            source: { type: "string" },
            baseRevision: {
                type: "integer",
                description:
                    "The `revision` blueprint_show returned for the blueprint. The write is refused with `stale_revision` if the author changed it since then. One revision covers one blueprint: apply one block per call to use it.",
            },
            dryRun: DRY_RUN,
        },
        ["source"],
        true,
    ),

    // ── Translation and voice ───────────────────────────────────────────────────────────────────
    ws(
        "localization_status",
        "Translation progress",
        "How far each target language is translated: per language, `done` / `reviewed` / `translated` / `machine` / `stale` (translated before the source line changed) / `missing`, split by origin - `story` (scene lines), `names` (character, scene, ending and /rename names), `interface` (words on pages and components), `keys` (named translation keys), `plugins`. With `language`, also each scene's lines left to do - plan the work scene by scene from it. The game's languages themselves are set with project_settings_set.",
        { language: { type: "string", description: "One target language for a per-scene breakdown, e.g. `en`." } },
    ),
    ws(
        "localization_list",
        "List text to translate",
        "Lists translation units of one target language in reading order, a page at a time: each with its `id`, `kind`, `where` (scene and row, page and element, key), `speaker`, `source`, current `target`, `status`, translator `note` and `rev`. One id runs through story lines, interface words and keys, so they are all listed and written the same way. Work a scene at a time (`scene` + `status: \"todo\"`), a few hundred units per call, and follow `nextCursor` until it is null. `source` shows run tags (`‹1›word‹/1›` styled span, `‹2/›` pause or event) and `{0}` values where the line has them - the translation must carry them too.",
        {
            language: { type: "string", description: "Target language code (not the source language)." },
            origin: { type: "string", enum: ["story", "names", "interface", "keys", "plugins"], description: "Only units of this origin." },
            story: { type: "string", description: "Story name or id." },
            scene: { type: "string", description: "Scene name or id: its lines and its own scene, ending and /rename names." },
            page: { type: "string", description: "Page or component name: only its interface words." },
            status: {
                type: "string",
                enum: ["missing", "stale", "machine", "translated", "reviewed", "todo", "unreviewed"],
                description: "`todo` = missing or stale (still needs a translation); `unreviewed` = machine or translated.",
            },
            query: { type: "string", description: "Substring of the source or the translation." },
            cursor: { type: "string", description: "`nextCursor` from the previous page." },
            limit: { type: "integer", default: 200, minimum: 1, maximum: 500 },
        },
        ["language"],
    ),
    ws(
        "localization_set",
        "Write translations",
        "Writes translations of one target language: `entries` is `[{unitId, target, status?, note?, rev?}]`, up to 1000 per call - a scene or a few hundred lines at a time, so the author can watch the table fill. The whole call is one step of undo. `status` defaults to `machine` (an agent's translation, for the author to review); pass `translated` when the author asked for final text, `reviewed` only when they said they reviewed it. `target: \"\"` clears a translation. Pass each unit's `rev` from localization_list: a unit whose source changed since is skipped and returned with its new source. Unknown unit ids refuse the whole call; the source language is refused. Lost `{n}` values, run tags, `{name}` placeholders or line breaks are written but warned about - fix and resend those.",
        {
            language: { type: "string", description: "Target language code." },
            entries: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        unitId: { type: "string" },
                        target: { type: "string", description: "The translation; \"\" clears it." },
                        status: { type: "string", enum: ["machine", "translated", "reviewed"] },
                        note: { type: "string", description: "Translator note shown in the table; \"\" clears it." },
                        rev: { type: "string", description: "The unit's `rev` from localization_list." },
                    },
                    required: ["unitId", "target"],
                },
            },
            dryRun: DRY_RUN,
        },
        ["language", "entries"],
        true,
    ),
    ws(
        "voice_status",
        "Voice-over progress",
        "The game's voice languages (separate from its text languages), the recording file-name rule (`namingPattern`, explained, with an example), whether choice options are voiced, and per language and per character how many lines have a take (`covered`, `approved`, `stale` - the line changed after its take was linked - and `missing`). Studio never records: a line is voiced by linking an imported audio asset to it.",
        { language: { type: "string", description: "Only this voice language." } },
    ),
    ws(
        "voice_list",
        "List voiced lines",
        "Lists the voiced lines of one voice language in story order, a page at a time: each with its `id`, `where`, `speaker`, `text` (the line as the actor of that language reads it - its translation when there is one), `expect` (the file name the recording rule gives it), linked `take` (asset id and name), `status` and director's `note`. `unlinkedOnly` lists the gaps after voice_auto_link.",
        {
            language: { type: "string", description: "Voice language code." },
            story: { type: "string" },
            scene: { type: "string", description: "Scene name or id." },
            character: { type: "string", description: "Character name or id, or the narration label." },
            status: { type: "string", enum: ["missing", "linked", "approved", "stale", "todo"], description: "`todo` = missing or stale." },
            unlinkedOnly: { type: "boolean", description: "Only lines with no take." },
            query: { type: "string", description: "Substring of the line or its expected file name." },
            cursor: { type: "string", description: "`nextCursor` from the previous page." },
            limit: { type: "integer", default: 200, minimum: 1, maximum: 500 },
        },
        ["language"],
    ),
    ws(
        "voice_link",
        "Link voice takes",
        "Links audio assets to voiced lines of one voice language, for the lines voice_auto_link could not match: `links` is `[{unitId, asset?, status?, note?}]`. `asset` is an audio asset's id or library name (import files with assets_import first); `\"\"` unlinks. Without `asset`, `status: \"approved\"` signs off the take the line already has - approve only when the author says so. A new take starts `linked`. The whole call is one step of undo; a line id or asset that does not resolve refuses the whole call and lists them.",
        {
            language: { type: "string", description: "Voice language code." },
            links: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        unitId: { type: "string", description: "Line id from voice_list." },
                        asset: { type: "string", description: "Audio asset id or name; \"\" unlinks." },
                        status: { type: "string", enum: ["linked", "approved"] },
                        note: { type: "string", description: "Director's note; \"\" clears it." },
                    },
                    required: ["unitId"],
                },
            },
            dryRun: DRY_RUN,
        },
        ["language", "links"],
        true,
    ),
    ws(
        "voice_auto_link",
        "Link takes by name",
        "Links every voiced line to the audio asset named after it by the recording rule - the matching the Voice panel's audio import and the voice table's Assign use: names compared ignoring case, spaces, punctuation and folders, against each asset's library name. A name several assets or several lines share is never guessed at: it is returned as `ambiguous`. Lines that already have a different take are left alone unless `relink`. Returns what linked, what was ambiguous, the lines still `missing` with their expected names, and the assets that matched no line. One step of undo. Typical flow: assets_import the recordings into a folder, voice_auto_link with that folder (dryRun first), then voice_list {unlinkedOnly} and voice_link the rest.",
        {
            language: { type: "string", description: "Voice language code." },
            assetFolder: { type: "string", description: "Only audio assets in this asset folder (or folders inside it)." },
            assetQuery: { type: "string", description: "Only audio assets whose name contains this." },
            story: { type: "string" },
            scene: { type: "string", description: "Only lines of this scene." },
            relink: { type: "boolean", default: false, description: "Replace a take a line already has when another asset carries its name." },
            status: { type: "string", enum: ["linked", "approved"], default: "linked" },
            dryRun: DRY_RUN,
        },
        ["language"],
        true,
    ),
    ws(
        "voice_settings_set",
        "Change voice settings",
        "Sets the game's voice languages, the recording file-name rule and whether choice options are voiced. `languages` is the full list of voice languages - independent of the text languages (a game may be dubbed in Japanese and read in English); a language that holds takes is dropped only when `removeLanguages` names it, and its take file stays on disk. `namingPattern` uses `{scene}`, `{index}`, `{character}`, `{locale}`, `{unit}`; change it before the booth records, since files are matched by it. One step of undo.",
        {
            languages: { type: "array", items: { type: "string" }, description: "Every voice language, e.g. `[\"ja\"]`." },
            removeLanguages: { type: "array", items: { type: "string" }, description: "Voice languages to drop even though they hold takes." },
            namingPattern: { type: "string", description: "Default `{scene}_{index}_{character}`." },
            voiceChoices: { type: "boolean", description: "Whether choice options are lines an actor records." },
        },
        [],
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
        "Opens the game in Dev Mode, from the title page or from a scene (and row). The author sees it too. From a scene it returns once the first line is shown in full (or a menu is up), and says what it is (speaker and text). Then use playtest_advance and playtest_screenshot.",
        { scene: { type: "string" }, row: { type: "integer", description: "1-based row in the scene." } },
    ),
    ws(
        "playtest_advance",
        "Advance the game",
        "Reads on `steps` lines of a running story. One step is one line: a click on the line shown in full, then a wait until the game is at rest again - on the next line, finished typing (rows without a line, such as /show or /sound, are not steps), a menu, or out of the story. So the answer names exactly what is on screen, and a screenshot taken next shows that whole line. Stops early at a choice menu, at an ending (names it, and the page the game went to: the title or an ending page), or when a click does not move the game; says why. With `choice`, picks that option first (counts as one step). Does nothing on the title page: start from a scene.",
        {
            steps: { type: "integer", default: 1, description: "Lines to read on, 1-50." },
            choice: { type: "integer", description: "1-based option of the menu showing, in the order shown (hidden options are not counted)." },
        },
    ),
    ws("playtest_screenshot", "Look at the game", "Screenshot of the running Dev Mode game: the stage with its Game UI, or the window when a page such as the title is showing. Fails within about 10 s, saying why, when the game cannot be captured.", { maxSize: { type: "integer", default: 1280 } }),
    ws("playtest_stop", "Stop playing", "Closes the Dev Mode game."),
    ws("console_read", "Read Studio's console", "Recent lines from Studio's console (build, story, blueprint, runtime channels).", { channel: { type: "string" }, level: { type: "string", enum: ["debug", "info", "warning", "error"] }, limit: { type: "integer", default: 100 } }),
    main(
        "build",
        "Build the game",
        "Builds a playable package of the project. Runs the same pipeline as Studio's Build menu. Returns the output directory and, in `artifacts`, what was built (the `.app` bundle, installer or app folder) - the thing to open.",
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
    "layered-sprites",
    "verify-and-ship",
    "localization-and-voice",
    "troubleshooting",
] as const;
export type AgentGuideChapter = (typeof AGENT_GUIDE_CHAPTERS)[number];
