import { agentRefusal, isAgentInternalToolName, type AgentCallResult, type AgentContent, type AgentErrorCode } from "./protocol";
import { AGENT_TOOLS_BY_NAME, type AgentJsonSchema, type AgentToolDescriptor } from "./tools";

/**
 * Tools a plugin contributes to Studio's MCP endpoint, beside the built-in ones in `./tools.ts`.
 *
 * A plugin's studio entry registers them with `app.services.agent.registerTool` (see
 * `renderer/lib/plugins/pluginAgentTools.ts`); its manifest declares each one by name in
 * `contributes.agentTools`, which is what the install prompt counts. The workspace that loaded the
 * plugin reports the descriptors to main, and main lists them in `tools/list` for as long as that
 * workspace has them - a plugin that is switched off, frozen out of a project or unloaded takes its
 * tools with it.
 *
 * Everything in this file is pure and shared, because both hops need the same answers: main checks
 * what a workspace reported before advertising it, and the workspace checks what a plugin registered
 * before running it.
 *
 * Comments in English per project convention.
 */

/**
 * A plugin tool's own name: `<pluginId>.<tool>`, lower case, digits, `_`, `.` and `-` only. Prefixed
 * like every other id a plugin contributes, so one plugin cannot name another's tool.
 */
export const AGENT_PLUGIN_TOOL_NAME_PATTERN = /^[a-z0-9_.-]+$/;

/** What MCP clients (and the model APIs behind them) accept as a tool name. */
export const AGENT_MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Between the plugin part and the tool part of an advertised name. No built-in tool name contains
 * it (a test holds that), so a plugin tool can never shadow one.
 */
export const AGENT_PLUGIN_TOOL_SEPARATOR = "__";

export const AGENT_PLUGIN_TOOL_TITLE_MAX = 80;
export const AGENT_PLUGIN_TOOL_DESCRIPTION_MAX = 1200;
/** An answer's text is cut here; a plugin that wants to say more should page. */
export const AGENT_PLUGIN_TOOL_TEXT_MAX = 60_000;
/** The same budget for `structuredContent`, measured as JSON. Larger data is dropped, not cut. */
export const AGENT_PLUGIN_TOOL_DATA_MAX = 60_000;
/** One picture, base64, at most this long (about 7.5 MB of PNG). */
export const AGENT_PLUGIN_TOOL_IMAGE_MAX = 10_000_000;
/** An input schema written out as JSON may not be longer than this. */
export const AGENT_PLUGIN_TOOL_SCHEMA_MAX = 20_000;
const SCHEMA_DEPTH_MAX = 10;

/** The argument every workspace tool takes, added to a plugin tool's schema by the host. */
export const AGENT_PROJECT_ARGUMENT = "project";

/** Guide chapters a plugin ships are named `plugin:<pluginId>` in `agent_guide`. */
export const AGENT_PLUGIN_GUIDE_CHAPTER_PREFIX = "plugin:";
/** And served as MCP resources under this prefix. */
export const AGENT_PLUGIN_GUIDE_URI_PREFIX = "narraleaf://guide/plugin/";

/** One tool as `contributes.agentTools` declares it. */
export type AgentPluginToolDeclaration = {
    name: string;
    /** Changes the project. Must match what the registration says. */
    write: boolean;
};

/**
 * A plugin tool as main lists it: an ordinary workspace tool, plus whose it is.
 *
 * `name` is the advertised (MCP) name; `pluginToolName` is the plugin's own dotted name, which is
 * what the manifest declares and what the plugin registered.
 */
export type AgentPluginToolDescriptor = AgentToolDescriptor & {
    side: "workspace";
    pluginId: string;
    /** The plugin's name as its manifest gives it (identity, not translated). */
    pluginName: string;
    pluginToolName: string;
};

export function isAgentPluginToolDescriptor(tool: AgentToolDescriptor): tool is AgentPluginToolDescriptor {
    return typeof (tool as Partial<AgentPluginToolDescriptor>).pluginId === "string";
}

/**
 * The name a plugin tool is advertised under, or null when it cannot be one.
 *
 * `narraleaf.gallery.add_entries` becomes `narraleaf_gallery__add_entries`: the plugin id and the
 * tool part each with every `.` and `-` turned into `_`, joined by {@link AGENT_PLUGIN_TOOL_SEPARATOR}.
 * Dots are what some model APIs silently drop a tool for, which is the whole reason for the mapping.
 *
 * An empty plugin id has no name: `.build` would map to `__build`, the name of an internal call. Nor
 * does any id that maps to a name starting with `__` (see `AGENT_INTERNAL_TOOL_PREFIX`).
 */
export function agentPluginToolMcpName(pluginId: string, name: string): string | null {
    if (typeof pluginId !== "string" || !pluginId) {
        return null;
    }
    if (typeof name !== "string" || !AGENT_PLUGIN_TOOL_NAME_PATTERN.test(name) || !name.startsWith(`${pluginId}.`)) {
        return null;
    }
    const local = name.slice(pluginId.length + 1);
    if (!local || !/[a-z0-9]/.test(local)) {
        return null;
    }
    const mapped = `${flatten(pluginId)}${AGENT_PLUGIN_TOOL_SEPARATOR}${flatten(local)}`;
    return AGENT_MCP_TOOL_NAME_PATTERN.test(mapped) && !isAgentInternalToolName(mapped) ? mapped : null;
}

function flatten(part: string): string {
    return part.replace(/[.-]/g, "_");
}

/** Whether an advertised name has the shape of a plugin tool (as opposed to a built-in one). */
export function looksLikeAgentPluginToolName(name: string): boolean {
    return name.includes(AGENT_PLUGIN_TOOL_SEPARATOR) && !AGENT_TOOLS_BY_NAME.has(name);
}

/**
 * What is wrong with a plugin tool's input schema, or an empty list when nothing is.
 *
 * Held to the subset of JSON Schema `validateArgs.ts` understands, because the schema is what the
 * arguments are checked against before the plugin sees them: a keyword the checker ignores would be
 * a rule the plugin thinks it has and does not. The root is an object whose properties may not
 * include `project`, which the host adds itself and uses for routing.
 */
export function checkAgentPluginToolSchema(schema: unknown): string[] {
    const errors: string[] = [];
    if (!isRecord(schema) || schema.type !== "object") {
        return ["inputSchema must be an object schema (`type: \"object\"`)"];
    }
    let size = 0;
    try {
        size = JSON.stringify(schema).length;
    } catch {
        return ["inputSchema must be plain JSON"];
    }
    if (size > AGENT_PLUGIN_TOOL_SCHEMA_MAX) {
        return [`inputSchema is ${size} characters as JSON; the limit is ${AGENT_PLUGIN_TOOL_SCHEMA_MAX}`];
    }
    if (isRecord(schema.properties) && AGENT_PROJECT_ARGUMENT in schema.properties) {
        errors.push(`inputSchema may not declare \`${AGENT_PROJECT_ARGUMENT}\`: Studio adds it and routes the call by it`);
    }
    checkSchemaNode(schema, "inputSchema", 0, errors);
    return errors.slice(0, 8);
}

const SCHEMA_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array", "null"]);
const SCHEMA_KEYS = new Set([
    "type",
    "description",
    "properties",
    "required",
    "items",
    "enum",
    "additionalProperties",
    "minimum",
    "maximum",
    "default",
    "oneOf",
]);

function checkSchemaNode(node: unknown, path: string, depth: number, errors: string[]): void {
    if (errors.length >= 8) {
        return;
    }
    if (depth > SCHEMA_DEPTH_MAX) {
        errors.push(`${path}: nested deeper than ${SCHEMA_DEPTH_MAX} levels`);
        return;
    }
    if (!isRecord(node)) {
        errors.push(`${path}: must be a schema object`);
        return;
    }
    for (const key of Object.keys(node)) {
        if (!SCHEMA_KEYS.has(key)) {
            errors.push(`${path}: \`${key}\` is not supported (use type, description, properties, required, items, enum, additionalProperties, minimum, maximum, default, oneOf)`);
        }
    }
    if (node.type !== undefined && (typeof node.type !== "string" || !SCHEMA_TYPES.has(node.type))) {
        errors.push(`${path}.type: must be one of ${[...SCHEMA_TYPES].join(", ")}`);
    }
    if (node.description !== undefined && typeof node.description !== "string") {
        errors.push(`${path}.description: must be a string`);
    }
    for (const bound of ["minimum", "maximum"] as const) {
        if (node[bound] !== undefined && (typeof node[bound] !== "number" || !Number.isFinite(node[bound]))) {
            errors.push(`${path}.${bound}: must be a number`);
        }
    }
    if (node.enum !== undefined) {
        if (!Array.isArray(node.enum) || node.enum.length === 0 || !node.enum.every(value => typeof value === "string" || typeof value === "number")) {
            errors.push(`${path}.enum: must be a non-empty list of strings or numbers`);
        }
    }
    if (node.properties !== undefined) {
        if (!isRecord(node.properties)) {
            errors.push(`${path}.properties: must be an object`);
        } else {
            for (const [name, child] of Object.entries(node.properties)) {
                checkSchemaNode(child, `${path}.properties.${name}`, depth + 1, errors);
            }
        }
    }
    if (node.required !== undefined) {
        if (!Array.isArray(node.required) || !node.required.every(name => typeof name === "string")) {
            errors.push(`${path}.required: must be a list of property names`);
        } else if (isRecord(node.properties)) {
            const properties = node.properties;
            for (const name of node.required) {
                if (!(name in properties)) {
                    errors.push(`${path}.required: \`${name}\` is not in properties`);
                }
            }
        }
    }
    if (node.items !== undefined) {
        checkSchemaNode(node.items, `${path}.items`, depth + 1, errors);
    }
    if (node.additionalProperties !== undefined && typeof node.additionalProperties !== "boolean") {
        checkSchemaNode(node.additionalProperties, `${path}.additionalProperties`, depth + 1, errors);
    }
    if (node.oneOf !== undefined) {
        if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) {
            errors.push(`${path}.oneOf: must be a non-empty list of schemas`);
        } else {
            node.oneOf.forEach((option, index) => checkSchemaNode(option, `${path}.oneOf[${index}]`, depth + 1, errors));
        }
    }
}

/** The schema a plugin tool is advertised with: the plugin's own, with `project` added. */
export function withAgentProjectArgument(schema: AgentJsonSchema & { type: "object" }): AgentJsonSchema & { type: "object" } {
    return {
        ...schema,
        properties: {
            ...(schema.properties ?? {}),
            [AGENT_PROJECT_ARGUMENT]: {
                type: "string",
                description:
                    "Absolute path of the project directory. Needed only when more than one project is open in Studio; otherwise the open one is used.",
            },
        },
    };
}

/** The arguments a plugin's handler is given: everything the agent sent but the routing argument. */
export function withoutAgentProjectArgument(args: Record<string, unknown>): Record<string, unknown> {
    const { [AGENT_PROJECT_ARGUMENT]: _project, ...rest } = args;
    return rest;
}

/**
 * Accept one descriptor a workspace reported, or null.
 *
 * Main lists what workspaces report, and a workspace runs plugin code - so a report is read the way
 * a file from disk is: every field checked, nothing taken on trust but its shape. A bad entry is
 * dropped rather than failing the whole report.
 */
export function readAgentPluginToolDescriptor(value: unknown): AgentPluginToolDescriptor | null {
    if (!isRecord(value)) {
        return null;
    }
    const { name, title, description, write, inputSchema, pluginId, pluginName, pluginToolName } = value;
    if (
        typeof pluginId !== "string"
        || !pluginId
        || typeof pluginToolName !== "string"
        || typeof name !== "string"
        || isAgentInternalToolName(name)
        || agentPluginToolMcpName(pluginId, pluginToolName) !== name
        || AGENT_TOOLS_BY_NAME.has(name)
        || typeof title !== "string" || !title.trim() || title.length > AGENT_PLUGIN_TOOL_TITLE_MAX
        || typeof description !== "string" || !description.trim() || description.length > AGENT_PLUGIN_TOOL_DESCRIPTION_MAX
        || typeof write !== "boolean"
        || typeof pluginName !== "string"
    ) {
        return null;
    }
    if (!isRecord(inputSchema) || !isRecord(inputSchema.properties) || !isRecord(inputSchema.properties[AGENT_PROJECT_ARGUMENT])) {
        return null;
    }
    const { [AGENT_PROJECT_ARGUMENT]: _project, ...ownProperties } = inputSchema.properties;
    if (checkAgentPluginToolSchema({ ...inputSchema, properties: ownProperties }).length > 0) {
        return null;
    }
    return {
        name,
        title,
        description,
        side: "workspace",
        write,
        inputSchema: inputSchema as AgentJsonSchema & { type: "object" },
        pluginId,
        pluginName: pluginName.slice(0, 120),
        pluginToolName,
    };
}

/** An installed plugin as main's plugin list gives it: enough to hold a report to its manifest. */
export type AgentPluginToolSource = {
    pluginId: string;
    enabled: boolean;
    manifest: { name: string; contributes: { agentTools?: readonly AgentPluginToolDeclaration[] } };
};

/**
 * Keep a reported tool only if an installed, enabled plugin declares it: the same plugin id, the
 * plugin's own name in `contributes.agentTools`, the same `write`. Answers the descriptor with the
 * plugin's name as its manifest gives it (not as the report did), or null.
 *
 * {@link readAgentPluginToolDescriptor} checks a report's shape; this checks its claims. A workspace
 * runs plugin code, and the manifest is what the author agreed to when the plugin was installed - a
 * tool it does not declare, or declares as reading while the report says writing (or the reverse),
 * is not one the author was told about.
 */
export function checkReportedAgentPluginTool(
    tool: AgentPluginToolDescriptor,
    plugins: readonly AgentPluginToolSource[],
): AgentPluginToolDescriptor | null {
    if (!tool.pluginId || isAgentInternalToolName(tool.name)) {
        return null;
    }
    const plugin = plugins.find(entry => entry.pluginId === tool.pluginId);
    if (!plugin || !plugin.enabled) {
        return null;
    }
    const declared = (plugin.manifest.contributes.agentTools ?? []).find(entry => entry.name === tool.pluginToolName);
    if (!declared || declared.write !== tool.write) {
        return null;
    }
    return { ...tool, pluginName: plugin.manifest.name.slice(0, 120) };
}

// ── What a plugin's handler answers ──────────────────────────────────────────────────────────────

/** Refusal codes a plugin may answer with. The gate's own codes (paused, frozen…) are Studio's alone. */
export type PluginAgentToolErrorCode = Extract<AgentErrorCode, "invalid_args" | "not_found" | "check_failed" | "stale_revision" | "unavailable">;

const PLUGIN_ERROR_CODES: readonly PluginAgentToolErrorCode[] = ["invalid_args", "not_found", "check_failed", "stale_revision", "unavailable"];

/** An answer: text the model reads, optionally the same facts as data, optionally one picture. */
export type PluginAgentToolAnswer = {
    text: string;
    /** Sent as MCP `structuredContent`. Plain JSON; dropped when larger than 60 000 characters. */
    data?: Record<string, unknown>;
    /** One PNG or JPEG, base64 without a `data:` prefix. */
    image?: { mimeType: "image/png" | "image/jpeg"; data: string };
};

/** A refusal the agent can act on: what is wrong, and what to do about it. */
export type PluginAgentToolRefusal = {
    error: { code?: PluginAgentToolErrorCode; message: string; hint?: string };
};

/** A bare string is a text answer. */
export type PluginAgentToolResult = string | PluginAgentToolAnswer | PluginAgentToolRefusal;

/** What a plugin tool's handler is given besides its arguments. Deliberately nothing that reaches Studio. */
export type PluginAgentToolContext = {
    /** The name the MCP client gave (`clientInfo.name`), when it gave one. */
    readonly clientName: string | null;
};

/** The JSON-schema subset a plugin tool's arguments are described in; see {@link checkAgentPluginToolSchema}. */
export type PluginAgentJsonSchema = AgentJsonSchema;

/** One tool a plugin offers AI agents connected to Studio. */
export type PluginAgentToolDef = {
    /** `<pluginId>.<tool>`, `[a-z0-9_.-]`, declared in `contributes.agentTools`. */
    name: string;
    /** Short, shown in the author's Agent log. At most 80 characters. */
    title: string;
    /** Written for the model: what it is for, when to use it, the mistake to avoid. At most 1200 characters. */
    description: string;
    /** The arguments, checked before the handler runs. Studio adds `project` itself. */
    inputSchema: PluginAgentJsonSchema & { type: "object" };
    /**
     * Changes the project. Refused unless the author allowed agent writes, and while paused, frozen
     * or in a live session. While a tool marked `false` runs, `services.storage.writeJson` refuses.
     * While one marked `true` runs, every `writeJson` is captured into one step of undo.
     */
    write: boolean;
    handler(args: Record<string, unknown>, context: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
};

/**
 * Turn what a plugin's handler returned into an answer, inside the limits every answer keeps: text
 * cut at {@link AGENT_PLUGIN_TOOL_TEXT_MAX}, data dropped past {@link AGENT_PLUGIN_TOOL_DATA_MAX}, at
 * most one picture. Anything that is none of the result shapes is reported as the plugin's fault.
 */
export function normalizePluginAgentToolResult(value: unknown, toolName: string): AgentCallResult {
    if (typeof value === "string") {
        return { ok: true, content: [{ type: "text", text: capText(value) }] };
    }
    if (!isRecord(value)) {
        return agentRefusal("internal", `${toolName} answered with something that is not a tool result.`);
    }
    if (isRecord(value.error)) {
        const error = value.error;
        const message = typeof error.message === "string" && error.message.trim() ? error.message : `${toolName} refused the call.`;
        const code = PLUGIN_ERROR_CODES.includes(error.code as PluginAgentToolErrorCode) ? error.code as PluginAgentToolErrorCode : "unavailable";
        const hint = typeof error.hint === "string" && error.hint.trim() ? capText(error.hint, 2000) : undefined;
        return agentRefusal(code, capText(message, 4000), hint);
    }
    if (typeof value.text !== "string") {
        return agentRefusal("internal", `${toolName} answered without \`text\`.`);
    }
    const notes: string[] = [];
    const content: AgentContent[] = [];
    let structured: Record<string, unknown> | undefined;
    if (value.data !== undefined) {
        const data = isRecord(value.data) ? jsonSize(value.data) : null;
        if (data !== null && data <= AGENT_PLUGIN_TOOL_DATA_MAX) {
            structured = JSON.parse(JSON.stringify(value.data)) as Record<string, unknown>;
        } else {
            notes.push("(The structured data was too large or not plain JSON and was left out.)");
        }
    }
    content.push({ type: "text", text: capText([value.text, ...notes].join("\n")) });
    if (value.image !== undefined) {
        const image = value.image;
        if (
            isRecord(image)
            && (image.mimeType === "image/png" || image.mimeType === "image/jpeg")
            && typeof image.data === "string"
            && image.data.length > 0
            && image.data.length <= AGENT_PLUGIN_TOOL_IMAGE_MAX
        ) {
            content.push({ type: "image", mimeType: image.mimeType, data: image.data });
        } else {
            const first = content[0] as { type: "text"; text: string };
            first.text = capText(`${first.text}\n(The picture was not a PNG or JPEG within the size limit and was left out.)`);
        }
    }
    return { ok: true, content, ...(structured ? { structured } : {}) };
}

function capText(text: string, max = AGENT_PLUGIN_TOOL_TEXT_MAX): string {
    if (text.length <= max) {
        return text;
    }
    const note = `\n[Cut: the answer was ${text.length} characters, the limit is ${max}. Ask for less.]`;
    return text.slice(0, Math.max(0, max - note.length)) + note;
}

function jsonSize(value: unknown): number | null {
    try {
        return JSON.stringify(value).length;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
