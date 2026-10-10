/**
 * `voice_status`, `voice_list`, `voice_link`, `voice_auto_link`, `voice_settings_set`: wiring
 * voice-over.
 *
 * Studio never records: a voiced line is *linked* to an audio asset already in the library, and a
 * director *approves* the take. Everything here goes through `VoiceService`, the store the voice
 * table and the Voice panel edit, and the lines, their `{index}` and their speakers are the ones the
 * recording script and the table's Assign picker are built from (`collectAgentVoiceLines`). Matching
 * a file to a line is the panel's own judgement - the recording rule's name for the line, reduced by
 * `matchKeyForFilename`, against each audio asset's library name (`buildAssetNameKeyMap`); a name two
 * lines or two assets share is never guessed at.
 *
 * Every write is one operation (`VoiceService.setUnits`) and one step of undo on the project's
 * stack, however many takes it links. Voice languages are the project's own list, independent of the
 * game's text languages: a game may be dubbed into a language it is not translated into.
 *
 * Comments in English per project convention.
 */

import type { VoiceConfiguration, VoiceDocument, VoiceUnit, VoiceUnitStatus } from "@shared/types/voice";
import { isValidLocaleCode, localeAutonym } from "@shared/types/localization";
import { hashSourceText } from "@shared/utils/localizationText";
import { matchKeyForFilename, VOICE_NAME_TOKENS } from "@shared/utils/voiceNaming";
import { Services, type WorkspaceContext } from "../../services";
import type { HistoryService } from "../../history/HistoryService";
import { projectHistoryScope } from "../../history/historyScopes";
import type { VoiceService } from "../../voice/VoiceService";
import { deriveVoiceUnitState, type VoiceUnitState } from "../../voice/voiceModel";
import { buildAssetNameKeyMap } from "../../voice/voiceScript";
import { readAudioDuration } from "../../voice/audioDuration";
import { AssetType, categoryOfAssetType } from "../../assets/assetTypes";
import type { Asset, AssetSource } from "../../assets/types";
import {
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalString,
    readOptionalStringArray,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { AGENT_HISTORY_LABEL, assetsService, stripExtension } from "../agentLookups";
import { assertAgentMayStillWrite } from "../agentCommitGate";
import {
    collectAgentVoiceLines,
    compactListText,
    pageOf,
    readCursor,
    resolveSceneScope,
    type AgentVoiceLine,
} from "../translationUnits";

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_BATCH = 1000;
/** How many of each kind of auto-link finding are spelled out; the counts are always whole. */
const REPORT_CAP = 60;

function voiceService(ctx: WorkspaceContext): VoiceService {
    return ctx.services.get<VoiceService>(Services.Voice);
}

/** The voice language a call names, its display name and its loaded take library. */
async function resolveVoiceLanguage(ctx: WorkspaceContext, code: string): Promise<{ code: string; name: string; document: VoiceDocument }> {
    const service = voiceService(ctx);
    const config = service.getConfiguration();
    const entry = config.voicedLocales.find(locale => locale.code === code);
    if (!entry) {
        throw refuse(
            "not_found",
            config.voicedLocales.length > 0
                ? `The game has no voice language "${code}"; it is voiced in ${config.voicedLocales.map(locale => locale.code).join(", ")}.`
                : `The game has no voice language yet, so not "${code}" either.`,
            "Add one with voice_settings_set {languages}. Voice languages are separate from the game's text languages.",
        );
    }
    let document: VoiceDocument;
    try {
        document = await service.loadDocument(code);
    } catch (error) {
        throw refuse("unavailable", error instanceof Error ? error.message : String(error));
    }
    return { code, name: entry.displayName || code, document };
}

type AudioAsset = Asset<AssetType, AssetSource>;

function audioAssets(ctx: WorkspaceContext): AudioAsset[] {
    return Object.values(assetsService(ctx).getAssets()[AssetType.Audio] ?? {}) as AudioAsset[];
}

/** The state a voice tool names: the table's own four. */
function lineState(document: VoiceDocument, line: AgentVoiceLine): VoiceUnitState {
    return deriveVoiceUnitState(document.units[line.unitId], line.text);
}

/** The recording rule in words, for the answers that hand it to an agent naming files. */
function describeNamingRule(pattern: string): string {
    return `Each line's take is the audio file named \`${pattern}\` (any extension): {scene} is the scene name, {index} the line's 1-based position among the voiced lines of its scene, zero-padded to 3, {character} the speaker (narration and choice lines have a label of their own), {locale} the voice language, {unit} the line's unit id. Matching ignores case, spaces, punctuation and folders, and is against the asset's name in the library. voice_list gives every line's exact name as \`expect\`.`;
}

// ── voice_status ─────────────────────────────────────────────────────────────────────────────────

type VoiceCoverage = { total: number; covered: number; approved: number; stale: number; missing: number };

function emptyCoverage(): VoiceCoverage {
    return { total: 0, covered: 0, approved: 0, stale: 0, missing: 0 };
}

function countState(coverage: VoiceCoverage, state: VoiceUnitState): void {
    coverage.total += 1;
    if (state === "missing") {
        coverage.missing += 1;
    } else if (state === "stale") {
        coverage.stale += 1;
    } else {
        coverage.covered += 1;
        if (state === "approved") {
            coverage.approved += 1;
        }
    }
}

export const voiceStatus: AgentToolHandler = async (args, { ctx }) => {
    const only = readOptionalString(args, "language");
    const service = voiceService(ctx);
    const config = service.getConfiguration();
    const base = {
        namingPattern: config.namingPattern,
        namingRule: describeNamingRule(config.namingPattern),
        voiceChoices: config.voiceChoices,
    };
    if (config.voicedLocales.length === 0) {
        const structured = { languages: [], ...base };
        return {
            ok: true,
            content: [{ type: "text", text: `The game is not voiced yet. Add a voice language with voice_settings_set {languages: ["ja"]} - it need not be one of the game's text languages.\n${JSON.stringify(structured)}` }],
            structured,
        };
    }
    if (only !== undefined) {
        await resolveVoiceLanguage(ctx, only);
    }
    const languages = [];
    for (const locale of config.voicedLocales.filter(entry => !only || entry.code === only)) {
        const document = await service.loadDocument(locale.code).catch(() => null);
        if (!document) {
            languages.push({ code: locale.code, name: locale.displayName, unreadable: true });
            continue;
        }
        const lines = await collectAgentVoiceLines(ctx, locale.code);
        const total = emptyCoverage();
        const byCharacter = new Map<string, VoiceCoverage & { character: string; actor?: string }>();
        for (const line of lines) {
            const state = lineState(document, line);
            countState(total, state);
            const key = line.characterId ?? `label:${line.speaker}`;
            const actor = line.characterId ? config.cast[line.characterId]?.[locale.code] : undefined;
            const entry = byCharacter.get(key) ?? { character: line.speaker, ...(actor ? { actor } : {}), ...emptyCoverage() };
            countState(entry, state);
            byCharacter.set(key, entry);
        }
        languages.push({
            code: locale.code,
            name: locale.displayName,
            ...total,
            ...(lines[0] ? { example: { line: lines[0].where, expect: lines[0].expectedName } } : {}),
            byCharacter: [...byCharacter.values()],
        });
    }
    const structured = { languages, ...base };
    const lead = "`covered` = linked or approved and current; `stale` = the line changed after its take was linked; `missing` = no take.";
    return { ok: true, content: [{ type: "text", text: compactListText(lead, structured, "languages") }], structured };
};

// ── voice_list ───────────────────────────────────────────────────────────────────────────────────

const LIST_STATUSES = ["missing", "linked", "approved", "stale", "todo"] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

function matchesCharacter(line: AgentVoiceLine, ref: string): boolean {
    return line.characterId === ref || line.speaker.toLowerCase() === ref.toLowerCase();
}

export const voiceList: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const { code, name, document } = await resolveVoiceLanguage(ctx, readString(args, "language"));
    follow.describeCall(request.callId, name);
    const status = readOptionalString(args, "status") as ListStatus | undefined;
    if (status && !LIST_STATUSES.includes(status)) {
        throw refuse("invalid_args", `\`status\` must be one of ${LIST_STATUSES.join(", ")}.`);
    }
    const unlinkedOnly = readOptionalBoolean(args, "unlinkedOnly") ?? false;
    const character = readOptionalString(args, "character");
    const query = readOptionalString(args, "query")?.toLowerCase();
    const scope = await resolveSceneScope(ctx, readOptionalString(args, "story"), readOptionalString(args, "scene"));
    const offset = readCursor(readOptionalString(args, "cursor"));
    const limit = readOptionalInteger(args, "limit", { min: 1, max: MAX_LIST_LIMIT }) ?? DEFAULT_LIST_LIMIT;

    const lines = await collectAgentVoiceLines(ctx, code);
    const assets = new Map(audioAssets(ctx).map(asset => [asset.id, asset]));
    const matched = lines.filter(line => {
        if (scope.storyId && line.storyId !== scope.storyId) {
            return false;
        }
        if (scope.sceneId && line.sceneId !== scope.sceneId) {
            return false;
        }
        if (character && !matchesCharacter(line, character)) {
            return false;
        }
        const state = lineState(document, line);
        if (unlinkedOnly && state !== "missing") {
            return false;
        }
        if (status && (status === "todo" ? state !== "missing" && state !== "stale" : state !== status)) {
            return false;
        }
        if (query && !line.text.toLowerCase().includes(query) && !line.expectedName.toLowerCase().includes(query)) {
            return false;
        }
        return true;
    });
    if (character && !lines.some(line => matchesCharacter(line, character))) {
        throw refuse("not_found", `No voiced line is spoken by "${character}".`, "Use a character name or id from characters_list, or the narration label voice_status shows.");
    }
    const { page, nextCursor } = pageOf(matched, offset, limit);
    const rows = page.map(line => {
        const unit = document.units[line.unitId];
        const asset = unit ? assets.get(unit.assetId) : undefined;
        return {
            id: line.unitId,
            where: line.where,
            speaker: line.speaker,
            text: line.text,
            expect: line.expectedName,
            ...(unit ? { take: { asset: unit.assetId, name: asset?.name ?? null } } : {}),
            status: lineState(document, line),
            ...(unit?.duration !== undefined ? { seconds: Math.round(unit.duration * 10) / 10 } : {}),
            ...(unit?.note ? { note: unit.note } : {}),
        };
    });
    const structured = { language: code, total: matched.length, from: offset, nextCursor, lines: rows };
    const lead = matched.length === 0
        ? `No voiced line matches in ${name}.`
        : `${rows.length} of ${matched.length} line(s) in ${name}${nextCursor ? `; pass cursor "${nextCursor}" for the next page` : ""}. \`expect\` is the file name the recording rule gives the line; a take named so is linked by voice_auto_link.`
            + (rows.some(row => row.take?.name === null) ? " A take whose `name` is null points at an audio asset no longer in the library." : "");
    return { ok: true, content: [{ type: "text", text: compactListText(lead, structured, "lines") }], structured };
};

// ── Writing takes ────────────────────────────────────────────────────────────────────────────────

/** How long each newly linked clip is, best-effort and bounded: a duration the table shows, not a gate. */
async function measureDurations(ctx: WorkspaceContext, assets: readonly AudioAsset[]): Promise<Map<string, number>> {
    const durations = new Map<string, number>();
    if (typeof Audio !== "function" || assets.length === 0) {
        return durations;
    }
    const service = assetsService(ctx);
    const queue = [...new Map(assets.map(asset => [asset.id, asset])).values()].slice(0, 400);
    const worker = async () => {
        for (let asset = queue.shift(); asset; asset = queue.shift()) {
            try {
                const fetched = await service.fetch(asset);
                if (!fetched.success) {
                    continue;
                }
                const duration = await readAudioDuration(new Uint8Array((fetched.data as unknown as { data: Uint8Array }).data));
                if (duration !== undefined) {
                    durations.set(asset.id, duration);
                }
            } catch {
                // A clip that will not decode keeps no duration, as in the panel's import.
            }
        }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return durations;
}

/**
 * Write a batch of takes as one operation and one step of undo, and point follow mode at the first.
 * `after` holds what each line's take becomes (null = unlinked); the takes as they were are read here.
 */
function commitTakes(
    ctx: WorkspaceContext,
    tool: Parameters<AgentToolHandler>[1],
    language: { code: string; name: string; document: VoiceDocument },
    after: ReadonlyMap<string, VoiceUnit | null>,
    lines: ReadonlyMap<string, AgentVoiceLine>,
): void {
    if (after.size === 0) {
        return;
    }
    // Measuring the clips can take a while; the author may have paused or frozen meanwhile.
    assertAgentMayStillWrite(tool);
    const service = voiceService(ctx);
    const current = service.getDocumentIfLoaded(language.code) ?? language.document;
    const before = [...after.keys()].map(unitId => {
        const existing = current.units[unitId];
        return { unitId, unit: existing ? { ...existing } : null };
    });
    const forward = [...after.entries()].map(([unitId, unit]) => ({ unitId, unit }));
    service.setUnits(language.code, forward);
    ctx.services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
        label: AGENT_HISTORY_LABEL,
        undo: () => service.setUnits(language.code, before),
        redo: () => service.setUnits(language.code, forward),
    });
    tool.log("info", `${language.code}: ${after.size} take(s) written`);
    const first = lines.get(forward[0].unitId);
    tool.follow.noteWrite({
        kind: "voice",
        locale: language.code,
        unitId: forward[0].unitId,
        ...(first ? { storyId: first.storyId } : {}),
        name: first ? `${language.name} · ${first.sceneName}` : language.name,
    });
}

/** The take a link leaves: the panel's rules (`VoiceService.updateUnit`) with one difference - see below. */
export function takeAfterLink(
    existing: VoiceUnit | undefined,
    lineText: string,
    link: { assetId?: string; status?: VoiceUnitStatus; note?: string },
    duration: number | undefined,
): VoiceUnit | null {
    // Naming the take the line already has is not a new take: its hash and sign-off stay. The table
    // cannot ask this (a re-pick there is always a new file), but an agent re-sending a batch can, and
    // re-stamping would silently clear a "stale" the line still deserves.
    const relinking = link.assetId !== undefined && link.assetId !== existing?.assetId;
    const assetId = link.assetId !== undefined ? link.assetId : existing?.assetId ?? "";
    if (!assetId) {
        return null;
    }
    const note = link.note !== undefined ? (link.note.trim() ? link.note : undefined) : existing?.note;
    const kept = relinking ? undefined : existing;
    const measured = relinking ? duration : kept?.duration;
    return {
        assetId,
        sourceHash: kept?.sourceHash ?? hashSourceText(lineText),
        status: link.status ?? (relinking ? "linked" : existing?.status ?? "linked"),
        ...(measured !== undefined ? { duration: measured } : {}),
        ...(note ? { note } : {}),
    };
}

function sameTake(a: VoiceUnit | undefined, b: VoiceUnit | null): boolean {
    if (!a || !b) {
        return !a && !b;
    }
    return a.assetId === b.assetId && a.status === b.status && a.sourceHash === b.sourceHash
        && (a.note ?? "") === (b.note ?? "") && a.duration === b.duration;
}

/** An audio asset by id, or by its library name (with or without extension); why not, otherwise. */
function findAudio(pool: readonly AudioAsset[], ref: string): AudioAsset | "unknown" | "ambiguous" {
    const byId = pool.find(asset => asset.id === ref);
    if (byId) {
        return byId;
    }
    const named = pool.filter(asset => asset.name === ref || stripExtension(asset.name) === ref);
    if (named.length > 1) {
        return "ambiguous";
    }
    return named[0] ?? "unknown";
}

// ── voice_link ───────────────────────────────────────────────────────────────────────────────────

type LinkEntry = { unitId: string; asset?: string; status?: VoiceUnitStatus; note?: string };

function readLinks(args: Record<string, unknown>): LinkEntry[] {
    const raw = args.links;
    if (!Array.isArray(raw) || raw.length === 0) {
        throw refuse("invalid_args", "`links` must be a non-empty array of {unitId, asset}.");
    }
    if (raw.length > MAX_BATCH) {
        throw refuse("invalid_args", `At most ${MAX_BATCH} links per call; split the batch.`);
    }
    const seen = new Set<string>();
    return raw.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw refuse("invalid_args", `links[${index}] must be an object {unitId, asset}.`);
        }
        const record = item as Record<string, unknown>;
        const unitId = typeof record.unitId === "string" ? record.unitId.trim() : "";
        if (!unitId) {
            throw refuse("invalid_args", `links[${index}].unitId must be a line id from voice_list.`);
        }
        if (seen.has(unitId)) {
            throw refuse("invalid_args", `links name ${unitId} twice.`);
        }
        seen.add(unitId);
        if (record.asset !== undefined && record.asset !== null && typeof record.asset !== "string") {
            throw refuse("invalid_args", `links[${index}].asset must be an audio asset's id or name ("" unlinks).`);
        }
        if (record.status !== undefined && record.status !== "linked" && record.status !== "approved") {
            throw refuse("invalid_args", `links[${index}].status must be linked or approved.`);
        }
        if (record.note !== undefined && typeof record.note !== "string") {
            throw refuse("invalid_args", `links[${index}].note must be a string.`);
        }
        if (record.asset === undefined && record.status === undefined && record.note === undefined) {
            throw refuse("invalid_args", `links[${index}] changes nothing: give an asset, a status or a note.`);
        }
        return {
            unitId,
            ...(typeof record.asset === "string" ? { asset: record.asset.trim() } : record.asset === null ? { asset: "" } : {}),
            ...(record.status !== undefined ? { status: record.status as VoiceUnitStatus } : {}),
            ...(record.note !== undefined ? { note: record.note as string } : {}),
        };
    });
}

export const voiceLink: AgentToolHandler = async (args, tool) => {
    const { ctx, request, follow } = tool;
    const language = await resolveVoiceLanguage(ctx, readString(args, "language"));
    follow.describeCall(request.callId, language.name);
    const links = readLinks(args);
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;

    const lines = new Map((await collectAgentVoiceLines(ctx, language.code)).map(line => [line.unitId, line]));
    const pool = audioAssets(ctx);
    const problems: string[] = [];
    const resolved: { link: LinkEntry; line: AgentVoiceLine; asset?: AudioAsset | null }[] = [];
    for (const link of links) {
        const line = lines.get(link.unitId);
        if (!line) {
            problems.push(`${link.unitId}: not a voiced line of this game`);
            continue;
        }
        if (link.asset === undefined) {
            if (!language.document.units[link.unitId]) {
                problems.push(`${link.unitId} (${line.where}): has no take to ${link.status === "approved" ? "approve" : "annotate"} - give \`asset\``);
                continue;
            }
            resolved.push({ link, line });
            continue;
        }
        if (link.asset === "") {
            resolved.push({ link, line, asset: null });
            continue;
        }
        const asset = findAudio(pool, link.asset);
        if (asset === "unknown") {
            problems.push(`${link.unitId}: no audio asset "${link.asset}"`);
        } else if (asset === "ambiguous") {
            problems.push(`${link.unitId}: several audio assets are called "${link.asset}" - name it by id`);
        } else {
            resolved.push({ link, line, asset });
        }
    }
    if (problems.length > 0) {
        throw refuse(
            "not_found",
            `Nothing was written; ${problems.length} link(s) cannot be made:\n${problems.slice(0, 40).join("\n")}${problems.length > 40 ? "\n…" : ""}`,
            "Take line ids from voice_list and audio assets from assets_list (type audio); import missing files with assets_import first.",
        );
    }

    const newlyLinked = resolved.filter(item => item.asset && item.asset.id !== language.document.units[item.line.unitId]?.assetId);
    const durations = dryRun ? new Map<string, number>() : await measureDurations(ctx, newlyLinked.map(item => item.asset!));
    // Read again after the clips were measured: the author may have linked something meanwhile.
    const current = voiceService(ctx).getDocumentIfLoaded(language.code) ?? language.document;
    const after = new Map<string, VoiceUnit | null>();
    let unchanged = 0;
    for (const { link, line, asset } of resolved) {
        const existing = current.units[line.unitId];
        const next = takeAfterLink(
            existing,
            line.text,
            { ...(asset !== undefined ? { assetId: asset ? asset.id : "" } : {}), ...(link.status ? { status: link.status } : {}), ...(link.note !== undefined ? { note: link.note } : {}) },
            asset ? durations.get(asset.id) : undefined,
        );
        if (sameTake(existing, next)) {
            unchanged += 1;
            continue;
        }
        after.set(line.unitId, next);
    }
    if (!dryRun) {
        commitTakes(ctx, tool, language, after, lines);
    }
    const unlinked = [...after.values()].filter(unit => unit === null).length;
    const structured = { language: language.code, written: after.size, unlinked, unchanged, dryRun };
    const text = `${dryRun ? `Dry run: ${after.size} take(s) would change` : `Wrote ${after.size} take(s)`} in ${language.name}`
        + `${unlinked > 0 ? ` (${unlinked} unlinked)` : ""}${unchanged > 0 ? `; ${unchanged} already so` : ""}.`
        + `${!dryRun && after.size > 0 ? " One step of undo in Studio." : ""}`;
    return { ok: true, content: [{ type: "text", text }], structured };
};

// ── voice_auto_link ──────────────────────────────────────────────────────────────────────────────

/** Whether an asset sits in the folder called `folder`, or in a folder inside it. */
function inFolder(ctx: WorkspaceContext, asset: AudioAsset, folder: string): boolean {
    if (!asset.groupId) {
        return false;
    }
    const groups = assetsService(ctx).getGroupAssetsManager().getGroups(categoryOfAssetType(asset.type));
    const byId = new Map(groups.map(group => [group.id, group]));
    const wanted = folder.toLowerCase();
    const seen = new Set<string>();
    for (let group = byId.get(asset.groupId); group && !seen.has(group.id); group = group.parentGroupId ? byId.get(group.parentGroupId) : undefined) {
        seen.add(group.id);
        if (group.name.toLowerCase() === wanted) {
            return true;
        }
    }
    return false;
}

export type AutoLinkPlan = {
    /** Lines in scope that a single asset matches, and that asset. */
    matched: { line: AgentVoiceLine; asset: { id: string; name: string } }[];
    /** Lines whose take is already the matching asset. */
    alreadyLinked: number;
    /** Lines with a different take than the matching asset, left alone unless `relink`. */
    keptOtherTake: { line: AgentVoiceLine; current: string; candidate: { id: string; name: string } }[];
    /** A name several assets share, or a name the rule gives several lines: never guessed at. */
    ambiguous: { expect: string; lines: AgentVoiceLine[]; assets: { id: string; name: string }[] }[];
    /** Lines in scope with no take and no asset of their name. */
    missing: AgentVoiceLine[];
    /** Candidate assets whose name is no line's. */
    unmatchedAssets: { id: string; name: string }[];
};

/**
 * Pair lines with assets by name - the decision `voice_auto_link` writes, kept pure so the matching
 * is tested apart from the services.
 *
 * Keys are the panel's (`matchKeyForFilename` over the rule's name and over each asset's library
 * name), and ambiguity is judged over the whole game rather than the scope: a name the rule gives a
 * line in another scene too is a name no file can be told apart by, even when only one of the two
 * lines was asked about.
 */
export function planAutoLink(
    allLines: readonly AgentVoiceLine[],
    scope: (line: AgentVoiceLine) => boolean,
    candidates: readonly { id: string; name: string }[],
    takes: Readonly<Record<string, VoiceUnit>>,
    relink: boolean,
): AutoLinkPlan {
    const assetsByKey = new Map<string, { id: string; name: string }[]>();
    for (const asset of candidates) {
        const key = matchKeyForFilename(asset.name);
        if (key) {
            assetsByKey.set(key, [...(assetsByKey.get(key) ?? []), asset]);
        }
    }
    // The panel's own map, for the unambiguous half: the same answer the Assign picker preselects.
    const unique = buildAssetNameKeyMap(candidates);
    const linesByKey = new Map<string, AgentVoiceLine[]>();
    for (const line of allLines) {
        if (line.matchKey) {
            linesByKey.set(line.matchKey, [...(linesByKey.get(line.matchKey) ?? []), line]);
        }
    }
    const plan: AutoLinkPlan = { matched: [], alreadyLinked: 0, keptOtherTake: [], ambiguous: [], missing: [], unmatchedAssets: [] };
    const reportedAmbiguous = new Set<string>();
    for (const line of allLines) {
        if (!scope(line)) {
            continue;
        }
        const assets = assetsByKey.get(line.matchKey) ?? [];
        const sharing = linesByKey.get(line.matchKey) ?? [];
        const take = takes[line.unitId];
        if (assets.length === 0) {
            if (!take) {
                plan.missing.push(line);
            }
            continue;
        }
        if (assets.length > 1 || sharing.length > 1 || !unique.has(line.matchKey)) {
            if (!reportedAmbiguous.has(line.matchKey)) {
                reportedAmbiguous.add(line.matchKey);
                plan.ambiguous.push({ expect: line.expectedName, lines: sharing, assets });
            }
            continue;
        }
        const asset = assets[0];
        if (take?.assetId === asset.id) {
            plan.alreadyLinked += 1;
        } else if (take && !relink) {
            plan.keptOtherTake.push({ line, current: take.assetId, candidate: asset });
        } else {
            plan.matched.push({ line, asset });
        }
    }
    for (const [key, assets] of assetsByKey) {
        if (!linesByKey.has(key)) {
            plan.unmatchedAssets.push(...assets);
        }
    }
    return plan;
}

export const voiceAutoLink: AgentToolHandler = async (args, tool) => {
    const { ctx, request, follow } = tool;
    const language = await resolveVoiceLanguage(ctx, readString(args, "language"));
    follow.describeCall(request.callId, language.name);
    const folder = readOptionalString(args, "assetFolder");
    const query = readOptionalString(args, "assetQuery")?.toLowerCase();
    const relink = readOptionalBoolean(args, "relink") ?? false;
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;
    const status = readOptionalString(args, "status") as VoiceUnitStatus | undefined;
    if (status && status !== "linked" && status !== "approved") {
        throw refuse("invalid_args", "`status` must be linked or approved.");
    }
    const scope = await resolveSceneScope(ctx, readOptionalString(args, "story"), readOptionalString(args, "scene"));

    const pool = audioAssets(ctx);
    const candidates = pool.filter(asset => (!folder || inFolder(ctx, asset, folder)) && (!query || asset.name.toLowerCase().includes(query)));
    if (candidates.length === 0) {
        throw refuse(
            "not_found",
            folder || query ? `No audio asset${folder ? ` in the folder "${folder}"` : ""}${query ? ` with "${query}" in its name` : ""}.` : "The project has no audio assets.",
            "Import the recordings with assets_import (type audio) first; assets_list {type: \"audio\"} shows what is there.",
        );
    }
    const allLines = await collectAgentVoiceLines(ctx, language.code);
    const plan = planAutoLink(
        allLines,
        line => (!scope.storyId || line.storyId === scope.storyId) && (!scope.sceneId || line.sceneId === scope.sceneId),
        candidates.map(asset => ({ id: asset.id, name: asset.name })),
        language.document.units,
        relink,
    );

    const byId = new Map(pool.map(asset => [asset.id, asset]));
    const durations = dryRun ? new Map<string, number>() : await measureDurations(ctx, plan.matched.map(item => byId.get(item.asset.id)!).filter(Boolean));
    const after = new Map<string, VoiceUnit | null>();
    const current = voiceService(ctx).getDocumentIfLoaded(language.code) ?? language.document;
    for (const { line, asset } of plan.matched) {
        after.set(line.unitId, takeAfterLink(current.units[line.unitId], line.text, { assetId: asset.id, ...(status ? { status } : {}) }, durations.get(asset.id)));
    }
    if (!dryRun) {
        commitTakes(ctx, tool, language, after, new Map(allLines.map(line => [line.unitId, line])));
    }

    const lineRef = (line: AgentVoiceLine) => ({ id: line.unitId, where: line.where, speaker: line.speaker });
    const structured = {
        language: language.code,
        dryRun,
        candidates: candidates.length,
        linked: plan.matched.length,
        alreadyLinked: plan.alreadyLinked,
        matched: plan.matched.slice(0, REPORT_CAP).map(item => ({ ...lineRef(item.line), asset: item.asset.name })),
        ...(plan.keptOtherTake.length > 0
            ? {
                  keptOtherTake: plan.keptOtherTake.length,
                  keptOtherTakeSample: plan.keptOtherTake.slice(0, REPORT_CAP).map(item => ({ ...lineRef(item.line), candidate: item.candidate.name })),
              }
            : {}),
        ambiguous: plan.ambiguous.slice(0, REPORT_CAP).map(item => ({
            expect: item.expect,
            lines: item.lines.map(line => line.unitId),
            assets: item.assets.map(asset => `${asset.name} (${asset.id})`),
        })),
        missing: plan.missing.length,
        missingSample: plan.missing.slice(0, REPORT_CAP).map(line => ({ ...lineRef(line), expect: line.expectedName })),
        unmatchedAssets: plan.unmatchedAssets.slice(0, REPORT_CAP).map(asset => asset.name),
        unmatchedAssetCount: plan.unmatchedAssets.length,
    };
    const lead = [
        `${dryRun ? "Dry run: would link" : "Linked"} ${plan.matched.length} line(s) in ${language.name} by name (${candidates.length} candidate asset(s))${!dryRun && plan.matched.length > 0 ? " - one step of undo in Studio" : ""}.`,
        plan.alreadyLinked > 0 ? `${plan.alreadyLinked} already had that take.` : "",
        plan.keptOtherTake.length > 0 ? `${plan.keptOtherTake.length} already have another take and were left alone (relink: true replaces them).` : "",
        plan.ambiguous.length > 0 ? `${plan.ambiguous.length} name(s) are ambiguous - several assets or several lines share them; link those with voice_link by id.` : "",
        plan.missing.length > 0 ? `${plan.missing.length} line(s) still have no take and no asset of their name (missingSample lists their expected names).` : "",
        plan.unmatchedAssets.length > 0 ? `${plan.unmatchedAssets.length} candidate asset(s) match no line - misnamed takes, or lines that changed scene or order since the script was exported.` : "",
    ].filter(Boolean).join(" ");
    return { ok: true, content: [{ type: "text", text: `${lead}\n${JSON.stringify(structured)}` }], structured };
};

// ── voice_settings_set ───────────────────────────────────────────────────────────────────────────

/** Which voice languages to add and drop. A language holding takes leaves only when `removals` names it. */
export function planVoiceLanguages(
    current: readonly string[],
    wanted: readonly string[] | undefined,
    removals: readonly string[],
    takes: (code: string) => number,
): { add: string[]; remove: string[] } {
    for (const code of [...(wanted ?? []), ...removals]) {
        if (!isValidLocaleCode(code)) {
            throw refuse("invalid_args", `"${code}" is not a language code.`, "Use a BCP 47 code such as `ja`, `en` or `zh-CN`.");
        }
    }
    const overlap = (wanted ?? []).filter(code => removals.includes(code));
    if (overlap.length > 0) {
        throw refuse("invalid_args", `${overlap.join(", ")} is both in \`languages\` and in \`removeLanguages\`.`);
    }
    const add = (wanted ?? []).filter((code, index, all) => !current.includes(code) && all.indexOf(code) === index);
    const remove = current.filter(code => removals.includes(code));
    if (wanted) {
        const leftOut = current.filter(code => !wanted.includes(code) && !removals.includes(code));
        const withTakes = leftOut.filter(code => takes(code) > 0);
        if (withTakes.length > 0) {
            throw refuse(
                "invalid_args",
                `\`languages\` leaves out ${withTakes.map(code => `${code} (${takes(code)} linked takes)`).join(", ")}.`,
                `To drop a voice language that holds takes, name it in \`removeLanguages\`: ${JSON.stringify(withTakes)}. Its take file stays on disk, so adding it back restores them.`,
            );
        }
        remove.push(...leftOut);
    }
    return { add, remove };
}

export const voiceSettingsSet: AgentToolHandler = async (args, { ctx, request, follow, log }) => {
    const languages = readOptionalStringArray(args, "languages")?.map(code => code.trim());
    const removeLanguages = (readOptionalStringArray(args, "removeLanguages") ?? []).map(code => code.trim());
    const namingPattern = readOptionalString(args, "namingPattern");
    const voiceChoices = readOptionalBoolean(args, "voiceChoices");
    if (languages === undefined && removeLanguages.length === 0 && namingPattern === undefined && voiceChoices === undefined) {
        throw refuse("invalid_args", "Give at least one of `languages`, `removeLanguages`, `namingPattern`, `voiceChoices`.");
    }
    const service = voiceService(ctx);
    const before: VoiceConfiguration = service.getConfiguration();
    const counts = new Map<string, number>();
    for (const locale of before.voicedLocales) {
        const document = await service.loadDocument(locale.code).catch(() => null);
        counts.set(locale.code, document ? Object.keys(document.units).length : 0);
    }
    const plan = planVoiceLanguages(before.voicedLocales.map(locale => locale.code), languages, removeLanguages, code => counts.get(code) ?? 0);
    const warnings: string[] = [];
    if (namingPattern !== undefined) {
        const tokens = [...namingPattern.matchAll(/\{(\w+)\}/g)].map(match => match[1].toLowerCase());
        const unknown = tokens.filter(token => !(VOICE_NAME_TOKENS as readonly string[]).map(name => name.toLowerCase()).includes(token));
        if (unknown.length > 0) {
            throw refuse("invalid_args", `Unknown token(s) in \`namingPattern\`: ${unknown.map(token => `{${token}}`).join(", ")}.`, `The tokens are ${VOICE_NAME_TOKENS.filter(token => token !== "unitId").map(token => `{${token}}`).join(", ")}.`);
        }
        if (!tokens.includes("index") && !tokens.includes("unit") && !tokens.includes("unitid")) {
            warnings.push("The pattern has neither {index} nor {unit}, so lines of one speaker in one scene share a name and none of them can be matched.");
        }
    }

    assertAgentMayStillWrite({ ctx, request, follow });
    for (const code of plan.add) {
        await service.addLocale({ code, displayName: localeAutonym(code) });
    }
    for (const code of plan.remove) {
        await service.removeLocale(code);
    }
    if (namingPattern !== undefined || voiceChoices !== undefined) {
        await service.updateConfiguration(config => ({
            ...config,
            ...(namingPattern !== undefined ? { namingPattern } : {}),
            ...(voiceChoices !== undefined ? { voiceChoices } : {}),
        }));
    }
    const after = service.getConfiguration();
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (changed) {
        ctx.services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label: AGENT_HISTORY_LABEL,
            undo: async () => {
                await service.updateConfiguration(() => before);
            },
            redo: async () => {
                await service.updateConfiguration(() => after);
            },
        });
        log("info", `voice settings +[${plan.add.join(", ")}] -[${plan.remove.join(", ")}]`);
    }
    const structured = {
        languages: after.voicedLocales.map(locale => locale.code),
        languagesAdded: plan.add,
        languagesRemoved: plan.remove,
        namingPattern: after.namingPattern,
        voiceChoices: after.voiceChoices,
        ...(warnings.length > 0 ? { warnings } : {}),
    };
    const text = [
        changed ? "Voice settings changed; one step of undo in Studio." : "Nothing changed: the voice settings already were so.",
        plan.remove.length > 0 ? "A removed voice language's take file stays on disk; adding the language back restores its takes." : "",
        ...warnings,
    ].filter(Boolean).join(" ");
    return { ok: true, content: [{ type: "text", text: `${text}\n${JSON.stringify(structured)}` }], structured };
};
