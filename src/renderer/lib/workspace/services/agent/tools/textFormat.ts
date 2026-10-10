/**
 * What the three text-format tool families (`.story`, `.ui`, `.bp`) share: the contexts the agent
 * core reads, built from the live services; the command vocabulary pin; and the shaping of the
 * command lines' output into answers.
 *
 * The answers are the command lines' own text (`commandText`), so the format guides the agent reads,
 * which quote that output, stay true here. Only two things are changed on the way out: a refusal's
 * diagnostics are capped and put errors first, and the sentences that tell a terminal user which
 * flag to pass are reworded, since an agent has no flags.
 *
 * Comments in English per project convention.
 */

import { commandI18nStore } from "@/lib/i18n";
import {
    buildBlueprintProjectContext,
    buildStoryProjectContext,
    textKeysOf,
    type BlueprintProjectInput,
    type StoryAgentContext,
    type StoryLintStory,
    type StoryProjectContext,
    type StorySummary,
    type UiAgentContext,
} from "@/lib/agent-core";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { Services, type WorkspaceContext } from "../../services";
import type { UIDocumentService } from "../../ui-editor/UIDocumentService";
import type { UIGraphService } from "../../ui-editor/UIGraphService";
import type { LocalizationService } from "../../localization/LocalizationService";
import type { CharacterService } from "../../core/CharacterService";
import type { VariableRegistryService } from "../../variables/VariableRegistryService";
import type { AudioTrackService } from "../../audio/AudioTrackService";
import type { AppTagService } from "../../appTag/AppTagService";
import type { AssetSetService } from "../../assets/AssetSetService";
import { refuse, type AgentRefusal } from "../agentCall";
import { assetsService, storyService } from "../agentLookups";

// ── Output shaping ───────────────────────────────────────────────────────────────────────────────

/** Longest text an answer carries before it is cut, in characters. */
export const AGENT_TEXT_LIMIT = 60_000;

/** Longest diagnostics report a refusal carries, in lines. */
export const AGENT_DIAGNOSTIC_LINES = 60;

/**
 * `text` as an answer carries it: whole, or cut at a line boundary under {@link AGENT_TEXT_LIMIT}
 * with a closing line saying how much was left out and how to ask for less.
 */
export function capText(text: string, narrow: string): string {
    if (text.length <= AGENT_TEXT_LIMIT) {
        return text;
    }
    const cut = text.lastIndexOf("\n", AGENT_TEXT_LIMIT);
    const kept = text.slice(0, cut > 0 ? cut : AGENT_TEXT_LIMIT);
    return `${kept}\n... cut at ${kept.length} of ${text.length} characters. ${narrow}`;
}

/**
 * The command lines' sentences that tell a terminal user which flag to pass, in the words that fit
 * an agent. Everything else is left exactly as the command line prints it.
 */
export function forAgent(text: string): string {
    return text
        .replace("Nothing written. Pass --write.", "Dry run: nothing written.")
        .replace("Dry run - pass --write to save.", "Dry run: nothing written.")
        .replace(/ Pass --write to do it\.$/m, " (dry run: nothing written).")
        .replace("so it is done in Studio.", "so it is done with scene_rename.")
        .replace(/`story check --project <dir>` lists (it|them)\./g, "The `lint` tool lists $1.")
        .replace(
            /Not checked here: (.+?)\. Those rules read asset bytes or the reference index, which only a running Studio builds - so this says nothing about them either way\./,
            "Not checked by this write: $1. Those rules read asset bytes and the reference index; the `lint` tool runs them.",
        );
}

/**
 * A diagnostics report cut to {@link AGENT_DIAGNOSTIC_LINES}, errors first.
 *
 * The `.ui` and `.bp` reports already lead with errors; the `.story` report is in line order, with
 * each finding a line starting `error` or `warn ` followed by its indented code. Findings are moved
 * as whole entries, so a code never ends up under the wrong message.
 */
export function diagnosticsForRefusal(report: string): string {
    const lines = report.split("\n");
    const entries: { error: boolean; lines: string[] }[] = [];
    const trailer: string[] = [];
    for (const line of lines) {
        if (trailer.length > 0) {
            trailer.push(line);
        } else if (/^(error|warn )\s/.test(line)) {
            entries.push({ error: line.startsWith("error"), lines: [line] });
        } else if (line.trim() === "" || entries.length === 0) {
            trailer.push(line);
        } else {
            entries[entries.length - 1].lines.push(line);
        }
    }
    const ordered = entries.length > 0
        ? [...entries.filter(entry => entry.error), ...entries.filter(entry => !entry.error)].flatMap(entry => entry.lines).concat(trailer)
        : lines;
    if (ordered.length <= AGENT_DIAGNOSTIC_LINES) {
        return ordered.join("\n").trim();
    }
    return `${ordered.slice(0, AGENT_DIAGNOSTIC_LINES).join("\n")}\n... and ${ordered.length - AGENT_DIAGNOSTIC_LINES} more line(s). Fix these and check again.`;
}

/** The refusal for a source with errors: nothing was written, and here is why. */
export function checkFailed(report: string, hint?: string): AgentRefusal {
    return refuse("check_failed", `The source has errors, so nothing was written.\n${diagnosticsForRefusal(forAgent(report))}`, hint);
}

/** The comment line a show answer opens with, so the revision travels with the text. */
export function revisionComment(revision: number, applyTool: string): string {
    return `# revision ${revision} - pass it to ${applyTool} as baseRevision`;
}

// ── The command vocabulary ───────────────────────────────────────────────────────────────────────

let pinDepth = 0;
let pinnedFrom: unknown;

/**
 * Run `print` with the story command vocabulary pinned to the canonical (English) tokens, and the
 * author's setting put back before anything can render.
 *
 * The `.story` format and its guide are written in the canonical tokens, which is what the command
 * line pins too (`story-cli/cli.ts`); a Chinese author's localized verbs would otherwise come out
 * in the text the agent edits. Reading needs no pin - a localized spelling and the canonical one
 * both parse - so only printing is wrapped.
 *
 * Synchronous on purpose. Changing the preference notifies the store's subscribers, and a render
 * between the two changes would draw the author's story editor in English for a frame and rebuild
 * the token tables twice. A synchronous body leaves React no turn to render in. An `apply` is not
 * wrapped for that reason: its project lint yields to the event loop between rules
 * (`lib/lint/engine.ts`), so a pin held across it would be on screen, and all it would change is
 * the wording of the deleted-row list.
 *
 * Nested calls keep the outermost value; a preference the author changed while pinned is kept.
 */
export function withCanonicalCommandVocabulary<T>(print: () => T): T {
    if (pinDepth === 0) {
        pinnedFrom = commandI18nStore.getPreference();
        if (pinnedFrom !== false) {
            commandI18nStore.setPreference(false);
        }
    }
    pinDepth += 1;
    try {
        return print();
    } finally {
        pinDepth -= 1;
        if (pinDepth === 0 && commandI18nStore.getPreference() === false && pinnedFrom !== false) {
            commandI18nStore.setPreference(pinnedFrom);
        }
    }
}

// ── Contexts ─────────────────────────────────────────────────────────────────────────────────────

export function uiDocumentService(ctx: WorkspaceContext): UIDocumentService {
    return ctx.services.get<UIDocumentService>(Services.UIDocument);
}

export function liveBlueprintDocument(ctx: WorkspaceContext): BlueprintDocument {
    return ctx.services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
}

/**
 * What the `.ui` core reads, from the live services. `document` replaces the live interface
 * document (a clone for a dry run, the skeleton's for `ui_usage`).
 *
 * The translation keys are read from the localization service, which loads them on first use; a
 * key file that will not open is treated as no keys rather than failing the call, since it only
 * decides how keyed widgets' words are shown.
 */
export async function uiAgentContextOf(ctx: WorkspaceContext, document?: UIDocument): Promise<UiAgentContext> {
    const localization = ctx.services.get<LocalizationService>(Services.Localization);
    let keysDocument: unknown = localization.getKeysIfLoaded() ?? null;
    if (!keysDocument) {
        keysDocument = await localization.loadKeys().catch(() => null);
    }
    return {
        document: document ?? uiDocumentService(ctx).getDocument(),
        blueprintDocument: liveBlueprintDocument(ctx),
        textKeys: textKeysOf({ localization: localization.getConfiguration(), keysDocument }),
    };
}

/** Every story in the library, live and migrated, with the ones that will not open set aside. */
export async function loadAllStories(ctx: WorkspaceContext): Promise<{
    stories: StoryLintStory[];
    unreadable: { summary: StorySummary; error: unknown }[];
}> {
    const service = storyService(ctx);
    const stories: StoryLintStory[] = [];
    const unreadable: { summary: StorySummary; error: unknown }[] = [];
    for (const entry of service.listStories()) {
        const summary: StorySummary = { id: entry.id, name: entry.name, ...(entry.dlcId ? { dlcId: entry.dlcId } : {}) };
        try {
            stories.push({ ...summary, document: await service.loadStory(entry.id) });
        } catch (error) {
            unreadable.push({ summary, error });
        }
    }
    return { stories, unreadable };
}

/** What the `.story` core reads: the names a line resolves against, and every story. */
export async function storyAgentContextOf(ctx: WorkspaceContext): Promise<StoryAgentContext> {
    const { stories, unreadable } = await loadAllStories(ctx);
    return { data: storyProjectDataOf(ctx), stories, unreadable };
}

/** The names a story line resolves against, from the live services. */
export function storyProjectDataOf(ctx: WorkspaceContext): StoryProjectContext {
    return buildStoryProjectContext({
        assets: assetsService(ctx).getAssets() as never,
        characters: ctx.services.get<CharacterService>(Services.Character).listCharacter(),
        variableRegistry: ctx.services.get<VariableRegistryService>(Services.VariableRegistry).getRegistry(),
        blueprintDocument: liveBlueprintDocument(ctx),
        audioTracks: ctx.services.get<AudioTrackService>(Services.AudioTracks).listTracks(),
        appTags: ctx.services.get<AppTagService>(Services.AppTags).listTags(),
        uiDocument: uiDocumentService(ctx).getDocument(),
        assetSets: ctx.services.get<AssetSetService>(Services.AssetSets).listSets(),
    });
}

/**
 * What the `.bp` core judges a graph against. `blueprintDocument` is the document an apply writes
 * into - the live one, or a clone for a dry run.
 */
export async function blueprintInputOf(ctx: WorkspaceContext, blueprintDocument: BlueprintDocument): Promise<BlueprintProjectInput> {
    const { stories } = await loadAllStories(ctx);
    return buildBlueprintProjectContext({
        blueprintDocument,
        uiDocument: uiDocumentService(ctx).getDocument(),
        variableRegistry: ctx.services.get<VariableRegistryService>(Services.VariableRegistry).getRegistry(),
        stories: stories.map(story => ({ name: story.name, document: story.document })),
    });
}

/** A deep copy through JSON, which is what every document here is. */
export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
