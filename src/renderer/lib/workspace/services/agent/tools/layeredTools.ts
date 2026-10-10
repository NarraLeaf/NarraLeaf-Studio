/**
 * Layered characters: writing one, building one from named images or a PSD, and looking at a look.
 *
 * A layered character is drawn from a stack of same-sized images. Its looks are AXES ("expression":
 * normal / smile / angry; "outfit": school / casual) and a story row picks a TAG of one
 * (`/char Mei smile` changes the expression and keeps the outfit; `/show Mei` fills every axis it
 * does not name with that axis's default). Which image each LAYER of the stack draws is decided by
 * the axis it follows - one axis may drive several layers - or it always draws the same one. See
 * `layeredSpec.ts` for the agent's spelling of that and the pure translation.
 *
 * Three tools, one pipeline. `character_layered_set` states the stack; `character_layers_import`
 * derives the same statement from image assets named `<character>_<layer>_<tag>` (what Studio's own
 * PSD import names the files it bakes) or from a PSD, and hands it to the same writer. The writer
 * checks what the character editor checks - every layer the canvas's size (the stage centres each
 * layer at its own size, so a mismatched one lands off-register), every tag of an axis accounted for
 * in every layer that follows it, no look that draws nothing - refuses on an error with nothing
 * written, and lands the record through `CharacterService.commitCharacterRecord`: one step of undo.
 *
 * Switching a preset (or puppet) character to layered discards its looks - Studio converts nothing
 * between the kinds - so the writer refuses until the agent has read which story rows that strands
 * and passes `confirmSwitch: true`.
 *
 * `character_preview` composites one look with the same draw rule as Studio's sprite compositor
 * (`drawStack`), so the agent can check a combination without starting the game.
 *
 * Comments in English per project convention.
 */

import type { AgentCallResult } from "@shared/agent/protocol";
import type { PsdDocument, PsdFingerprint, PsdFingerprintSlot } from "@shared/types/psdImport";
import {
    canMergeBlendMode,
    flattenLeaves,
    joinPath,
    planImport,
    toBakeTargets,
    unsupportedBlends,
    type ImportPlan,
} from "@shared/utils/psdLayerPlan";
import type { BlendResolution } from "@shared/types/psdImport";
import { getInterface } from "@/lib/app/bridge";
import { authoredNameOrNull } from "@shared/utils/generatedId";
import { AssetType, categoryOfAssetType } from "../../assets/assetTypes";
import type { Asset, AssetSource } from "../../assets/types";
import { Services, type WorkspaceContext } from "../../services";
import type { CharacterService } from "../../core/CharacterService";
import { Character } from "../../character/Character";
import { CharacterAppearance } from "../../character/CharacterAppearance";
import { collectCharacterDiagnostics, type CharacterDiagnostic } from "../../character/characterDiagnostics";
import { enumerateCombinations } from "../../character/characterCombinations";
import { nameBakeTargets } from "../../character/psdImportBuilder";
import { drawStack } from "../../character/spriteCompositor";
import type { LayeredAppearance, StoredCharacter } from "../../character/types";
import {
    answerJson,
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalRecord,
    readOptionalString,
    readOptionalStringArray,
    readString,
    refuse,
    AgentRefusal,
    type AgentToolContext,
    type AgentToolHandler,
} from "../agentCall";
import { assetsService, listAssets, resolveAsset } from "../agentLookups";
import { formatReferrers } from "../agentReferences";
import { ensureAgentMayReadPaths } from "../agentFolderRequest";
import { assertAgentMayStillWrite } from "../agentCommitGate";
import { opaqueImageWarning } from "../imageAlpha";
import { storyRowsChoosingLook } from "../characterLooks";
import {
    buildLayeredAppearance,
    checkLayeredSpec,
    layeredSpecFromNames,
    readLayeredSpec,
    selectionByName,
    type LayeredSpec,
    type NamedImage,
} from "../layeredSpec";
import {
    applyEntrance,
    coldSwitchCheck,
    commitRecord,
    describeCharacter,
    findCharacter,
    readEntrance,
    readImageFacts,
    stageSize,
    type EntranceInput,
    type ImageFacts,
} from "./castTools";
import { loadAllStories } from "./textFormat";

type PixelSize = { width: number; height: number };

// ── The writer ───────────────────────────────────────────────────────────────────────────────────

/**
 * What the canvas is, from the measured size of every image the stack draws, or why there is none.
 *
 * Every layer must be the canvas's size: the compositor and the stage draw each one centred at its
 * own pixels, so an eyes layer cropped to the face lands in the middle of the body. The editor
 * reports this as an error; here it refuses, naming each odd one out against the size most images
 * share. Exported for its test.
 */
export function canvasFromSizes(
    placements: readonly { assetId: string; where: string }[],
    sizes: ReadonlyMap<string, PixelSize | null>,
): { canvas: PixelSize | null; unmeasured: string[] } | { error: string } {
    const counts = new Map<string, { size: PixelSize; count: number }>();
    const unmeasured: string[] = [];
    for (const placement of placements) {
        const size = sizes.get(placement.assetId) ?? null;
        if (!size) {
            unmeasured.push(placement.where);
            continue;
        }
        const key = `${size.width}x${size.height}`;
        const entry = counts.get(key) ?? { size, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
    }
    if (counts.size === 0) {
        return { canvas: null, unmeasured };
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count || b.size.width * b.size.height - a.size.width * a.size.height);
    const canvas = ranked[0].size;
    if (ranked.length === 1) {
        return { canvas, unmeasured };
    }
    const odd = placements
        .map(placement => ({ placement, size: sizes.get(placement.assetId) ?? null }))
        .filter(({ size }) => size && (size.width !== canvas.width || size.height !== canvas.height))
        .map(({ placement, size }) => `  ${placement.where}: ${size!.width}x${size!.height}`);
    return {
        error: `Every layer image must be the same size - the canvas, ${canvas.width}x${canvas.height} here - because each one is drawn `
            + `centred at its own pixels; a smaller one would land off-register (a face part in the middle of the body). Not that size:\n${odd.join("\n")}`,
    };
}

/** A diagnostic of the editor's, in a sentence. Only the codes a spec can still produce are worded. */
function diagnosticText(diagnostic: CharacterDiagnostic): string {
    const v = diagnostic.values;
    switch (diagnostic.code) {
        case "combinationNoArt":
            return `The look ${v.name} draws nothing at all - every layer is empty for it.`;
        case "avatarCombinations":
            return `${v.count} dialogue avatars will be baked, one per combination of the axes (widest: "${v.name}"). Narrow the avatar axes in Studio's character editor if that is more than the author wants.`;
        case "axisDefaultMissing":
            return `Axis "${v.axis}" has no valid default; "${v.name}" is used.`;
        case "snapshotStale":
            return `The editor bookmark "${v.name}" names a tag that is gone; it now opens a different look.`;
        case "offCanvas":
            return `Layer "${v.name}" is ${v.size}, not the canvas ${v.canvas}.`;
        case "occluded":
            return `Layer "${v.name}" is completely covered by the layers above it.`;
        default:
            return `${diagnostic.code}${v.name ? ` (${v.name})` : ""}.`;
    }
}

type LayeredWrite = {
    characterRef: string;
    spec: LayeredSpec;
    entrance: EntranceInput;
    confirmSwitch: boolean;
    dryRun: boolean;
    /** What the call itself has to say (ignored files, renamed PSD tags...), placed before warnings. */
    notes?: string[];
    /** The PSD this stack came from, given the built appearance (so slots can name the final ids). */
    psdFingerprint?: (appearance: LayeredAppearance) => PsdFingerprint;
    /** Extra structured fields for the answer. */
    extra?: Record<string, unknown>;
    /**
     * Check everything that can refuse and write nothing, with the spec's image references standing
     * for images that do not exist yet and every layer taken to be `canvas` - a PSD's stack before its
     * layers are baked and imported, so a refusal comes before anything reaches the project.
     */
    preflight?: { canvas: PixelSize };
};

async function writeLayered(tool: Pick<AgentToolContext, "ctx" | "request" | "follow">, input: LayeredWrite): Promise<AgentCallResult> {
    const { ctx } = tool;
    const problems = checkLayeredSpec(input.spec);
    if (problems.length > 0) {
        throw refuse("invalid_args", `The stack does not hold together:\n${problems.map(line => `  ${line}`).join("\n")}`);
    }
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const character = findCharacter(cast, input.characterRef);
    const warnings: string[] = [];
    if (character && character.profile.appearance.getKind() !== "layered") {
        warnings.push(...await coldSwitchCheck(ctx, character, "layered", input.confirmSwitch));
    }
    const previous = character?.profile.appearance.toJSON() ?? null;

    const resolveImage = input.preflight
        ? (ref: string) => ref
        : (ref: string) => resolveAsset(ctx, ref, AssetType.Image).id;
    const result = buildLayeredAppearance(previous, input.spec, resolveImage, null);
    if ("errors" in result) {
        throw refuse("not_found", `Some images do not resolve:\n${result.errors.map(line => `  ${line}`).join("\n")}`, "Call assets_list for the names, or import the files with assets_import first.");
    }
    const { appearance, removedTagIds, placements } = result.built;

    // Measure every image once: the canvas check and the transparency warning read the same bytes.
    // A preflight has no images yet: every layer is the canvas it will be baked at.
    const facts = new Map<string, ImageFacts | null>();
    if (!input.preflight) {
        for (const { assetId } of placements) {
            if (!facts.has(assetId)) {
                facts.set(assetId, await readImageFacts(ctx, assetId));
            }
        }
    }
    const preflightCanvas = input.preflight?.canvas;
    const canvas = preflightCanvas
        ? { canvas: preflightCanvas, unmeasured: [] as string[] }
        : canvasFromSizes(placements, new Map([...facts].map(([id, fact]) => [id, fact?.size ?? null])));
    if ("error" in canvas) {
        throw refuse("check_failed", canvas.error, "Export every layer at the full canvas size (transparent where it draws nothing), re-import, and call again.");
    }
    if (canvas.unmeasured.length > 0) {
        warnings.push(`Could not measure ${canvas.unmeasured.length} image(s), so their size was not checked: ${canvas.unmeasured.slice(0, 8).join("; ")}.`);
    }
    appearance.canvas = canvas.canvas ?? appearance.canvas;
    for (const fact of facts.values()) {
        if (fact && fact.header.alpha === false) {
            warnings.push(opaqueImageWarning(fact.name, fact.header));
        }
    }
    if (input.psdFingerprint) {
        appearance.psd = input.psdFingerprint(appearance);
    }

    const diagnostics = collectCharacterDiagnostics(new CharacterAppearance(appearance));
    const errors = diagnostics.filter(item => item.severity === "error");
    if (errors.length > 0) {
        throw refuse("check_failed", `Studio's character check found ${errors.length} error(s):\n${errors.map(item => `  ${diagnosticText(item)}`).join("\n")}`);
    }
    warnings.push(...diagnostics.filter(item => item.severity === "warning").map(diagnosticText));
    if (input.preflight) {
        // Every refusal above has had its say; what follows only words the answer.
        return answerJson({ preflight: true });
    }

    // Scoped layers - a layer that draws nothing for some tags - are the model's idiom ("only the
    // casual outfit has a jacket"), and also exactly what a missing file looks like. Said, not refused.
    const scoped = appearance.layers.flatMap(layer => {
        const axis = appearance.axes.find(candidate => candidate.id === layer.axisId);
        if (!axis) return [];
        const empty = axis.tags.filter(tag => !layer.options?.[tag.id]).map(tag => tag.name);
        return empty.length > 0 ? [{ layer: layer.name, drawsNothingFor: empty }] : [];
    });

    if (character && removedTagIds.length > 0) {
        const { stories } = await loadAllStories(ctx);
        const rows = storyRowsChoosingLook(stories, character.profile.getId(), removedTagIds);
        if (rows.length > 0) {
            warnings.push(`${rows.length} story row(s) chose a tag this removes and now get the axis default; rewrite them:\n${formatReferrers(rows)}`);
        }
    }

    const created = !character;
    const draft = character ? Character.fromJSON(character.toJSON()) : cast.draftCharacter(input.characterRef, "layered");
    draft.profile.appearance.adopt(appearance);
    const previousCanvas = previous?.kind === "layered" ? previous.canvas : null;
    const artChanged = created || previous?.kind !== "layered"
        || previousCanvas?.width !== appearance.canvas?.width || previousCanvas?.height !== appearance.canvas?.height;
    const stage = stageSize(ctx);
    const entranceNote = applyEntrance(draft.profile, input.entrance, appearance.canvas, stage, artChanged, warnings);

    const notes = input.notes ?? [];
    const combinations = enumerateCombinations(new CharacterAppearance(appearance), 1).total;
    const record = draft.toJSON() as StoredCharacter;
    const name = draft.profile.getName();
    const structured = (live: Character) => ({
        created,
        character: describeCharacter(live, assetsService(ctx), stage, appearance.canvas ?? null),
        combinations,
        ...(scoped.length > 0 ? { scoped } : {}),
        ...(notes.length > 0 ? { notes } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(input.extra ?? {}),
    });
    if (input.dryRun) {
        return answerJson(
            { dryRun: true, ...structured(draft) },
            `Checked layered character "${name}": ${appearance.axes.length} axis/axes, ${appearance.layers.length} layer(s), ${combinations} look(s). Nothing written.`,
        );
    }
    // Measuring every image and reading the stories took a while; the author may have paused meanwhile.
    assertAgentMayStillWrite(tool);
    const changed = commitRecord(cast, record, created);
    const live = cast.getCharacter(record.profile.id) ?? draft;
    return answerJson(
        structured(live),
        `${created ? "Created" : changed ? "Updated" : "Nothing to change on"} layered character "${name}": ${appearance.axes.length} axis/axes, `
            + `${appearance.layers.length} layer(s), ${combinations} look(s).${entranceNote}${changed ? " One step of undo in Studio." : ""}`
            + `${warnings.length > 0 ? ` ${warnings.length} warning(s).` : ""}`,
    );
}

function readWriteOptions(args: Record<string, unknown>) {
    return {
        entrance: readEntrance(args),
        confirmSwitch: readOptionalBoolean(args, "confirmSwitch") === true,
        dryRun: readOptionalBoolean(args, "dryRun") === true,
    };
}

/**
 * What the status bar and the Agent log call the character a call names: its name. The argument may
 * be an id, which the interface never shows; a character that does not exist yet is called what the
 * call will name it, unless that is an id as well.
 */
export function characterLabel(ctx: WorkspaceContext, ref: string): string {
    const character = findCharacter(ctx.services.get<CharacterService>(Services.Character), ref);
    return character?.profile.getName() ?? authoredNameOrNull(ref) ?? "";
}

// ── character_layered_set ────────────────────────────────────────────────────────────────────────

export const characterLayeredSet: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const characterRef = readString(args, "character");
    const read = readLayeredSpec(args);
    if ("errors" in read) {
        throw refuse("invalid_args", read.errors.join("\n"));
    }
    follow.describeCall(request.callId, characterLabel(ctx, characterRef));
    return writeLayered({ ctx, request, follow }, { characterRef, spec: read.spec, ...readWriteOptions(args) });
};

// ── character_layers_import ──────────────────────────────────────────────────────────────────────

/** Image assets in the library folder called `folder` (any level). */
function imagesInFolder(ctx: WorkspaceContext, folder: string): Asset<AssetType, AssetSource>[] {
    const service = assetsService(ctx);
    const groups = service.getGroupAssetsManager().getGroups(categoryOfAssetType(AssetType.Image)).filter(group => group.name === folder);
    if (groups.length === 0) {
        throw refuse("not_found", `No image folder "${folder}".`, "assets_list shows each asset's folder.");
    }
    const ids = new Set(groups.map(group => group.id));
    return listAssets(ctx, [AssetType.Image]).filter(asset => asset.groupId && ids.has(asset.groupId));
}

function readStringMap(args: Record<string, unknown>, key: string): Record<string, string> | undefined {
    const raw = readOptionalRecord(args, key);
    if (!raw) return undefined;
    for (const [name, value] of Object.entries(raw)) {
        if (typeof value !== "string" || !value.trim()) {
            throw refuse("invalid_args", `\`${key}.${name}\` must be a name.`);
        }
    }
    return raw as Record<string, string>;
}

function readAxesMap(args: Record<string, unknown>): Record<string, string[]> | undefined {
    const raw = readOptionalRecord(args, "axes");
    if (!raw) return undefined;
    for (const [name, value] of Object.entries(raw)) {
        if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !item.trim())) {
            throw refuse("invalid_args", `\`axes.${name}\` must list the layers that axis drives.`);
        }
    }
    return raw as Record<string, string[]>;
}

export const characterLayersImport: AgentToolHandler = async (args, tool) => {
    const { ctx, request, follow } = tool;
    const characterRef = readString(args, "character");
    const psd = readOptionalString(args, "psd");
    const folder = readOptionalString(args, "folder");
    const assets = readOptionalStringArray(args, "assets");
    if (psd && (folder || assets)) {
        throw refuse("invalid_args", "Give either `psd` or images (`assets` / `folder`), not both.");
    }
    follow.describeCall(request.callId, characterLabel(ctx, characterRef));
    if (psd) {
        return importFromPsd(tool, characterRef, psd, args);
    }

    const cast = ctx.services.get<CharacterService>(Services.Character);
    const existing = findCharacter(cast, characterRef);
    const prefix = readOptionalString(args, "prefix") ?? existing?.profile.getName() ?? characterRef;
    const pool: NamedImage[] = assets
        ? assets.map(ref => resolveAsset(ctx, ref, AssetType.Image)).map(asset => ({ id: asset.id, name: asset.name }))
        : (folder ? imagesInFolder(ctx, folder) : listAssets(ctx, [AssetType.Image]))
            .map(asset => ({ id: asset.id, name: asset.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    const derived = layeredSpecFromNames(pool, {
        prefix,
        order: readOptionalStringArray(args, "order"),
        axes: readAxesMap(args),
        defaults: readStringMap(args, "defaults"),
    });
    if ("errors" in derived) {
        throw refuse(
            "invalid_args",
            derived.errors.join("\n"),
            derived.layersFound.length > 0
                ? `Layers found under "${prefix}_": ${derived.layersFound.join(", ")}. Files are named <prefix>_<layer> (always drawn) or <prefix>_<layer>_<tag>; a layer name has no "_".`
                : `Name the images <prefix>_<layer> or <prefix>_<layer>_<tag> (assets_import takes \`names\`), or pass \`prefix\`.`,
        );
    }
    const notes: string[] = [];
    if ((assets || folder) && derived.ignored.length > 0) {
        notes.push(`Ignored ${derived.ignored.length} image(s) not named "${prefix}_…": ${derived.ignored.slice(0, 10).join(", ")}.`);
    }
    return writeLayered(tool, {
        characterRef,
        spec: derived.spec,
        ...readWriteOptions(args),
        notes,
        extra: { derivedSpec: derived.spec },
    });
};

/**
 * A PSD plan in the agent's words: one axis and one layer per top-level group of two or more
 * layers, one fixed layer per ungrouped layer, in the PSD's stacking order. Names are made unique
 * where Photoshop let them repeat - two ungrouped "Layer 1"s, or a tag name in two groups (a story row
 * names a tag alone, so it may appear once) - and every rename is reported. Exported for its test.
 */
export function specFromPsdPlan(
    plan: ImportPlan,
    assetOf: (path: string[]) => string | null,
): { spec: LayeredSpec; renamed: string[]; tagPaths: Map<string, string[]>; layerPaths: Map<string, string[]> } {
    const renamed: string[] = [];
    const usedLayers = new Set<string>();
    const usedTags = new Set<string>();
    const tagPaths = new Map<string, string[]>();
    const layerPaths = new Map<string, string[]>();
    const unique = (wanted: string, used: Set<string>, fallback: (n: number) => string): string => {
        let name = wanted.trim() || "layer";
        for (let n = 2; used.has(name.toLowerCase()); n += 1) {
            name = fallback(n);
        }
        used.add(name.toLowerCase());
        return name;
    };
    const spec: LayeredSpec = { axes: [], layers: [] };
    for (const slot of plan.slots) {
        if (slot.kind === "constant") {
            const name = unique(slot.name, usedLayers, n => `${slot.name} ${n}`);
            if (name !== slot.name) renamed.push(`layer "${joinPath(slot.leaf.path)}" is "${name}"`);
            layerPaths.set(name.toLowerCase(), slot.leaf.path);
            spec.layers.push({ name, axis: null, asset: assetOf(slot.leaf.path) });
            continue;
        }
        const layerName = unique(slot.axis, usedLayers, n => `${slot.axis} ${n}`);
        const tags: string[] = [];
        const options: Record<string, string | null> = {};
        for (const option of slot.options) {
            const tag = unique(option.tag, usedTags, n => (n === 2 ? `${slot.axis}-${option.tag}` : `${slot.axis}-${option.tag}-${n}`));
            if (tag !== option.tag) renamed.push(`tag "${joinPath(option.leaf.path)}" is "${tag}"`);
            tags.push(tag);
            options[tag] = assetOf(option.leaf.path);
            tagPaths.set(`${layerName.toLowerCase()}/${tag.toLowerCase()}`, option.leaf.path);
        }
        spec.axes.push({ name: layerName, tags });
        spec.layers.push({ name: layerName, axis: layerName, options });
    }
    return { spec, renamed, tagPaths, layerPaths };
}

async function importFromPsd(tool: AgentToolContext, characterRef: string, psdPath: string, args: Record<string, unknown>): Promise<AgentCallResult> {
    const { ctx } = tool;
    await ensureAgentMayReadPaths([psdPath], tool);
    const read = await getInterface().readPsd(psdPath);
    if (!read.success) {
        throw refuse("unavailable", `Could not read the PSD: ${read.error ?? "unknown error"}.`);
    }
    const document: PsdDocument = read.data.document;
    const leaves = flattenLeaves(document.layers);

    // Every layer whose blend mode the stage cannot draw has to be decided - merged down onto the
    // layer below, or left out - exactly as the import wizard insists. No default: a default would be
    // a choice made for the author that nobody saw.
    const decisions = readOptionalRecord(args, "blendModes") ?? {};
    const resolutions: Record<string, BlendResolution> = {};
    const undecided: string[] = [];
    const unmergeable: string[] = [];
    for (const leaf of unsupportedBlends(leaves)) {
        const key = joinPath(leaf.path);
        const choice = decisions[key];
        if (choice !== "merge" && choice !== "skip") {
            undecided.push(`"${key}" (${leaf.blendMode}${canMergeBlendMode(leaf.blendMode) ? "" : ", skip only"})`);
            continue;
        }
        if (choice === "merge" && !canMergeBlendMode(leaf.blendMode)) {
            unmergeable.push(`"${key}" (${leaf.blendMode})`);
            continue;
        }
        resolutions[key] = choice;
    }
    if (undecided.length > 0 || unmergeable.length > 0) {
        throw refuse(
            "invalid_args",
            [
                undecided.length > 0 ? `These layers use a blend mode the stage cannot draw; decide each: ${undecided.join(", ")}.` : "",
                unmergeable.length > 0 ? `These cannot be merged faithfully and can only be skipped: ${unmergeable.join(", ")}.` : "",
            ].filter(Boolean).join("\n"),
            "Pass `blendModes: { \"<group>/<layer>\": \"merge\" | \"skip\" }`. merge flattens it onto the layer below (what Photoshop shows); skip leaves it out. Ask the author when unsure.",
        );
    }
    const plan = planImport(leaves, resolutions);
    if (plan.slots.length === 0) {
        throw refuse("unavailable", "Nothing in this PSD would become a layer (every layer is hidden or skipped).");
    }
    const dropped = plan.dropped.map(entry => `${joinPath(entry.leaf.path)} (${entry.reason})`);
    const options = readWriteOptions(args);
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const name = findCharacter(cast, characterRef)?.profile.getName() ?? characterRef;

    if (options.dryRun) {
        // Nothing is baked on a dry run, so there are no assets yet: answer with the plan alone.
        const { spec, renamed } = specFromPsdPlan(plan, () => "(baked on import)");
        return answerJson(
            { dryRun: true, canvas: { width: document.width, height: document.height }, plan: spec, ...(renamed.length > 0 ? { renamed } : {}), ...(dropped.length > 0 ? { dropped } : {}) },
            `"${document.fileName}" would become ${spec.axes.length} axis/axes and ${spec.layers.length} layer(s) for "${name}". Nothing baked or written.`,
        );
    }

    // Everything that can refuse is checked before a layer is baked or imported, against stand-ins
    // for the images: a refusal after the import would leave the layer images in the project.
    const standIns = specFromPsdPlan(plan, path => `psd:${joinPath(path)}`);
    await writeLayered(tool, {
        characterRef,
        spec: standIns.spec,
        ...options,
        psdFingerprint: () => ({ fileName: document.fileName, width: document.width, height: document.height, slots: [], importedAt: 0 }),
        preflight: { canvas: { width: document.width, height: document.height } },
    });

    const targets = nameBakeTargets(toBakeTargets(plan), plan, name);
    const baked = await getInterface().bakePsd({ filePath: psdPath, layers: targets });
    if (!baked.success) {
        throw refuse("unavailable", `Could not bake the PSD's layers: ${baked.error ?? "unknown error"}.`);
    }
    // Baking took a while, and importing is the first write to the project.
    assertAgentMayStillWrite(tool, "Nothing was imported or written.");
    const imported = await assetsService(ctx).importFromPaths(AssetType.Image, baked.data.layers.map(layer => layer.filePath));
    if (!imported.success) {
        throw refuse("internal", `The layers were baked but could not be imported: ${imported.error ?? "unknown error"}.`);
    }
    const assetIds = new Map<string, string>();
    baked.data.layers.forEach((layer, index) => {
        const status = imported.data[index];
        if (status?.success && status.data) {
            assetIds.set(joinPath(layer.path), status.data.id);
        }
    });
    const { spec, renamed, tagPaths, layerPaths } = specFromPsdPlan(plan, path => assetIds.get(joinPath(path)) ?? null);
    const notes = [
        `Imported ${assetIds.size} layer image(s) from "${document.fileName}".`,
        ...(renamed.length > 0 ? [`Renamed to keep names unique: ${renamed.join("; ")}.`] : []),
        ...(dropped.length > 0 ? [`Left out: ${dropped.join(", ")}.`] : []),
    ];
    const fingerprint = (appearance: LayeredAppearance): PsdFingerprint => {
        const slots: PsdFingerprintSlot[] = [];
        for (const layer of appearance.layers) {
            const axis = appearance.axes.find(candidate => candidate.id === layer.axisId);
            if (!axis) {
                const path = layerPaths.get(layer.name.toLowerCase());
                if (path) slots.push({ path, layerId: layer.id });
                continue;
            }
            for (const tag of axis.tags) {
                const path = tagPaths.get(`${layer.name.toLowerCase()}/${tag.name.toLowerCase()}`);
                if (path) slots.push({ path, layerId: layer.id, tagId: tag.id });
            }
        }
        return { fileName: document.fileName, width: document.width, height: document.height, slots, importedAt: Date.now() };
    };
    try {
        return await writeLayered(tool, { characterRef, spec, ...options, notes, psdFingerprint: fingerprint });
    } catch (error) {
        // Checked before the import, so only what changed since can land here - a layer that failed
        // to import, the author pausing. Said plainly: the layer images are in the project now.
        if (error instanceof AgentRefusal && assetIds.size > 0) {
            throw refuse(
                error.code,
                `${error.message}\nThe character was not written, but ${assetIds.size} layer image(s) from "${document.fileName}" were already imported and stay in the project.`,
                `Call character_layers_import again with \`prefix: "${name}"\` (not \`psd\`) to build the stack from them, or delete them with asset_delete.`,
            );
        }
        throw error;
    }
}

// ── character_preview ────────────────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

/** The asset's pixels as a bitmap, or null when it is gone or will not decode. */
async function decodeImage(ctx: WorkspaceContext, assetId: string): Promise<ImageBitmap | null> {
    const service = assetsService(ctx);
    const asset = service.getAssets()[AssetType.Image]?.[assetId];
    if (!asset) return null;
    const fetched = await service.fetch(asset).catch(() => null);
    if (!fetched || !fetched.success || !fetched.data) return null;
    return createImageBitmap(new Blob([new Uint8Array((fetched.data as { data: Uint8Array }).data)])).catch(() => null);
}

export const characterPreview: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "character");
    const maxSize = readOptionalInteger(args, "maxSize", { min: 64, max: 2048 }) ?? 768;
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const character = findCharacter(cast, ref);
    if (!character) {
        throw refuse("not_found", `No character "${ref}".`, "Call characters_list for the names and ids.");
    }
    const name = character.profile.getName();
    follow.describeCall(request.callId, name);
    const appearance = character.profile.appearance;
    const stored = appearance.toJSON();

    let selection: { poseId?: string | null; tags?: Record<string, string> | null };
    let lookLabel: string;
    if (stored.kind === "preset") {
        const poseName = readOptionalString(args, "pose");
        const pose = poseName ? appearance.getPoses().find(item => item.name === poseName || item.id === poseName) : null;
        if (poseName && !pose) {
            throw refuse("not_found", `"${name}" has no pose "${poseName}" (poses: ${appearance.getPoses().map(item => item.name).join(", ") || "none"}).`);
        }
        selection = { poseId: pose?.id ?? appearance.getDefaultPoseId() };
        lookLabel = appearance.getPose(selection.poseId ?? "")?.name ?? "(no pose)";
    } else if (stored.kind === "layered") {
        const raw = args.look;
        let partial: Record<string, string> = {};
        if (raw !== undefined && raw !== null) {
            if (!(Array.isArray(raw) && raw.every(item => typeof item === "string"))
                && !(typeof raw === "object" && !Array.isArray(raw) && Object.values(raw).every(item => typeof item === "string"))) {
                throw refuse("invalid_args", "`look` is { axis: tag } or a list of tag names.");
            }
            const chosen = selectionByName(stored, raw as Record<string, string> | string[]);
            if ("errors" in chosen) {
                throw refuse("not_found", chosen.errors.join(" "), "characters_list shows each axis and its tags.");
            }
            partial = chosen.tags;
        }
        const tags = appearance.resolveTagSelection(partial);
        selection = { tags };
        lookLabel = stored.axes
            .map(axis => `${axis.name}=${axis.tags.find(tag => tag.id === tags[axis.id])?.name ?? "-"}${partial[axis.id] ? "" : " (default)"}`)
            .join(", ");
    } else {
        throw refuse(
            "unavailable",
            `"${name}" is drawn by a ${stored.kind} runtime, which only runs inside the game.`,
            "Show it on a story row and use playtest_start + playtest_screenshot to see it.",
        );
    }

    const drawList = appearance.resolveDrawList(selection);
    const drawn = (await Promise.all(drawList.map(assetId => (assetId ? decodeImage(ctx, assetId) : Promise.resolve(null)))));
    const bitmaps = drawn.filter((bitmap): bitmap is ImageBitmap => bitmap !== null);
    if (bitmaps.length === 0) {
        throw refuse("unavailable", `"${name}" draws nothing for ${lookLabel}.`, stored.kind === "layered" ? "Every layer is empty for this look; give one of them an image for these tags." : undefined);
    }
    const blob = await drawStack(bitmaps, maxSize);
    if (!blob) {
        throw refuse("internal", "The look could not be composited (no 2D canvas).");
    }
    const png = toBase64(new Uint8Array(await blob.arrayBuffer()));
    const width = Math.max(...bitmaps.map(bitmap => bitmap.width));
    const height = Math.max(...bitmaps.map(bitmap => bitmap.height));
    bitmaps.forEach(bitmap => bitmap.close());
    const layerReport = stored.kind === "layered"
        ? stored.layers.map((layer, index) => `${layer.name}${drawList[index] ? "" : " (nothing)"}`)
        : [];
    const missing = drawList.filter((assetId, index) => assetId && !drawn[index]).length;
    const text = [
        `"${name}" - ${lookLabel}: ${width}x${height} artwork, shown at most ${maxSize}px.`,
        layerReport.length > 0 ? `Layers bottom to top: ${layerReport.join(", ")}.` : "",
        missing > 0 ? `${missing} image(s) could not be read and are missing from the picture.` : "",
        "Transparent areas show the stage behind; the picture is the sprite alone, not placed on the stage.",
    ].filter(Boolean).join(" ");
    return {
        ok: true,
        content: [
            { type: "image", mimeType: "image/png", data: png },
            { type: "text", text },
        ],
        structured: { character: { id: character.profile.getId(), name }, look: lookLabel, size: { width, height } },
    };
};
