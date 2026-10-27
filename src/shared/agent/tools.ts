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
    /**
     * Acts in the running game the way a player does - starts it, reads on, clicks, presses keys,
     * closes it. Not a write (the project does not change, and the writes switch does not cover it),
     * but refused while the author has paused agents: a player's press can do anything the game
     * offers, deleting a save included, and a pause means the agent stops acting. Reads of the game
     * - a screenshot - are not marked and go on working while paused.
     */
    drivesGame?: boolean;
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

/** A workspace tool that drives the running game; see {@link AgentToolDescriptor.drivesGame}. */
function drivesGame(tool: AgentToolDescriptor): AgentToolDescriptor {
    return { ...tool, drivesGame: true };
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
        "Creates a new NarraLeaf project from a template and opens it in Studio. Use the `skeleton` template for a game: it ships a title page, dialogue box, save/load, settings and history that work out of the box, which you then restyle. The skeleton is laid out for 1920x1080 only and refuses another size; for another size use the `empty` template. `dir` is the PARENT directory: the project folder is created inside it, named after the project's app ID; the result gives the full path and the ID. The app ID identifies the released game on players' devices and cannot be changed once the project exists: by default it is a lower-case ASCII slug of `name` (末班车 becomes `mo-ban-che`), led by the author line Studio was set up with when there is one, and numbered (`-2`) when a project on this machine already uses it. Pass `appId` to choose it instead; one another project on this machine uses is refused. The skeleton's pages, scenes, variables and folders are named in `language`. The game carries `language` only, plus any `languages` you list (the skeleton's sample translations of other languages are not kept).",
        {
            name: { type: "string", description: "Project (and game) name." },
            dir: { type: "string", description: "Absolute PARENT directory; the project folder is created inside it. Defaults to Studio's default projects directory." },
            template: { type: "string", enum: ["skeleton", "empty"], default: "skeleton" },
            language: { type: "string", description: "Source language of the game text, e.g. `zh-CN`, `en`, `ja`.", default: "en" },
            languages: { type: "array", items: { type: "string" }, description: "Further languages the game offers, untranslated at first. Defaults to none; project_settings_set can add or remove languages later." },
            width: { type: "integer", description: "Design width in pixels.", default: 1920 },
            height: { type: "integer", description: "Design height in pixels.", default: 1080 },
            appId: { type: "string", description: "App ID: lower-case letters, digits and hyphens (`my-game`), or a reverse-domain ID (`com.studio.game`). Permanent. Leave out to have one suggested." },
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
        "Name, design resolution, languages, entry page and scene, the player defaults (starting text speed, auto-forward delay, volumes, skipping), and counts of stories, scenes, surfaces, assets, characters and variables.",
    ),
    ws(
        "project_settings_set",
        "Change project settings",
        "Changes the project's name, design resolution or game languages. Changing the resolution after the interface is built does not rescale it. `languages` is the full list the game offers (the source language must be in it); a language that holds translations is dropped only when `removeLanguages` names it, and its translation file stays on disk. Translate with localization_list / localization_set; voice-over languages are separate (voice_settings_set). `playerDefaults` sets what a new player's settings start at (Studio's Project → Game page); a player's saved settings keep theirs.",
        {
            name: { type: "string" },
            width: { type: "integer" },
            height: { type: "integer" },
            languages: { type: "array", items: { type: "string" }, description: "Every language the game offers, e.g. `[\"zh-CN\", \"en\"]`. Languages not listed and holding no translations are removed; new ones are added untranslated." },
            removeLanguages: { type: "array", items: { type: "string" }, description: "Languages to drop even though they hold translations. Never the source language." },
            playerDefaults: {
                type: "object",
                description: "Merged into the starting preferences; keys left out keep their value. `cps` text speed in characters per second (1-200; 200 is as near instant as the engine types), `textRevealDuration` fade per character in ms (0-500), `autoForward` (bool) and `autoForwardDelay` ms after a line (0-30000), `gameSpeed` (0.1-10), `globalVolume`/`bgmVolume`/`soundVolume`/`voiceVolume` 0-1, `skip`, `skipReadText` (only skip text already read), `skipDelay`/`skipInterval` ms, `showDialog`, `voiceEndMode` (stop / fade / none: what a voice line does when the player advances) and `voiceFadeDuration` ms, `muteOnWindowBlur`. project_info shows the current values.",
                properties: {
                    cps: { type: "number" },
                    textRevealDuration: { type: "number" },
                    gameSpeed: { type: "number" },
                    autoForward: { type: "boolean" },
                    autoForwardDelay: { type: "number" },
                    showDialog: { type: "boolean" },
                    skip: { type: "boolean" },
                    skipReadText: { type: "boolean" },
                    skipDelay: { type: "number" },
                    skipInterval: { type: "number" },
                    globalVolume: { type: "number" },
                    bgmVolume: { type: "number" },
                    soundVolume: { type: "number" },
                    voiceVolume: { type: "number" },
                    voiceEndMode: { type: "string", enum: ["stop", "fade", "none"] },
                    voiceFadeDuration: { type: "number" },
                    muteOnWindowBlur: { type: "boolean" },
                },
                additionalProperties: false,
            },
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
        "Imports files from disk into the project. Paths must be absolute. A path outside the project and the folders the author allowed (see agent_status) makes Studio ask the author for its folder first; for a big import, call request_folder_access up front. Each asset is named after its file name without extension unless `names` says otherwise - pick names a story line can use (e.g. `bg_classroom_day`). Files are deduplicated by content: a file byte-identical to an asset already in the project is not imported again and is listed under `duplicates` with the existing asset's name - no asset is made under the new name, so use the existing one. A path that names no file comes back under `failed` as not found. Transparency is not checked here; character_upsert warns about a pose with no transparency.",
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
        "Deletes an asset from the project - for clearing the skeleton's leftover demo pictures and music once nothing uses them, say. Refused while anything still refers to it (a story row, a scene's `#background`/`#music`, a character pose, a page or blueprint), or while its id is still written in a story, page or blueprint the usage index does not count; the refusal lists where. One step of undo; the file goes to the project's recycle bin.",
        {
            asset: { type: "string", description: "Asset name or id (assets_list)." },
            type: { type: "string", enum: ["image", "audio", "video", "font", "json", "model", "other"], description: "Only needed when two assets of different types share the name." },
        },
        ["asset"],
        true,
    ),
    ws(
        "asset_usage",
        "Where an asset is used",
        "Lists every place an asset is used, two ways: Studio's usage index (the one lint's `assets/unused` and asset_delete read), and every place its id is written in the stories, pages and blueprints. Call it before deleting an asset lint lists as unused: a use the index does not count shows up in the second list.",
        {
            asset: { type: "string", description: "Asset name or id (assets_list)." },
            type: { type: "string", enum: ["image", "audio", "video", "font", "json", "model", "other"], description: "Only needed when two assets of different types share the name." },
        },
        ["asset"],
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
        "Lists characters with id, name, nicknames, name colour, `kind` and their looks: a `preset` character's `poses` (one sprite image each); a `layered` character's `layered` block (canvas, axes with their tags and default, and the layer stack bottom to top with what each layer draws per tag - the exact shape character_layered_set takes, so edit it and send it back); a `live2d`/`spine`/`puppet` character's model (read-only: those are set up in Studio). Also `entranceTransform` (how big the sprite is drawn and where it stands) and the dialog avatar: `defaultAvatar`, the hand-drawn `avatars` per pose or tag combination, `bakedAvatars` (crops Studio cut from the sprites itself) and a layered character's `avatarAxes`. `spriteSize` is the default look's pixels (a layered character's canvas) and `drawnAtCenter` the box it occupies on a `/show <name> pos=center` row, in design pixels from the stage's top-left - check it instead of guessing from a screenshot. `groups` lists the cast groups the Characters panel files characters under (id, name, member count), and each character's `group`/`groupId` names its own (null = ungrouped); character_upsert {group} moves one.",
    ),
    ws(
        "character_upsert",
        "Create or update a character",
        "Creates a character, or updates the one with this `id` or exact `name`. Poses are sprite images already imported as assets. A line `Name: text` in a story resolves to the character with that name or nickname. A sprite is drawn at its own pixel size times `zoom`, its centre placed by `position`; a character that gets poses and has no `entranceTransform` yet is given a standing one (feet on the bottom edge, own pixel size, scaled down only if taller than the stage). A reused character keeps the entrance its old art was tuned for - the answer warns; pass `entranceTransform: \"standing\"` to refit. Warns when a pose image has no transparency. Name, colour, nicknames, entrance and avatars work on a layered character too; its looks are written with character_layered_set. Avatars (the face beside a line in the dialogue box and the backlog): `defaultAvatar` shows wherever nothing more specific does - and is the only one a Live2D/Spine character has; `avatars` gives a picture per pose (preset) or per tag combination (layered). Without either, Studio cuts avatars from the sprites: after giving a character sprites, call character_avatars_autoframe so they are framed on the detected head. `group` files the character under a cast group of the Characters panel (by name or id; a name no group has creates that group), null takes it out of its group. One step of undo (a group the call created stays when it is undone).",
        {
            id: { type: "string" },
            name: { type: "string" },
            nicknames: { type: "array", items: { type: "string" } },
            group: {
                description: "Cast group (Characters panel) to file the character under: a group's name or id from characters_list `groups`; a name no group has creates the group. null = ungrouped. Omit to leave it where it is.",
                oneOf: [{ type: "string" }, { type: "null" }],
            },
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
            defaultAvatar: {
                description: "Image asset (name or id) shown as the speaker's avatar wherever no pose or tag combination has its own - the backlog and off-stage lines included. null clears it.",
                oneOf: [{ type: "string" }, { type: "null" }],
            },
            avatars: {
                type: "object",
                additionalProperties: { oneOf: [{ type: "string" }, { type: "null" }] },
                description: "Hand-drawn avatars, merged into what is there: pose name -> image asset for a preset character; for a layered one, one tag of each avatar axis joined with `+` (any order), e.g. `{ \"smile\": \"mei_face_smile\" }` or `{ \"casual+smile\": … }`. null drops that one (Studio's own crop shows again). Restating `poses` keeps the avatars of poses whose name is unchanged.",
            },
            avatarAxes: {
                description: "Layered only: the axes the avatar varies with, by name (e.g. `[\"expression\"]` = one avatar per expression whatever the outfit). null = every axis. Set it before (or in the same call as) `avatars`, since it decides what their keys mean.",
                oneOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
            },
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
    ws(
        "character_avatars_autoframe",
        "Auto-frame dialog avatars",
        "Frames dialog avatars (the face beside a line in the dialogue box and the backlog) on the head Studio's head-detection model finds in the sprite: every pose of a preset character, every avatar tag combination of a layered one. Each framing is written as that pose's or look's own framing - what the author's framing box writes - and the avatar is cut from it at the next bake. Call it once for a character right after creating it or giving it sprites (character_upsert with `poses`, character_layered_set, character_layers_import); without it the avatar is cut by a silhouette guess that often frames hair ornaments or the whole figure. Without `character`, runs over the whole cast. A pose or look that already has its own framing is kept unless `overwrite`; one with a hand-drawn avatar (`avatars` on character_upsert) or nothing drawn is left alone. Reports per character which looks were framed and in which no head was found (those keep the automatic crop). About a quarter of a second per picture. One step of undo per character.",
        {
            character: { type: "string", description: "Character name or id. Omit to frame every character." },
            overwrite: { type: "boolean", default: false, description: "Replace framings poses or looks already have, the author's included." },
        },
        [],
        true,
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
    ws("audio_tracks_list", "List audio tracks", "Lists the audio tracks (the three built-in ones, named in the project's story language, and any custom ones) that `/bgm track=` and sound props can name."),

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
        "Creates an empty scene in a story (and the story itself if `story` names none that exists - then the new story holds just this scene, in `chapter` when given, with no default chapter or scene beside it). To start a new chapter after an existing one, give the new `chapter` name and `after` = the last scene of the chapter before it. Returns its id; then write its rows with story_apply.",
        {
            name: { type: "string" },
            story: { type: "string", description: "Story name or id; defaults to the first story." },
            chapter: { type: "string", description: "Chapter name; created if missing - right after `after`'s chapter when `after` is in another one, else last." },
            after: {
                type: "string",
                description: "Place after this scene (name or id); defaults to the end. With a `chapter` other than this scene's, the new scene opens that chapter: a new chapter is made right after this scene's chapter; an existing one must already be the next chapter.",
            },
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
    ws(
        "chapter_rename",
        "Rename a chapter",
        "Renames a chapter of a story (story_list shows them). Chapters only group scenes; nothing refers to one by name. One step of undo.",
        { chapter: { type: "string", description: "Chapter name or id." }, name: { type: "string" }, story: { type: "string", description: "Story name or id; defaults to the first story." } },
        ["chapter", "name"],
        true,
    ),
    ws(
        "chapter_delete",
        "Delete a chapter",
        "Deletes an empty chapter. Refused while it still holds scenes (the refusal lists them): move them with scene_create's placement or delete them with scene_delete first. One step of undo.",
        { chapter: { type: "string", description: "Chapter name or id." }, story: { type: "string", description: "Story name or id; defaults to the first story." } },
        ["chapter"],
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
        "Prints a page or component in the `.ui` text format, ids and props included, with its `revision`. To change something: show, edit, apply. Short by default: an element line ending in `+defaults` holds its widget's default for every prop not written (a `without` line names defaults it does not hold), and a bare key in an appearance's `propertyGroups` is a row repeating that prop. ui_apply restores both exactly, so the short text can be edited and applied as it is. A page longer than one answer comes in parts: each ends with a `# ui_show part:` comment naming the `offset` of the next; call again with it until the part that says it is the last, join the parts in order, and that joined text applies back whole (ui_apply refuses a source missing a part). Or pass `full: true` for the whole text in one answer.",
        {
            surface: { type: "string", description: "Page name or id." },
            component: { type: "string", description: "Component name or id." },
            compact: { type: "boolean", default: true, description: "Leave out props at their default and appearance rows that repeat a prop. False prints every stored value." },
            offset: { type: "integer", minimum: 0, default: 0, description: "Where the part starts, for a page served in parts: the offset the previous part's closing `# ui_show part:` comment names." },
            full: { type: "boolean", default: false, description: "The whole page in one answer however long it is, instead of in parts. For a client that keeps long answers." },
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
        "Renders a page (or one element of it) as it looks in the game and returns the image. Do this after every visible change and check alignment, contrast, overlap and text overflow before moving on. Elements are drawn at rest; pass `element` with `state: \"hovered\"` or `\"active\"` to see a button's hover or pressed look. A crop to `element` takes in what the element draws past its own box (a picture hanging over a button's edge) unless the element clips it. Video elements are shown as their poster (`posterAssetId`), or a grey placeholder with a play mark where there is none - the result says which.",
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
        "Applies a `.ui` document. Each `surface` or `component` block replaces that page's whole element tree - elements the block leaves out are deleted (the answer names them). Prefer ui_patch for small edits. A page ui_show served in parts applies as the parts joined in order; a source missing a part is refused, never applied. One step of undo.",
        { source: { type: "string" }, baseRevision: BASE_REVISION, dryRun: DRY_RUN },
        ["source"],
        true,
    ),
    ws(
        "ui_patch",
        "Edit elements",
        "Small edits to one page without rewriting it: add an element, set props, move/resize, re-parent, rename, delete, place a component with its params, change a page setting. All operations in one call are one step of undo. A mistake (a prop the widget does not know, an element that is not there) refuses the whole call and writes nothing; an operation that is already done (a value the element already holds) is skipped and listed under `skipped`, and the rest apply - so \"Applied N operation(s)\" means N real changes. `warnings` names an edit that will not look as meant (an image fill with no picture). Hide an element with `set` `{\"layout.visible\": false}`. Keys are the ones ui_show prints: `animation`/`navigation` are the element's own records, `setting <key>` lines are the `setting` op, `component <id> slot=\"7\"` is `params`. Prefer several small patches over one big apply when building a page, so the author can watch it come together.",
        {
            surface: { type: "string", description: "Page or component name or id." },
            ops: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        op: { type: "string", enum: ["add", "set", "layout", "move", "rename", "delete", "instantiate", "setting"] },
                        element: { type: "string", description: "Target element id or path (all ops but add/instantiate/setting)." },
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
                                "add/set: props to merge, `.ui` dotted keys allowed (`imageFill.assetId`). As in the `.ui` format the first segment picks the bag: `layout.visible`/`layout.opacity`/`layout.rotation` (or `{\"layout\": {\"visible\": false}}`) write the element's layout, `style.*` its CSS overrides, `extra.*` its extra record, `animation` / `navigation` (or `animation.enter`) the element's own enter/exit and navigation records exactly as ui_show prints them (null removes); `props.<key>` is a widget prop whose name is one of those words (a Page widget's `props.animation`); every other key is a widget prop and must be one the widget knows (ui_widget lists them).",
                        },
                        params: {
                            type: "object",
                            description:
                                "instantiate, or set on a placed component: its param values by param id - `{\"slot\": \"7\", \"mode\": \"save\"}` is the `.ui` line `component <id> slot=\"7\" mode=save`. `<id>.key` names the translation key a text param reads (null for none). Only params the component declares (ui_show on the component prints its `param` lines).",
                            additionalProperties: { description: "A string (a number or true/false is written as one); null only for a `.key`." },
                        },
                        key: { type: "string", description: "setting: the page setting - backgroundColor, backgroundImage, music, pageAnimation or navigation, dotted for a field inside one (`pageAnimation.enter`); the `setting <key> = <value>` lines ui_show prints under a page." },
                        value: { description: "setting: the new value (`\"transparent\"`, `\"#202020\"`, or an object as ui_show prints it); null takes the setting away." },
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
    ws(
        "ui_page_rename",
        "Rename a page",
        "Renames a page or Game UI (named by its name or id, as ui_surfaces lists it). Go Page nodes and frames that open it hold its id, so they follow. One step of undo.",
        { page: { type: "string", description: "Page or Game UI name or id." }, name: { type: "string", description: "The new name; no other page may have it." } },
        ["page", "name"],
        true,
    ),
    ws(
        "ui_page_delete",
        "Delete a page",
        "Deletes a page or Game UI with its elements and blueprints - a template page you do not use, say. Refused for the entry page (ui_page_set_entry another first) and while any blueprint, element or story row elsewhere still opens or names it; the refusal lists them. One step of undo.",
        { page: { type: "string", description: "Page or Game UI name or id." } },
        ["page"],
        true,
    ),
    ws(
        "ui_page_set_entry",
        "Set the entry page",
        "Makes a page the one the game opens on (the splash or title). project_info names the current one. One step of undo.",
        { page: { type: "string", description: "Page name or id; a Game UI cannot be the entry." } },
        ["page"],
        true,
    ),
    ws(
        "ui_install_standard_screens",
        "Install the standard screens",
        "Brings the skeleton template's working screens into the open project - splash, title, save, load, config, log, extra and confirm pages, the dialogue box, choice menu, quick menu and notifications, their components and every blueprint behind them - for a project made from the empty template, or one whose interface was lost. Start begins the project's own story; the files, palette entries, translation keys, input actions, save field and persistent variable the screens use come along. A Game UI slot the project already fills is left alone unless `replace` is true, which deletes the project's Game UIs in those slots and its empty pages. The splash becomes the entry page when the current entry page is empty (or with `replace`). Pages whose blueprints need a plugin this project does not run (the Gallery's Extra page) are left out, with the buttons that open them. One step of undo takes back the interface it added, with its input actions, and puts back what it replaced; the files, palette entries, translation keys, variable and save field stay, as the answer lists. Restyle the result like the skeleton.",
        {
            replace: { type: "boolean", default: false, description: "Delete the project's Game UIs in the slots these fill, and its empty pages, instead of skipping those Game UIs." },
            dryRun: DRY_RUN,
        },
        [],
        true,
    ),
    ws(
        "ui_templates",
        "Interface templates",
        "Lists interface templates from Studio's online template store. They are layouts: most carry no blueprints, so their buttons do nothing, their save slots are not bound to saves and their sliders to nothing, until you wire them (blueprint_apply). For screens that already work, use ui_install_standard_screens.",
    ),
    ws(
        "ui_template_apply",
        "Apply a template",
        "Adds a template's pages (and components) to the project as new pages; it never replaces the entry page. The answer says, per page, how many blueprints and bound props came with it - for most store templates none, so wire them before relying on them, make the title the entry with ui_page_set_entry, and delete pages you replaced with ui_page_delete.",
        { template: { type: "string", description: "Template id from ui_templates." } },
        ["template"],
        true,
    ),
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
    ws(
        "blueprint_list",
        "List blueprints",
        "Lists blueprints with their owner (surface/element) and event heads. Empty ones (no nodes) are left out unless `query` or `all` is given.",
        { query: { type: "string" }, all: { type: "boolean", description: "Also list blueprints that hold no nodes." } },
    ),
    ws(
        "blueprint_show",
        "Read a blueprint as text",
        "Prints one blueprint (or all of one owner) in the `.bp` text format, with each blueprint's `revision`. Blueprint names are in the project's language (the skeleton's title Start button's is `开始` in a Chinese project), so find one by its owner: ui_show prints `# blueprint: <name>` after the element that owns it, and an owner key `widgetMain:<surfaceId>:<elementId>`, passed as `blueprint`, shows all of that element's blueprints.",
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
    ws(
        "blueprint_remove",
        "Remove a blueprint",
        "Removes one blueprint - typically one left behind when ui_apply or ui_patch deleted the element it hung off (`ui.orphaned_blueprint`). Only a widget's, a component element's or a bound value's blueprint; refused while another blueprint or a bound prop still names it, with the reasons. One step of undo.",
        { blueprint: { type: "string", description: "Blueprint id, or its whole name when only one blueprint has it (blueprint_list)." }, dryRun: DRY_RUN },
        ["blueprint"],
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
        "Writes translations of one target language: `entries` is `[{unitId, target, status?, note?, rev?}]`, up to 1000 per call - a scene or a few hundred lines at a time, so the author can watch the table fill. The whole call is one step of undo. `status` defaults to `machine` (an agent's translation, for the author to review); pass `translated` when the author asked for final text, `reviewed` only when they said they reviewed it. `target: \"\"` clears a translation. Pass each unit's `rev` from localization_list: a unit whose source changed since is skipped and returned with its new source, and one whose translation the author changed since is skipped and returned with the author's words. Unknown unit ids refuse the whole call; the source language is refused. Lost `{n}` values, run tags, `{name}` placeholders or line breaks are written but warned about - fix and resend those.",
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
    ws(
        "lint",
        "Check the project",
        "Runs every project lint rule and returns the findings, errors first, a page at a time. The answer opens with the totals and a count per rule over the whole report (`byRule`, before any filter), so a flood of one rule - hundreds of `assets/unused` - cannot hide the others: narrow with `rule` and page with `cursor`. Messages are in English with their rule id. Fix every error before a build.",
        {
            severity: { type: "string", enum: ["error", "warning", "info"], default: "warning", description: "Leave out findings below this severity." },
            rule: { type: "string", description: "Only this rule (`story/dead-end`), or a whole category by its prefix ending in `/` (`story/`, `assets/`)." },
            cursor: { type: "string", description: "`nextCursor` from the previous page, with the same filters. Start again without one after changing the project." },
            limit: { type: "integer", default: 150, minimum: 1, maximum: 500 },
        },
    ),
    main(
        "test",
        "Run a project test",
        "Runs a built-in test headlessly: `narraleaf-studio:route-coverage` (every scene reachable), `narraleaf-studio:reachable-endings`, `narraleaf-studio:project-diagnostics` (the lint rules as one pass/fail verdict). Findings come in English where the test supplies it, each with the `rule` that produced it when it has one (project-diagnostics gives the lint rule id, as `lint` does).",
        { project: PROJECT_ARG, id: { type: "string" } },
        ["id"],
    ),
    drivesGame(ws(
        "playtest_start",
        "Play the game",
        "Opens the game in Dev Mode, from the title page or from a scene (and row). The author sees it too. From a scene it returns once the first line is shown in full (or a menu is up), and says what it is (speaker and text). Then use playtest_advance and playtest_screenshot. Every playtest answer also lists the errors and warnings Dev Mode has reported in this run (`issues`, with scene and row or page) - the ones its issue strip counts.",
        { scene: { type: "string" }, row: { type: "integer", description: "1-based row in the scene." } },
    )),
    drivesGame(ws(
        "playtest_advance",
        "Advance the game",
        "Reads on `steps` lines of a running story. One step is one line: a click on the line shown in full, then a wait until the game is at rest again - on the next line, finished typing (rows without a line, such as /show or /sound, are not steps), a menu, or out of the story. So the answer names exactly what is on screen, and a screenshot taken next shows that whole line. Stops early at a choice menu, at an ending (names it, and the page the game went to: the title or an ending page), or when a click does not move the game; says why. Rows with no line are waited through: a transition up to 10 s, a timed `/wait` for its length plus 10 s, a `/video` the story waits on for as long as the call allows (the answer says `pausedBy` when one is still running, and an ending reached after the call ran out is reported by the next call), and a click the game swallowed is repeated once before the step is called stuck. A `/wait click` row (stopped for a click, no line on screen) is clicked through and counts as one step; the answer says `waitingForClick` while it waits. With `choice`, picks that option first (counts as one step). Does nothing on the title page: start from a scene.",
        {
            steps: { type: "integer", default: 1, description: "Lines to read on, 1-50." },
            choice: { type: "integer", description: "1-based option of the menu showing, in the order shown (hidden options are not counted)." },
        },
    )),
    ws(
        "playtest_screenshot",
        "Look at the game",
        "Screenshot of the running Dev Mode game as the player sees it: the stage with its Game UI and every page or layer open over it (the title, a backlog or settings page opened in game, a Confirm dialog). `view: \"stage\"` gives the engine's picture of the stage alone - the scene and the Game UI, without pages - which is what a save thumbnail shows, its text in a fallback typeface rather than the project's fonts (judge fonts from `screen`). Fails within about 15 s, saying why, when the game cannot be captured.",
        {
            maxSize: { type: "integer", default: 1280 },
            view: { type: "string", enum: ["screen", "stage"], default: "screen", description: "`screen` (default): what the player sees. `stage`: the stage alone, without pages and layers." },
        },
    ),
    drivesGame(ws(
        "playtest_click",
        "Click in the game",
        "Clicks an element of the interface in the running Dev Mode game - a page, a layer such as the Confirm dialog, or the Game UI on the stage - the way a player's mouse does: pointer events at a point inside the element, landing on whatever is on top there. Use it to exercise buttons you wired: Start, a save or load slot, a settings control, a quick-menu button. `element` is an id, a path of names (`Title / Menu / Start`, the page name allowed first), a name unique on screen, or the words it shows. Ambiguous or missing names are refused with the elements on screen listed; an element drawn several times (list rows) needs `index`; one covered by something else is refused, naming what covers it; one that lets the pointer through to an element around it (text on a button, say) is clicked there, as a player's click would be, and the answer names the element that was actually pressed. Returns what was done, what changed (pages and layers that opened or closed, a story starting, the line on screen) and what is showing now. Then call playtest_screenshot to look.",
        {
            element: { type: "string", description: "Id, path of names, unique name, or shown words of the element." },
            surface: { type: "string", description: "The page, layer or Game UI surface it is on (name or id), to narrow the search." },
            index: { type: "integer", description: "1-based drawing in screen order (top to bottom, then left to right), for an element drawn more than once." },
            at: { type: "object", description: "Where in the element's box: `{ x, y }` as shares from its top-left corner, 0-1 each. Defaults to the centre. Use it for a slider's track." },
        },
        ["element"],
    )),
    drivesGame(ws(
        "playtest_hover",
        "Hover in the game",
        "Rests the pointer on an element of the running game without pressing it, the way a player's mouse does: its hover look and its On Mouse Enter graph run, and the element the pointer rested on before is left. Takes the same `element`, `surface`, `index` and `at` as playtest_click and answers the same way. Call playtest_screenshot to see the hover look.",
        {
            element: { type: "string", description: "Id, path of names, unique name, or shown words of the element." },
            surface: { type: "string", description: "The page, layer or Game UI surface it is on (name or id)." },
            index: { type: "integer", description: "1-based drawing in screen order, for an element drawn more than once." },
            at: { type: "object", description: "`{ x, y }` in the element's box, 0-1 each. Defaults to the centre." },
        },
        ["element"],
    )),
    drivesGame(ws(
        "playtest_key",
        "Press a key in the game",
        "Presses and releases a key in the running game the way a player's keyboard does, so the input actions bound to it (Advance, Skip, Menu, Dismiss...) and the keyboard/gamepad focus navigation answer it: arrows move the focus between controls, Enter or Space presses the focused one, Escape goes back or closes a layer. `rightClick`, `wheelUp` and `wheelDown` are the pointer gestures that name no element, aimed at the middle of the game (right click usually opens the menu; wheel up the backlog). Answers like playtest_click.",
        {
            key: {
                type: "string",
                description: "Escape, Enter, Space, Tab, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End, F1-F12, Control, Shift, Alt, Meta, a single letter or digit, or rightClick, wheelUp, wheelDown.",
            },
            shift: { type: "boolean", description: "Hold Shift (Shift+Tab moves the focus backwards)." },
            ctrl: { type: "boolean", description: "Hold Ctrl with the key." },
            alt: { type: "boolean", description: "Hold Alt with the key." },
            meta: { type: "boolean", description: "Hold Cmd (Meta) with the key." },
            holdMs: { type: "integer", description: "Keep the key down this long, up to 8000 ms - e.g. `Control` held to skip." },
        },
        ["key"],
    )),
    ws(
        "playtest_variables",
        "Read the game's variables",
        "The saved and persistent variables as the running Dev Mode game holds them now - what the story, a screen or a page has written so far (variables_list gives only declarations and defaults). Scene variables are not listed. playtest_click and playtest_key also name the variables an act changed.",
        { query: { type: "string", description: "Only variables whose name contains this." } },
    ),
    drivesGame(ws("playtest_stop", "Stop playing", "Closes the Dev Mode game.")),
    ws("console_read", "Read Studio's console", "Recent lines from Studio's console. Channels: `build` (builds, and everything Dev Mode reports - the running game's errors land here), `blueprint`, `lint`, `storage`, `agent` (your own calls), and `story` while a scene's editor is open.", { channel: { type: "string" }, level: { type: "string", enum: ["debug", "info", "warning", "error"] }, limit: { type: "integer", default: 100 } }),
    main(
        "build",
        "Build the game",
        "Builds a playable package of the project. Runs the same pipeline as Studio's Build menu. Returns the output directory and, in `artifacts`, what was built (the `.app` bundle or the app folder) - the thing to open.",
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
