import type { SharedBlueprintAsset } from "../types/blueprint/document";

/**
 * Thrown when a shared blueprint asset JSON file does not match the minimal M2 contract.
 */
export class SharedBlueprintAssetParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SharedBlueprintAssetParseError";
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertBlueprintProgram(raw: unknown): void {
    if (!isRecord(raw)) {
        throw new SharedBlueprintAssetParseError("blueprint.program must be an object");
    }
    const kind = raw.kind;
    if (kind === "graph") {
        const graphs = raw.graphs;
        if (!isRecord(graphs)) {
            throw new SharedBlueprintAssetParseError("blueprint.program.graphs required for graph program");
        }
        if (!isRecord(graphs.events)) {
            throw new SharedBlueprintAssetParseError("blueprint.program.graphs.events must be an object");
        }
        if (!isRecord(graphs.functions)) {
            throw new SharedBlueprintAssetParseError("blueprint.program.graphs.functions must be an object");
        }
        return;
    }
    if (kind === "scriptModule") {
        if (!isRecord(raw.source)) {
            throw new SharedBlueprintAssetParseError("blueprint.program.source required for scriptModule");
        }
        return;
    }
    throw new SharedBlueprintAssetParseError("blueprint.program.kind must be graph or scriptModule");
}

function assertBlueprintEntity(raw: unknown): void {
    if (!isRecord(raw)) {
        throw new SharedBlueprintAssetParseError("blueprint must be an object");
    }
    if (typeof raw.id !== "string" || !raw.id.trim()) {
        throw new SharedBlueprintAssetParseError("blueprint.id required");
    }
    if (typeof raw.name !== "string") {
        throw new SharedBlueprintAssetParseError("blueprint.name required");
    }
    if (raw.frontend !== "visual" && raw.frontend !== "typescript") {
        throw new SharedBlueprintAssetParseError("blueprint.frontend invalid");
    }
    if (raw.programKind !== "graph" && raw.programKind !== "scriptModule") {
        throw new SharedBlueprintAssetParseError("blueprint.programKind invalid");
    }
    if (!isRecord(raw.owner)) {
        throw new SharedBlueprintAssetParseError("blueprint.owner required");
    }
    assertBlueprintProgram(raw.program);
}

/**
 * Parse and validate unknown JSON value as {@link SharedBlueprintAsset}.
 */
export function parseSharedBlueprintAssetFromUnknown(raw: unknown): SharedBlueprintAsset {
    if (!isRecord(raw)) {
        throw new SharedBlueprintAssetParseError("Expected root object");
    }
    if (typeof raw.assetId !== "string" || !raw.assetId.trim()) {
        throw new SharedBlueprintAssetParseError("assetId required");
    }
    if (typeof raw.name !== "string") {
        throw new SharedBlueprintAssetParseError("name required");
    }
    if (raw.frontend !== "visual" && raw.frontend !== "typescript") {
        throw new SharedBlueprintAssetParseError("frontend invalid");
    }
    assertBlueprintEntity(raw.blueprint);
    return raw as SharedBlueprintAsset;
}

/**
 * Parse UTF-8 JSON text as {@link SharedBlueprintAsset}.
 */
export function parseSharedBlueprintAssetJson(text: string): SharedBlueprintAsset {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new SharedBlueprintAssetParseError(`Invalid JSON: ${msg}`);
    }
    return parseSharedBlueprintAssetFromUnknown(raw);
}
