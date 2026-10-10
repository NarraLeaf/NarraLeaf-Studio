/**
 * `assets_list`, `assets_import`, `assets_placeholder`, `asset_delete`.
 *
 * Imports go through `AssetsService` like a drop on the asset panel, so the new entries appear in the
 * panel as they land and each one is checked by the same format gate. Two things are added for an
 * agent: every path is checked against the directories the author allowed before anything is read,
 * and a file whose bytes the project already holds is reported as a duplicate rather than imported a
 * second time under another name.
 *
 * ⚠ The renderer may only read what the main process has granted this window. The project directory
 * always is; an allowed import root, or a folder the author allowed when asked, is readable once
 * main granted it to this window (`AgentManager.grantFolders`). A path this check admits but the
 * window may not read fails at import with `sourceUnreadable`, and the answer says so.
 *
 * A path that names no file is reported as not found before anything else is tried. The import
 * itself cannot tell a missing file from one this window may not read, and answering "may be outside
 * the directories this window is allowed to read" for a typo sends an agent off asking for access it
 * already has.
 *
 * Import does not warn about opaque images. Whether a picture needs transparency depends on what it
 * becomes, and at import that is a guess: backgrounds and CGs are opaque by design, and a portrait CG
 * has a sprite's shape. The warning lives where the use is known - `character_upsert` and the layered
 * sprite tools warn for every opaque pose or layer.
 *
 * Comments in English per project convention.
 */

import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import { basename, extname } from "@shared/utils/path";
import { AssetExtensions, AssetType, categoryOfAssetType } from "../../assets/assetTypes";
import type { AssetImportRefusal } from "../../assets/assetImportRefusal";
import type { Asset, AssetSource } from "../../assets/types";
import type { AssetsService } from "../../core/AssetsService";
import type { WorkspaceContext } from "../../services";
import {
    answerJson,
    readOptionalInteger,
    readOptionalString,
    readOptionalStringArray,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { describeBlockedDelete } from "../../assets/assetDeleteGuard";
import { AGENT_ASSET_TYPES, assetsService, listAssets, stripExtension } from "../agentLookups";
import { ensureAgentMayReadPaths } from "../agentFolderRequest";

const IMPORTABLE_TYPES: readonly AssetType[] = [AssetType.Image, AssetType.Audio, AssetType.Video, AssetType.Font];

function folderName(service: AssetsService, asset: Asset<AssetType, AssetSource>): string | null {
    if (!asset.groupId) {
        return null;
    }
    const groups = service.getGroupAssetsManager().getGroups(categoryOfAssetType(asset.type));
    return groups.find(group => group.id === asset.groupId)?.name ?? null;
}

function describeAsset(service: AssetsService, asset: Asset<AssetType, AssetSource>) {
    return { id: asset.id, name: asset.name, type: asset.type, folder: folderName(service, asset) };
}

export const assetsList: AgentToolHandler = async (args, { ctx }) => {
    const type = readOptionalString(args, "type") as AssetType | undefined;
    const query = readOptionalString(args, "query")?.toLowerCase();
    const limit = readOptionalInteger(args, "limit", { min: 1, max: 2000 }) ?? 200;
    if (type && !AGENT_ASSET_TYPES.includes(type)) {
        throw refuse("invalid_args", `Unknown asset type "${type}".`);
    }
    const service = assetsService(ctx);
    const all = listAssets(ctx, type ? [type] : AGENT_ASSET_TYPES)
        .filter(asset => !query || asset.name.toLowerCase().includes(query))
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    const shown = all.slice(0, limit);
    return answerJson({
        total: all.length,
        shown: shown.length,
        assets: shown.map(asset => describeAsset(service, asset)),
    });
};

/** Which importable type a file is, by its extension; null for one no importable type takes. */
export function assetTypeForPath(path: string): AssetType | null {
    const extension = extname(path).slice(1).toLowerCase();
    if (!extension) {
        return null;
    }
    for (const type of IMPORTABLE_TYPES) {
        if ((AssetExtensions[type] as readonly string[]).includes(extension)) {
            return type;
        }
    }
    return null;
}

/** A name nothing else of `type` has, `wanted` itself when free, then `wanted-2`, `wanted-3`. */
function uniqueAssetName(ctx: WorkspaceContext, type: AssetType, wanted: string, exceptId: string): string {
    const taken = new Set(listAssets(ctx, [type]).filter(asset => asset.id !== exceptId).map(asset => asset.name));
    if (!taken.has(wanted)) {
        return wanted;
    }
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${wanted}-${suffix}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}

/** The folder called `name` in `type`'s section, created when missing. */
async function ensureFolder(service: AssetsService, type: AssetType, name: string): Promise<string> {
    const category = categoryOfAssetType(type);
    const existing = service.getGroupAssetsManager().getGroups(category).find(group => group.name === name && !group.parentGroupId)
        ?? service.getGroupAssetsManager().getGroups(category).find(group => group.name === name);
    if (existing) {
        return existing.id;
    }
    const created = await service.createGroup(category, name);
    if (!created.success || !created.data) {
        throw refuse("internal", `Could not create the folder "${name}": ${created.error ?? "unknown error"}.`);
    }
    return created.data.id;
}

/** Name an imported asset and file it, the two things an import does not do on its own. */
async function finishImported(
    ctx: WorkspaceContext,
    asset: Asset<AssetType, AssetSource>,
    wantedName: string,
    folder: string | undefined,
): Promise<Asset<AssetType, AssetSource>> {
    const service = assetsService(ctx);
    const name = uniqueAssetName(ctx, asset.type, wantedName, asset.id);
    if (name !== asset.name) {
        const renamed = await service.renameAsset(asset, name);
        if (!renamed.success) {
            throw refuse("internal", `Imported, but could not rename "${asset.name}" to "${name}": ${renamed.error ?? "unknown error"}.`);
        }
    }
    if (folder) {
        const groupId = await ensureFolder(service, asset.type, folder);
        const current = service.getAssets()[asset.type]?.[asset.id] as Asset<AssetType, AssetSource> | undefined;
        if (current && current.groupId !== groupId) {
            await service.moveAssetsToGroup([current], groupId);
        }
    }
    return (service.getAssets()[asset.type]?.[asset.id] as Asset<AssetType, AssetSource> | undefined) ?? asset;
}

export function describeImportRefusal(refusal: AssetImportRefusal | undefined, fallback: string | undefined): string {
    switch (refusal?.kind) {
        case "sourceUnreadable":
            return "The file exists, but Studio could not read it (it may be outside the directories this window is allowed to read).";
        case "empty":
            return "The file is empty.";
        case "wrongType":
            return `.${refusal.ext} is not a file type this kind of asset takes.`;
        case "cannotUse":
            return `.${refusal.ext} cannot be used by the game; convert it to ${refusal.convertTo.join(" or ")}.`;
        case "mismatch":
            return `The file is really ${refusal.actual}, not .${refusal.ext}.`;
        case "undecodable":
            return "The file could not be decoded.";
        case "copyFailed":
            return "Copying the file into the project failed.";
        case "projectNotAccepting":
            return "The project is not accepting new content right now.";
        default:
            return fallback ?? "The import failed.";
    }
}

/**
 * Whether `path` is known to name no file. `false` when it exists, and also when the existence check
 * itself was refused or failed: only a definite "no such file" counts as missing.
 */
export async function isSourceMissing(path: string): Promise<boolean> {
    const answer = await appPrivilegedFacade.fs.isFileExists(path).catch(() => null);
    return Boolean(answer && answer.success && answer.data.ok && answer.data.data === false);
}

export function describeMissingSource(path: string): string {
    return `File not found: no file exists at ${path}. Check the path and its spelling; nothing was imported from it.`;
}

export const assetsImport: AgentToolHandler = async (args, { ctx, request, follow, log }) => {
    const paths = readOptionalStringArray(args, "paths") ?? [];
    if (paths.length === 0) {
        throw refuse("invalid_args", "`paths` must list at least one file.");
    }
    if (paths.length > 500) {
        throw refuse("invalid_args", "Import at most 500 files per call.");
    }
    const names = readOptionalStringArray(args, "names");
    if (names && names.length !== paths.length) {
        throw refuse("invalid_args", "`names` must have one entry per path.");
    }
    const forcedType = readOptionalString(args, "type") as AssetType | undefined;
    if (forcedType && !IMPORTABLE_TYPES.includes(forcedType)) {
        throw refuse("invalid_args", `\`type\` must be one of ${IMPORTABLE_TYPES.join(", ")}.`);
    }
    const folder = readOptionalString(args, "folder");

    // Every path is checked before any is read, so a call naming one forbidden file imports nothing.
    // A folder outside the allowed ones is put to the author first (see `agentFolderRequest`).
    await ensureAgentMayReadPaths(paths, { ctx, request });

    const service = assetsService(ctx);
    const imported: ReturnType<typeof describeAsset>[] = [];
    const duplicates: { path: string; existing: ReturnType<typeof describeAsset> }[] = [];
    const failed: { path: string; reason: string }[] = [];

    for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index];
        follow.describeCall(request.callId, basename(path));
        const type = forcedType ?? assetTypeForPath(path);
        if (!type) {
            failed.push({ path, reason: `No asset type takes ${extname(path) || "files without an extension"}.` });
            continue;
        }
        if (await isSourceMissing(path)) {
            failed.push({ path, reason: describeMissingSource(path) });
            continue;
        }
        const hashed = await appPrivilegedFacade.fs.hash(path).catch(() => null);
        const hash = hashed && hashed.success && hashed.data.ok ? hashed.data.data : null;
        if (hash) {
            const existing = listAssets(ctx, [type]).find(asset => asset.hash === hash);
            if (existing) {
                duplicates.push({ path, existing: describeAsset(service, existing) });
                continue;
            }
        }
        const result = await service.importFromPaths(type, [path]);
        const status = result.success ? result.data?.[0] : undefined;
        if (!result.success || !status?.success || !status.data) {
            failed.push({ path, reason: describeImportRefusal(status?.refusal, status?.error ?? result.error) });
            continue;
        }
        const wanted = names?.[index]?.trim() || stripExtension(basename(path));
        const finished = await finishImported(ctx, status.data as Asset<AssetType, AssetSource>, wanted, folder);
        imported.push(describeAsset(service, finished));
    }

    log("info", `imported ${imported.length}, duplicates ${duplicates.length}, failed ${failed.length}`);
    const lead = [
        `Imported ${imported.length} of ${paths.length}.`,
        duplicates.length > 0
            ? `${duplicates.length} already in the project byte for byte, so not imported again: no asset was made under the new name; `
                + "use the existing asset's name given under `duplicates`."
            : "",
        failed.length > 0 ? `${failed.length} failed.` : "",
    ].filter(Boolean).join(" ");
    return answerJson({ imported, duplicates, failed }, lead);
};

const PLACEHOLDER_MAX_EDGE = 8192;

/** The colour the tool table advertises as the default, read from it so the two cannot disagree. */
const PLACEHOLDER_DEFAULT_COLOR = String(AGENT_TOOLS_BY_NAME.get("assets_placeholder")?.inputSchema.properties?.color?.default ?? "gray");

/** A solid PNG with an optional centred caption, as bytes. */
export async function renderPlaceholderPng(width: number, height: number, color: string, caption: string | undefined): Promise<Uint8Array> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw refuse("internal", "No 2D canvas is available to draw the placeholder.");
    }
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    if (caption) {
        const fontSize = Math.max(12, Math.round(Math.min(width, height) / 12));
        context.font = `600 ${fontSize}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = readableInkOn(color, context);
        const maxWidth = width * 0.9;
        const lines = wrapCaption(context, caption, maxWidth);
        const lineHeight = fontSize * 1.25;
        const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, index) => context.fillText(line, width / 2, top + index * lineHeight, maxWidth));
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
        throw refuse("internal", "The placeholder could not be encoded.");
    }
    return new Uint8Array(await blob.arrayBuffer());
}

/** Black or white, whichever reads on `color`. */
function readableInkOn(color: string, context: CanvasRenderingContext2D): string {
    context.save();
    context.fillStyle = color;
    const resolved = String(context.fillStyle);
    context.restore();
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(resolved);
    if (!match) {
        return "#ffffff";
    }
    const [r, g, b] = match.slice(1, 4).map(part => parseInt(part, 16) / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.55 ? "#111111" : "#ffffff";
}

function wrapCaption(context: CanvasRenderingContext2D, caption: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of caption.split(/\r?\n/)) {
        // Character by character, so a CJK caption without spaces still wraps.
        let line = "";
        for (const char of paragraph) {
            const next = line + char;
            if (line && context.measureText(next).width > maxWidth) {
                lines.push(line);
                line = char.trimStart();
            } else {
                line = next;
            }
        }
        lines.push(line);
    }
    return lines.slice(0, 8);
}

export const assetsPlaceholder: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const name = readString(args, "name");
    const width = readOptionalInteger(args, "width", { min: 1, max: PLACEHOLDER_MAX_EDGE }) ?? 1920;
    const height = readOptionalInteger(args, "height", { min: 1, max: PLACEHOLDER_MAX_EDGE }) ?? 1080;
    const color = readOptionalString(args, "color") ?? PLACEHOLDER_DEFAULT_COLOR;
    const caption = readOptionalString(args, "caption");
    const folder = readOptionalString(args, "folder");
    if (typeof CSS !== "undefined" && !CSS.supports("color", color)) {
        throw refuse("invalid_args", `"${color}" is not a CSS colour.`);
    }
    follow.describeCall(request.callId, name);
    const bytes = await renderPlaceholderPng(width, height, color, caption);
    const service = assetsService(ctx);
    const created = await service.createLocalAssetFromBytes(AssetType.Image, `${name}.png`, bytes);
    if (!created.success || !created.data) {
        throw refuse("internal", `The placeholder could not be added to the project: ${created.error ?? "unknown error"}.`);
    }
    const finished = await finishImported(ctx, created.data as Asset<AssetType, AssetSource>, name, folder);
    return answerJson(
        { asset: describeAsset(service, finished), width, height },
        `Added placeholder image "${finished.name}" (${width}x${height}). Tell the author it is a placeholder to replace.`,
    );
};

// ── asset_delete ─────────────────────────────────────────────────────────────────────────────────

/** The asset `ref` names, by id or by name across every type; `type` narrows a name two types share. */
function resolveAnyAsset(ctx: WorkspaceContext, ref: string, type: AssetType | undefined): Asset<AssetType, AssetSource> {
    const pool = listAssets(ctx, type ? [type] : AGENT_ASSET_TYPES);
    const byId = pool.find(asset => asset.id === ref);
    if (byId) {
        return byId;
    }
    const named = pool.filter(asset => asset.name === ref || stripExtension(asset.name) === ref);
    if (named.length > 1) {
        throw refuse(
            "invalid_args",
            `${named.length} assets are called "${ref}" (${named.map(asset => asset.type).join(", ")}).`,
            "Name the asset by id (assets_list), or pass `type`.",
        );
    }
    if (named.length === 0) {
        throw refuse("not_found", `No asset "${ref}"${type ? ` of type ${type}` : ""}.`, "Call assets_list for the names.");
    }
    return named[0];
}

/**
 * Delete an asset nothing refers to.
 *
 * The question "does anything still use it" is the one Studio's own delete asks, answered by the same
 * reverse index (`AssetsService.findAssetReferences`: story rows, scene settings, character poses,
 * pages, blueprints, voice tables), flushed first so a reference an edit just removed is not still
 * counted. Unlike Studio, an agent is never offered "delete anyway": it gets the list and rewrites
 * those first. The delete itself is the service's, one step of undo with the file in the recycle bin.
 */
export const assetDelete: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const type = readOptionalString(args, "type") as AssetType | undefined;
    if (type && !AGENT_ASSET_TYPES.includes(type)) {
        throw refuse("invalid_args", `Unknown asset type "${type}".`);
    }
    const asset = resolveAnyAsset(ctx, readString(args, "asset"), type);
    follow.describeCall(request.callId, asset.name);
    const service = assetsService(ctx);
    const report = await service.findAssetReferences([asset.id], [asset.type]);
    if (!report.checked) {
        throw refuse(
            "unavailable",
            describeBlockedDelete(report, new Map([[asset.id, asset.name]])),
            "Nothing was deleted. Call lint to find what Studio cannot read, then try again.",
        );
    }
    const references = report.references.get(asset.id) ?? [];
    if (references.length > 0) {
        const lines = references.map(reference => {
            const where = [reference.label, reference.detail].filter(Boolean).join(" › ");
            return `- ${where} (${reference.field})${reference.dormant ? " - stored but not shown right now; it shows again if switched back" : ""}`;
        });
        throw refuse(
            "unavailable",
            `${asset.type} "${asset.name}" is still used in ${references.length} place(s):\n${lines.join("\n")}`,
            "Rewrite those first - story_apply for rows and a scene's #background / #music, character_upsert for poses, "
                + "ui_patch or blueprint_apply for pages - then delete it. Nothing was deleted.",
        );
    }
    const result = await service.deleteAsset(asset);
    if (!result.success) {
        throw refuse("unavailable", `${asset.type} "${asset.name}" could not be deleted: ${result.error ?? "unknown reason"}.`);
    }
    return answerJson(
        { deleted: { id: asset.id, name: asset.name, type: asset.type } },
        `Deleted ${asset.type} "${asset.name}". One step of undo in Studio.`,
    );
};
