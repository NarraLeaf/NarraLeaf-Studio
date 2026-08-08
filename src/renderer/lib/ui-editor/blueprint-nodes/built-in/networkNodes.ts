/**
 * Network nodes: one request, and the two nodes that read what came back.
 *
 * For authored screens that need something from outside the game - an online notice board, patch
 * notes, a leaderboard. Not for assets: those are project content, they ship with the game, and
 * fetching one at runtime would make the game depend on a server to look right.
 *
 * ## Why reading is a separate node
 *
 * Fetch could have published `responseText` and `responseJson` pins, and an earlier spec had it do
 * exactly that. Two things go wrong with it. Every response gets decoded *and* JSON-parsed whether
 * or not the graph reads either, and a `JSON.parse` failure has nowhere to be reported except as
 * `responseJson = null`, which is the same value a body of `null` produces. Splitting the read out
 * gives the failure an execution pin and costs a response nobody reads nothing.
 *
 * ## Where the request actually happens
 *
 * In the main process, through the host API - never a `fetch()` from here. The renderer's origin is
 * the app protocol, so a direct call would be blocked by CORS for most third-party endpoints, and
 * the timeout, size cap and scheme check would all sit somewhere the page can reach around. See
 * `@shared/utils/blueprintNetworkFetch`.
 *
 * ## The project's Allow HTTP setting
 *
 * When it is off the game is confined to its own protocol and every request is cancelled, so these
 * nodes cannot work. Three layers say so, at falling distance from the author: the
 * `network/fetch-disallowed` lint rule marks the node in the editor, the build gate refuses to
 * package the project, and the host refuses the request at runtime.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NETWORK_METHODS,
    BLUEPRINT_NETWORK_PARAM_METHOD,
    BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_TEXT,
    type BlueprintNetworkMethod,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_NETWORK_MAX_LIVE_BODIES,
    normalizeBlueprintNetworkHeaders,
    type BlueprintNetworkFetchResult,
} from "@shared/types/blueprint/network";
import {
    BLUEPRINT_VALUE_TYPE_RESPONSE_BODY,
    normalizeBlueprintResponseBody,
} from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";
import { isResponseBodyLimitReached, readResponseBody, storeResponseBody } from "./responseBodyStore";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/** A request needs a running game to be issued from, i.e. event / macro graphs. */
const NETWORK_GRAPH_KINDS = ["event", "macro"] as const;

const urlIn: BlueprintNodePinDef = {
    id: "url",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "URL",
    allowInlineLiteral: true,
};

/**
 * Request headers as a JSON object.
 *
 * One pin rather than a row of dynamic name/value pins: `Make JSON Object` already builds exactly
 * this shape and already has the add-a-pair affordance, and header values are usually wired from a
 * variable (an auth token) rather than typed, so the connection has to exist either way.
 */
const headersIn: BlueprintNodePinDef = {
    id: "headers",
    kind: "input",
    semantic: "data",
    valueType: "json",
    label: "Headers",
    optional: true,
};

/**
 * Ignored by the methods that carry no body; see BLUEPRINT_NETWORK_METHODS_WITH_BODY.
 *
 * Labelled "Request Body" rather than "Body" because that label is already taken, by the Fn head's
 * execution pin for a *function* body - and the two share a translation key, so reusing it would
 * render this pin as 主体 in Chinese. The longer label is clearer here regardless, on a node that
 * also produces a Response.
 */
const bodyIn: BlueprintNodePinDef = {
    id: "body",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Request Body",
    optional: true,
    allowInlineLiteral: true,
};

/**
 * Seconds, like every other duration an author types into a blueprint.
 *
 * The id is `timeoutSeconds` because the execution pin a timed-out request leaves by is already
 * `timeout`, and a node may not carry the same pin id twice whatever the kind - the registry refuses
 * to register one that does. Only the id differs; the author reads the label.
 */
const timeoutIn: BlueprintNodePinDef = {
    id: "timeoutSeconds",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Timeout (s)",
    optional: true,
    allowInlineLiteral: true,
};

/**
 * The response handle, named `response` rather than `body` because Fetch's *request* body is already
 * called that and a node may not carry the same pin id twice - the registry refuses to register one
 * that does. It reads better this way regardless: Fetch produces a Response, and Read Response JSON
 * takes one.
 */
const responseOut: BlueprintNodePinDef = {
    id: "response",
    kind: "output",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_RESPONSE_BODY,
    label: "Response",
};

const responseIn: BlueprintNodePinDef = {
    id: "response",
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_RESPONSE_BODY,
    label: "Response",
};

const statusOut: BlueprintNodePinDef = {
    id: "status",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Status",
};

const errorOut: BlueprintNodePinDef = {
    id: "error",
    kind: "output",
    semantic: "data",
    valueType: "string",
    label: "Error",
};

type NetworkExecuteCtx = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

function readPin(ctx: NetworkExecuteCtx, pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
}

/**
 * The execution locals, which are where a response body lives.
 *
 * `executeGraph` always supplies them, so this is unreachable in practice; it is a throw rather than
 * a `?? {}` fallback because a fresh object here would accept the body and then drop it, leaving
 * every reader node downstream failing as though the graph were wired wrong.
 */
function requireLocals(ctx: NetworkExecuteCtx): Record<string, unknown> {
    if (!ctx.blueprintLocals) {
        throw new BlueprintGraphExecutionError("Network: no execution scope to hold the response", ctx.node.id);
    }
    return ctx.blueprintLocals;
}

function readOptionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

function readOptionalNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return typeof value === "string" && value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

function resolveMethod(ctx: NetworkExecuteCtx): BlueprintNetworkMethod {
    const stored = ctx.params[BLUEPRINT_NETWORK_PARAM_METHOD];
    const method = typeof stored === "string" ? stored.trim().toUpperCase() : "";
    return BLUEPRINT_NETWORK_METHODS.includes(method as BlueprintNetworkMethod)
        ? (method as BlueprintNetworkMethod)
        : "GET";
}

/**
 * The handle a reader node was given.
 *
 * Missing, released or foreign all throw rather than taking an execution pin, matching how the
 * sound transport treats an unwired handle: a reader with nothing to read is a graph that is wired
 * wrong, and an author cannot write a branch that fixes it at runtime. A body that failed to
 * *parse* is a different thing entirely and does get a pin.
 */
function requireBody(ctx: NetworkExecuteCtx, nodeLabel: string): string {
    const handle = normalizeBlueprintResponseBody(readPin(ctx, "response"));
    if (!handle) {
        throw new BlueprintGraphExecutionError(`${nodeLabel}: wire a Response`, ctx.node.id);
    }
    const body = readResponseBody(requireLocals(ctx), handle);
    if (body === null) {
        throw new BlueprintGraphExecutionError(
            `${nodeLabel}: this response is no longer available. A response can only be read by the same execution that fetched it.`,
            ctx.node.id,
        );
    }
    return body;
}

export const networkBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
        displayName: "Fetch",
        category: "Network",
        keywords: ["network", "http", "https", "fetch", "request", "api", "get", "post", "web", "url", "download"],
        graphKinds: [...NETWORK_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            urlIn,
            headersIn,
            bodyIn,
            timeoutIn,
            { id: "success", kind: "output", semantic: "exec", label: "Success" },
            { id: "httpError", kind: "output", semantic: "exec", label: "HTTP Error" },
            { id: "networkError", kind: "output", semantic: "exec", label: "Network Error" },
            { id: "timeout", kind: "output", semantic: "exec", label: "Timeout" },
            responseOut,
            statusOut,
            errorOut,
        ],
        inspectorParams: [
            {
                key: BLUEPRINT_NETWORK_PARAM_METHOD,
                label: "Method",
                kind: "select",
                options: BLUEPRINT_NETWORK_METHODS.map(method => ({ value: method, label: method })),
            },
        ],
        async execute(ctx) {
            const url = readOptionalString(readPin(ctx, "url"));
            if (!url) {
                throw new BlueprintGraphExecutionError("Fetch: wire or type a URL", ctx.node.id);
            }
            // Checked before the request, not after: the point of the cap is to not hold the bodies,
            // and refusing once one more has already arrived would defeat it.
            const locals = requireLocals(ctx);
            if (isResponseBodyLimitReached(locals)) {
                return {
                    nextPort: "networkError",
                    outputValues: {
                        response: null,
                        status: 0,
                        error: `This run is already holding ${BLUEPRINT_NETWORK_MAX_LIVE_BODIES} responses`,
                    },
                };
            }

            const seconds = readOptionalNumber(readPin(ctx, "timeoutSeconds"));
            const result: BlueprintNetworkFetchResult = await requireHostApi(ctx).network.fetch({
                url,
                method: resolveMethod(ctx),
                headers: normalizeBlueprintNetworkHeaders(readPin(ctx, "headers")),
                body: readOptionalString(readPin(ctx, "body")),
                timeoutMs: seconds !== undefined && seconds > 0 ? Math.round(seconds * 1000) : 0,
            });

            // A body is stored for `httpError` too: a REST API's 404 usually carries the JSON that
            // says what was not found, and an author who branches there needs to be able to read it.
            return {
                nextPort: result.outcome,
                outputValues: {
                    response: result.body === null ? null : storeResponseBody(locals, ctx.node.id, result.body),
                    status: result.status,
                    error: result.error,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_TEXT,
        displayName: "Read Response Text",
        category: "Network",
        keywords: ["network", "http", "response", "read", "text", "body", "string", "content"],
        graphKinds: [...NETWORK_GRAPH_KINDS],
        isPure: false,
        isLatent: false,
        // No failure pin: the body has already been decoded by the time it gets here, and undecodable
        // bytes became replacement characters rather than an error the author can act on.
        pins: [
            execIn,
            responseIn,
            execNext,
            { id: "text", kind: "output", semantic: "data", valueType: "string", label: "Text" },
        ],
        execute(ctx) {
            return {
                nextPort: "next",
                outputValues: { text: requireBody(ctx, "Read Response Text") },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
        displayName: "Read Response JSON",
        category: "Network",
        keywords: ["network", "http", "response", "read", "json", "parse", "body", "object", "api"],
        graphKinds: [...NETWORK_GRAPH_KINDS],
        isPure: false,
        isLatent: false,
        pins: [
            execIn,
            responseIn,
            execNext,
            { id: "failed", kind: "output", semantic: "exec", label: "Failed" },
            { id: "value", kind: "output", semantic: "data", valueType: "json", label: "Value" },
            errorOut,
        ],
        execute(ctx) {
            const body = requireBody(ctx, "Read Response JSON");
            try {
                return {
                    nextPort: "next",
                    outputValues: { value: JSON.parse(body) as unknown, error: null },
                };
            } catch (error) {
                // The server said something this graph cannot use - an HTML error page where JSON was
                // expected is the common one. A real runtime condition, so it gets a pin.
                return {
                    nextPort: "failed",
                    outputValues: {
                        value: null,
                        error: error instanceof Error ? error.message : String(error),
                    },
                };
            }
        },
    },
];
