/**
 * `localization_status`, `localization_list`, `localization_set`: translating a game.
 *
 * Everything goes through `LocalizationService`, the store the translation table edits and the
 * export and import fold into, and every unit is addressed by the one id it has everywhere (a story
 * line's `textId`, `ui:…`, `key:…`, `char:…`, `scene:…`). Named keys are not a separate tool: their
 * translations are units of the same per-language documents (`key:<name>`), so they list and write
 * like any other unit; only their source words live apart, in the key registry.
 *
 * A batch is one gesture. The table's import already travels as one operation
 * (`applyImportedRows`), and `localization_set` writes through the same batch seam
 * (`applyUnitEdits`), so a live session would carry it whole and the author undoes it with one
 * Ctrl+Z - a project-stack command entry holding each unit as it was and as it became.
 *
 * Stale protection is per unit rather than per document: the translation library has no revision,
 * but each listed unit carries `rev`, the hash of the source text it was listed with. A unit whose
 * source moved since is skipped and reported, not written against text the agent never saw.
 *
 * Comments in English per project convention.
 */

import type { LocalizationDocument, LocalizationUnit, LocalizationUnitStatus } from "@shared/types/localization";
import { hashSourceText } from "@shared/utils/localizationText";
import { Services, type WorkspaceContext } from "../../services";
import type { HistoryService } from "../../history/HistoryService";
import { projectHistoryScope } from "../../history/historyScopes";
import type { LocalizationService } from "../../localization/LocalizationService";
import { deriveUnitState, type LocalizationUnitState } from "../../localization/localizationModel";
import {
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalString,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { AGENT_HISTORY_LABEL } from "../agentLookups";
import {
    AGENT_UNIT_ORIGINS,
    collectAgentTranslationUnits,
    compactListText,
    pageOf,
    readCursor,
    resolveSceneScope,
    translationWarnings,
    type AgentTranslationUnit,
    type AgentUnitOrigin,
} from "../translationUnits";

/** A unit's state as the tools name it: `missing` rather than the table's `untranslated`. */
export type AgentTranslationState = "missing" | Exclude<LocalizationUnitState, "untranslated">;

export function agentTranslationState(unit: LocalizationUnit | undefined, sourceText: string): AgentTranslationState {
    const state = deriveUnitState(unit, sourceText);
    return state === "untranslated" ? "missing" : state;
}

/** The short revision a listed unit carries: the hash of the source text it was listed with. */
export function sourceRevision(sourceText: string): string {
    return hashSourceText(sourceText).replace(/^[a-z0-9]+:/, "");
}

const LIST_STATUSES = ["missing", "stale", "machine", "translated", "reviewed", "todo", "unreviewed"] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

const WRITE_STATUSES: readonly LocalizationUnitStatus[] = ["machine", "translated", "reviewed"];

/** An agent's translation is a machine translation until the author reviews it, unless told otherwise. */
const DEFAULT_WRITE_STATUS: LocalizationUnitStatus = "machine";

const MAX_BATCH = 1000;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

function localizationService(ctx: WorkspaceContext): LocalizationService {
    return ctx.services.get<LocalizationService>(Services.Localization);
}

/**
 * The target language a call names, its display name and its loaded document. Refuses the source
 * language - its text is the story and the pages themselves - and a language the project lacks.
 */
async function resolveTargetLanguage(
    ctx: WorkspaceContext,
    code: string,
): Promise<{ code: string; name: string; document: LocalizationDocument }> {
    const service = localizationService(ctx);
    const config = service.getConfiguration();
    if (!config.sourceLocale) {
        throw refuse(
            "unavailable",
            "This project has no languages set up for translation.",
            "Add the languages with project_settings_set {languages: [<source>, <target>, …]}; the first one is the source language.",
        );
    }
    if (code === config.sourceLocale) {
        throw refuse(
            "invalid_args",
            `${code} is the source language: its text is the story lines, pages and keys themselves, not a translation.`,
            "Edit source text with story_apply or ui_patch; translate into one of the other languages.",
        );
    }
    const entry = config.locales.find(locale => locale.code === code);
    if (!entry) {
        const targets = config.locales.filter(locale => locale.code !== config.sourceLocale).map(locale => locale.code);
        throw refuse(
            "not_found",
            `The game has no language "${code}".`,
            targets.length > 0
                ? `Its target languages are ${targets.join(", ")}. Add one with project_settings_set {languages: [${[config.sourceLocale, ...targets, code].map(c => `"${c}"`).join(", ")}]}; the list names every language, the source included.`
                : `It has no target language yet. Add one with project_settings_set {languages: ["${config.sourceLocale}", "${code}"]}; the list names every language, the source included.`,
        );
    }
    let document: LocalizationDocument;
    try {
        document = await service.loadDocument(code);
    } catch (error) {
        throw refuse("unavailable", error instanceof Error ? error.message : String(error));
    }
    return { code, name: entry.displayName || code, document };
}

// ── localization_status ──────────────────────────────────────────────────────────────────────────

type Coverage = { total: number; done: number; reviewed: number; translated: number; machine: number; stale: number; missing: number };

function emptyCoverage(): Coverage {
    return { total: 0, done: 0, reviewed: 0, translated: 0, machine: 0, stale: 0, missing: 0 };
}

function count(coverage: Coverage, state: AgentTranslationState): void {
    coverage.total += 1;
    coverage[state] += 1;
    if (state === "machine" || state === "translated" || state === "reviewed") {
        coverage.done += 1;
    }
}

export const localizationStatus: AgentToolHandler = async (args, { ctx }) => {
    const only = readOptionalString(args, "language");
    const service = localizationService(ctx);
    const config = service.getConfiguration();
    if (!config.sourceLocale) {
        return {
            ok: true,
            content: [{
                type: "text",
                text: "This project has no languages set up for translation. Add them with project_settings_set {languages: [<source>, <target>, …]}; the first is the source language the game is written in.",
            }],
            structured: { sourceLanguage: null, languages: [] },
        };
    }
    const targets = config.locales.filter(locale => locale.code !== config.sourceLocale);
    if (only !== undefined) {
        await resolveTargetLanguage(ctx, only);
    }
    const units = await collectAgentTranslationUnits(ctx);
    const languages = [];
    let scenes: { scene: string; sceneId: string; lines: number; missing: number; stale: number; done: number }[] | undefined;
    for (const locale of only ? targets.filter(entry => entry.code === only) : targets) {
        const document = await service.loadDocument(locale.code).catch(() => null);
        if (!document) {
            languages.push({ code: locale.code, name: locale.displayName, unreadable: true });
            continue;
        }
        const total = emptyCoverage();
        const byOrigin: Partial<Record<AgentUnitOrigin, Coverage>> = {};
        const perScene = new Map<string, { scene: string; sceneId: string; lines: number; missing: number; stale: number; done: number }>();
        for (const unit of units) {
            const state = agentTranslationState(document.units[unit.unitId], unit.sourceText);
            count(total, state);
            count(byOrigin[unit.origin] ??= emptyCoverage(), state);
            if (only && unit.origin === "story" && unit.sceneId) {
                const scene = perScene.get(unit.sceneId)
                    ?? { scene: unit.sceneName ?? "", sceneId: unit.sceneId, lines: 0, missing: 0, stale: 0, done: 0 };
                scene.lines += 1;
                if (state === "missing") {
                    scene.missing += 1;
                } else if (state === "stale") {
                    scene.stale += 1;
                } else {
                    scene.done += 1;
                }
                perScene.set(unit.sceneId, scene);
            }
        }
        languages.push({
            code: locale.code,
            name: locale.displayName,
            ...(locale.fallback ? { fallback: locale.fallback } : {}),
            ...total,
            byOrigin,
        });
        if (only) {
            scenes = [...perScene.values()];
        }
    }
    const lead = targets.length === 0
        ? `Source language ${config.sourceLocale}; no language to translate into yet - add one with project_settings_set {languages: ["${config.sourceLocale}", "en", …]} (the list keeps the source language).`
        : `Source language ${config.sourceLocale}; ${targets.length} target language(s). \`done\` = machine + translated + reviewed; \`stale\` = translated before the source line changed.`
            + (only ? "" : " Pass `language` for a per-scene breakdown.");
    return {
        ok: true,
        content: [{ type: "text", text: compactListText(lead, { sourceLanguage: config.sourceLocale, languages, ...(scenes ? { scenes } : {}) }, scenes ? "scenes" : "languages") }],
        structured: { sourceLanguage: config.sourceLocale, languages, ...(scenes ? { scenes } : {}) },
    };
};

// ── localization_list ────────────────────────────────────────────────────────────────────────────

function matchesStatus(filter: ListStatus, state: AgentTranslationState): boolean {
    switch (filter) {
        case "todo":
            return state === "missing" || state === "stale";
        case "unreviewed":
            return state === "machine" || state === "translated";
        default:
            return state === filter;
    }
}

/** One unit as a list row: short keys, empty fields left out - a page holds hundreds of these. */
function listRow(unit: AgentTranslationUnit, stored: LocalizationUnit | undefined, state: AgentTranslationState) {
    return {
        id: unit.unitId,
        kind: unit.kind,
        where: unit.where,
        ...(unit.speaker ? { speaker: unit.speaker } : {}),
        source: unit.shownSource,
        ...(stored?.target ? { target: stored.target } : {}),
        status: state,
        ...(stored?.note ? { note: stored.note } : {}),
        ...(unit.context ? { context: unit.context } : {}),
        rev: sourceRevision(unit.sourceText),
    };
}

export const localizationList: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const { code, name, document } = await resolveTargetLanguage(ctx, readString(args, "language"));
    follow.describeCall(request.callId, name);
    const origin = readOptionalString(args, "origin") as AgentUnitOrigin | undefined;
    if (origin && !AGENT_UNIT_ORIGINS.includes(origin)) {
        throw refuse("invalid_args", `\`origin\` must be one of ${AGENT_UNIT_ORIGINS.join(", ")}.`);
    }
    const status = readOptionalString(args, "status") as ListStatus | undefined;
    if (status && !LIST_STATUSES.includes(status)) {
        throw refuse("invalid_args", `\`status\` must be one of ${LIST_STATUSES.join(", ")}.`);
    }
    const page = readOptionalString(args, "page");
    const query = readOptionalString(args, "query")?.toLowerCase();
    const scope = await resolveSceneScope(ctx, readOptionalString(args, "story"), readOptionalString(args, "scene"));
    const offset = readCursor(readOptionalString(args, "cursor"));
    const limit = readOptionalInteger(args, "limit", { min: 1, max: MAX_LIST_LIMIT }) ?? DEFAULT_LIST_LIMIT;

    const units = await collectAgentTranslationUnits(ctx);
    const matched = units.filter(unit => {
        if (origin && unit.origin !== origin) {
            return false;
        }
        if (scope.storyId && unit.storyId !== scope.storyId) {
            return false;
        }
        if (scope.sceneId && unit.sceneId !== scope.sceneId) {
            return false;
        }
        if (page && (unit.origin !== "interface" || unit.group?.toLowerCase() !== page.toLowerCase())) {
            return false;
        }
        const stored = document.units[unit.unitId];
        if (status && !matchesStatus(status, agentTranslationState(stored, unit.sourceText))) {
            return false;
        }
        if (query && !unit.shownSource.toLowerCase().includes(query) && !(stored?.target ?? "").toLowerCase().includes(query)) {
            return false;
        }
        return true;
    });
    const { page: shown, nextCursor } = pageOf(matched, offset, limit);
    const rows = shown.map(unit => {
        const stored = document.units[unit.unitId];
        return listRow(unit, stored, agentTranslationState(stored, unit.sourceText));
    });
    const structured = { language: code, total: matched.length, from: offset, nextCursor, units: rows };
    const lead = matched.length === 0
        ? `No unit matches in ${name}.`
        : `${rows.length} of ${matched.length} unit(s) in ${name}${nextCursor ? `; pass cursor "${nextCursor}" for the next page` : ""}. `
            + "Translate `source` into `target`, keeping {n} values, ‹n›…‹/n› / ‹n/› run tags and line breaks; pass `rev` back to localization_set.";
    return { ok: true, content: [{ type: "text", text: compactListText(lead, structured, "units") }], structured };
};

// ── localization_set ─────────────────────────────────────────────────────────────────────────────

type SetEntry = { unitId: string; target: string; status?: LocalizationUnitStatus; note?: string; rev?: string };

function readEntries(args: Record<string, unknown>): SetEntry[] {
    const raw = args.entries;
    if (!Array.isArray(raw) || raw.length === 0) {
        throw refuse("invalid_args", "`entries` must be a non-empty array of {unitId, target}.");
    }
    if (raw.length > MAX_BATCH) {
        throw refuse("invalid_args", `At most ${MAX_BATCH} entries per call; split the batch (a scene at a time works well).`);
    }
    const seen = new Set<string>();
    return raw.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw refuse("invalid_args", `entries[${index}] must be an object {unitId, target}.`);
        }
        const record = item as Record<string, unknown>;
        const unitId = typeof record.unitId === "string" ? record.unitId.trim() : "";
        if (!unitId) {
            throw refuse("invalid_args", `entries[${index}].unitId must be a unit id from localization_list.`);
        }
        if (seen.has(unitId)) {
            throw refuse("invalid_args", `entries name ${unitId} twice.`);
        }
        seen.add(unitId);
        if (typeof record.target !== "string") {
            throw refuse("invalid_args", `entries[${index}].target must be a string ("" clears the translation).`);
        }
        const status = record.status;
        if (status !== undefined && !WRITE_STATUSES.includes(status as LocalizationUnitStatus)) {
            throw refuse("invalid_args", `entries[${index}].status must be one of ${WRITE_STATUSES.join(", ")}.`);
        }
        if (record.note !== undefined && typeof record.note !== "string") {
            throw refuse("invalid_args", `entries[${index}].note must be a string.`);
        }
        if (record.rev !== undefined && typeof record.rev !== "string") {
            throw refuse("invalid_args", `entries[${index}].rev must be the \`rev\` localization_list returned.`);
        }
        return {
            unitId,
            target: record.target,
            ...(status !== undefined ? { status: status as LocalizationUnitStatus } : {}),
            ...(record.note !== undefined ? { note: record.note as string } : {}),
            ...(record.rev !== undefined ? { rev: record.rev as string } : {}),
        };
    });
}

/**
 * The entry a write leaves, or null when the unit ends up with none: the same rule the table's own
 * edit follows (`LocalizationService.updateUnit`) - an entry with no words and no note is what an
 * untranslated line already looks like, so it is removed rather than stored empty. The hash is
 * re-anchored to the current source, which is what clears a derived `stale`.
 */
export function unitAfterWrite(existing: LocalizationUnit | undefined, sourceText: string, entry: SetEntry): LocalizationUnit | null {
    const note = entry.note !== undefined ? (entry.note.trim() ? entry.note : undefined) : existing?.note;
    if (!entry.target && !note) {
        return null;
    }
    return {
        target: entry.target,
        sourceHash: hashSourceText(sourceText),
        status: entry.target ? entry.status ?? DEFAULT_WRITE_STATUS : "untranslated",
        ...(note ? { note } : {}),
    };
}

function sameUnit(a: LocalizationUnit | undefined, b: LocalizationUnit | null): boolean {
    if (!a || !b) {
        return !a && !b;
    }
    return a.target === b.target && a.status === b.status && a.sourceHash === b.sourceHash && (a.note ?? "") === (b.note ?? "");
}

/** `applyUnitEdits` input that puts every listed unit to `units` (null = no entry). */
function editFor(units: ReadonlyMap<string, LocalizationUnit | null>): { set: Record<string, LocalizationUnit>; remove: string[] } {
    const set: Record<string, LocalizationUnit> = {};
    const remove: string[] = [];
    for (const [unitId, unit] of units) {
        if (unit) {
            set[unitId] = unit;
        } else {
            remove.push(unitId);
        }
    }
    return { set, remove };
}

export const localizationSet: AgentToolHandler = async (args, { ctx, request, follow, log }) => {
    const { code, name, document } = await resolveTargetLanguage(ctx, readString(args, "language"));
    follow.describeCall(request.callId, name);
    const entries = readEntries(args);
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;

    const units = await collectAgentTranslationUnits(ctx);
    // Read again after the collection: the author may have typed a translation meanwhile.
    const current = localizationService(ctx).getDocumentIfLoaded(code) ?? document;
    const byId = new Map(units.map(unit => [unit.unitId, unit]));
    const unknown = entries.filter(entry => !byId.has(entry.unitId)).map(entry => entry.unitId);
    if (unknown.length > 0) {
        throw refuse(
            "not_found",
            `${unknown.length} unit id(s) match nothing in this game: ${unknown.slice(0, 20).join(", ")}${unknown.length > 20 ? ", …" : ""}. Nothing was written.`,
            "Take unit ids from localization_list; a line deleted or rewritten under a new row since then has a new id.",
        );
    }

    const before = new Map<string, LocalizationUnit | null>();
    const after = new Map<string, LocalizationUnit | null>();
    const changedSinceRead: { id: string; where: string; source: string; rev: string }[] = [];
    const warnings: { id: string; where: string; problems: string[] }[] = [];
    let unchanged = 0;
    for (const entry of entries) {
        const unit = byId.get(entry.unitId)!;
        const currentRev = sourceRevision(unit.sourceText);
        if (entry.rev !== undefined && entry.rev !== currentRev) {
            changedSinceRead.push({ id: unit.unitId, where: unit.where, source: unit.shownSource, rev: currentRev });
            continue;
        }
        const existing = current.units[entry.unitId];
        const next = unitAfterWrite(existing, unit.sourceText, entry);
        const problems = translationWarnings(unit, entry.target);
        if (problems.length > 0) {
            warnings.push({ id: unit.unitId, where: unit.where, problems });
        }
        if (sameUnit(existing, next)) {
            unchanged += 1;
            continue;
        }
        before.set(entry.unitId, existing ? { ...existing } : null);
        after.set(entry.unitId, next);
    }

    const written = after.size;
    const firstWritten = written > 0 ? byId.get([...after.keys()][0]) : undefined;
    if (!dryRun && written > 0) {
        const service = localizationService(ctx);
        service.applyUnitEdits(code, editFor(after));
        ctx.services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label: AGENT_HISTORY_LABEL,
            undo: () => service.applyUnitEdits(code, editFor(before)),
            redo: () => service.applyUnitEdits(code, editFor(after)),
        });
        log("info", `${code}: ${written} unit(s) written`);
        follow.noteWrite({
            kind: "translation",
            locale: code,
            unitId: firstWritten!.unitId,
            ...(firstWritten!.storyId ? { storyId: firstWritten!.storyId } : {}),
            name: firstWritten!.sceneName ? `${name} · ${firstWritten!.sceneName}` : name,
        });
    }

    const parts = [
        dryRun ? `Dry run: ${written} unit(s) would be written in ${name}` : `Wrote ${written} unit(s) in ${name}`,
        unchanged > 0 ? `${unchanged} already held that` : "",
        changedSinceRead.length > 0 ? `${changedSinceRead.length} skipped because their source changed since you listed them - translate the new source below and send them again with its rev` : "",
        warnings.length > 0 ? `${warnings.length} written with warnings - check them` : "",
    ].filter(Boolean);
    const lead = `${parts.join("; ")}.${!dryRun && written > 0 ? " One step of undo in Studio." : ""}`;
    const structured = {
        language: code,
        written,
        unchanged,
        dryRun,
        ...(changedSinceRead.length > 0 ? { changedSinceRead } : {}),
        warnings,
    };
    return { ok: true, content: [{ type: "text", text: compactListText(lead, structured, "warnings") }], structured };
};
