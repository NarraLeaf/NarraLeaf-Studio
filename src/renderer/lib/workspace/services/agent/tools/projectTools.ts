/**
 * `project_info` and `project_settings_set`.
 *
 * Settings are written through `ProjectService`, which owns the `.nlproj` - never by writing the file
 * behind its back, which would leave the open workspace holding the old values and saving them over
 * the new ones on its next write. The game's languages go through `LocalizationService`, the one the
 * Localization panel adds and removes them with, so the panel and an agent cannot disagree.
 *
 * The player defaults (`playerDefaults`) are the project's starting preferences - text speed,
 * auto-forward delay, volumes, skipping - the same table as Studio's Project → Game page, baked into
 * the build and seeded into a fresh player's settings. A player's own saved settings win over them.
 *
 * Comments in English per project convention.
 */

import { resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import { isValidLocaleCode, localeAutonym } from "@shared/types/localization";
import { PLAYER_PREFERENCE_KEYS, PLAYER_PREFERENCE_SPECS, type PlayerPreferenceKey, type PlayerPreferences } from "@shared/types/preference";
import { Services } from "../../services";
import type { ProjectService } from "../../core/ProjectService";
import type { UIDocumentService } from "../../ui-editor/UIDocumentService";
import type { LocalizationService } from "../../localization/LocalizationService";
import type { CharacterService } from "../../core/CharacterService";
import type { VariableRegistryService } from "../../variables/VariableRegistryService";
import { answerJson, readOptionalInteger, readOptionalString, readOptionalStringArray, refuse, type AgentToolContext, type AgentToolHandler } from "../agentCall";
import { AGENT_ASSET_TYPES, assetsService, storyService } from "../agentLookups";
import { assertAgentMayStillWrite } from "../agentCommitGate";

const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };

export const projectInfo: AgentToolHandler = async (_args, { ctx }) => {
    const project = ctx.services.get<ProjectService>(Services.Project);
    const config = project.getProjectConfig();
    const uidoc = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    const localization = ctx.services.get<LocalizationService>(Services.Localization).getConfiguration();
    const story = storyService(ctx);

    const stories = [];
    let sceneCount = 0;
    for (const entry of story.listStories()) {
        const document = await story.loadStory(entry.id).catch(() => null);
        const scenes = document ? Object.keys(document.scenes).length : 0;
        sceneCount += scenes;
        stories.push({
            id: entry.id,
            name: entry.name,
            scenes,
            entryScene: document?.entrySceneId ? document.scenes[document.entrySceneId]?.name ?? null : null,
        });
    }

    const assetMap = assetsService(ctx).getAssets();
    const assets: Record<string, number> = {};
    for (const type of AGENT_ASSET_TYPES) {
        const count = Object.keys(assetMap[type] ?? {}).length;
        if (count > 0) {
            assets[type] = count;
        }
    }
    const entrySurface = resolveEntrySurface(uidoc);

    return answerJson({
        name: config.name,
        projectPath: ctx.project.getConfig().projectPath,
        resolution: config.metadata?.resolution ?? DEFAULT_RESOLUTION,
        sourceLanguage: localization.sourceLocale || null,
        languages: localization.locales.map(locale => locale.code),
        entryPage: entrySurface ? { id: entrySurface.id, name: entrySurface.name } : null,
        defaultStory: story.getDefaultStoryId() ?? null,
        playerDefaults: project.getPlayerPreferences(),
        stories,
        counts: {
            stories: stories.length,
            scenes: sceneCount,
            pages: uidoc.surfaces.filter(surface => surface.kind === "appSurface").length,
            gameUis: uidoc.surfaces.filter(surface => surface.kind === "stageSurface").length,
            components: (uidoc.components ?? []).length,
            assets,
            characters: ctx.services.get<CharacterService>(Services.Character).listCharacter().length,
            variables: ctx.services.get<VariableRegistryService>(Services.VariableRegistry).listEntries().length,
        },
    });
};

export type LanguagePlan = {
    add: string[];
    remove: string[];
};

/**
 * Which languages to add and remove so the game has `wanted` (when given) without `removals`.
 *
 * Pure, so the rules are tested apart from the services: the source language is never removed,
 * and a language that holds translations leaves only when `removals` names it - a list that merely
 * leaves it out is refused, because dropping a finished translation is not something to do by
 * omission. `translated` answers how many translated lines a language holds.
 */
export function planLanguageChange(
    current: { sourceLocale: string; locales: readonly string[] },
    wanted: readonly string[] | undefined,
    removals: readonly string[],
    translated: (code: string) => number,
): LanguagePlan {
    for (const code of [...(wanted ?? []), ...removals]) {
        if (!isValidLocaleCode(code)) {
            throw refuse("invalid_args", `"${code}" is not a language code.`, "Use a BCP 47 code such as `en`, `zh-CN` or `ja`.");
        }
    }
    const source = current.sourceLocale;
    if (source && removals.includes(source)) {
        throw refuse("invalid_args", `${source} is the source language, which the game is written in; it cannot be removed.`);
    }
    if (wanted && source && !wanted.includes(source)) {
        throw refuse("invalid_args", `\`languages\` leaves out ${source}, the source language the game is written in.`, `List it: ["${source}", …].`);
    }
    const overlap = (wanted ?? []).filter(code => removals.includes(code));
    if (overlap.length > 0) {
        throw refuse("invalid_args", `${overlap.join(", ")} is both in \`languages\` and in \`removeLanguages\`.`);
    }
    const add = (wanted ?? []).filter((code, index, all) => !current.locales.includes(code) && all.indexOf(code) === index);
    const remove = current.locales.filter(code => removals.includes(code));
    if (wanted) {
        const leftOut = current.locales.filter(code => !wanted.includes(code) && !removals.includes(code));
        const withTranslations = leftOut.filter(code => translated(code) > 0);
        if (withTranslations.length > 0) {
            throw refuse(
                "invalid_args",
                `\`languages\` leaves out ${withTranslations.map(code => `${code} (${translated(code)} translated lines)`).join(", ")}.`,
                `To drop a language that holds translations, name it in \`removeLanguages\`: ${JSON.stringify(withTranslations)}. Its translation file stays on disk, so adding it back restores them.`,
            );
        }
        remove.push(...leftOut);
    }
    return { add, remove };
}

async function changeLanguages(
    tool: Pick<AgentToolContext, "ctx" | "request" | "follow">,
    wanted: readonly string[] | undefined,
    removals: readonly string[],
): Promise<LanguagePlan> {
    const { ctx } = tool;
    const localization = ctx.services.get<LocalizationService>(Services.Localization);
    const config = localization.getConfiguration();
    const counts = new Map<string, number>();
    for (const locale of config.locales) {
        if (locale.code === config.sourceLocale) {
            continue;
        }
        const document = await localization.loadDocument(locale.code).catch(() => null);
        counts.set(locale.code, document ? Object.values(document.units).filter(unit => unit.target.trim() !== "").length : 0);
    }
    const plan = planLanguageChange(
        { sourceLocale: config.sourceLocale, locales: config.locales.map(locale => locale.code) },
        wanted,
        removals,
        code => counts.get(code) ?? 0,
    );
    // Counting each language's translations read its document, and each language written is awaited
    // too: the author may have paused at any of those, so each write asks first.
    const done: string[] = [];
    const gate = () => assertAgentMayStillWrite(tool, done.length === 0 ? "Nothing was written." : `Already ${done.join(", ")}; nothing else was written.`);
    for (const code of plan.add) {
        gate();
        await localization.addLocale({ code, displayName: localeAutonym(code) });
        done.push(`added ${code}`);
    }
    for (const code of plan.remove) {
        gate();
        await localization.removeLocale(code);
        done.push(`removed ${code}`);
    }
    return plan;
}

/** How a refusal part-way through `project_settings_set` ends: what it had changed by then. */
function writtenSoFar(changed: readonly string[]): string {
    return changed.length === 0 ? "Nothing was written." : `Already changed: ${changed.join(" and ")}; nothing else was written.`;
}

/**
 * `playerDefaults`, checked against the preference table. Refused rather than clamped: an agent that
 * wrote 1000 cps meant "instant", and silently storing 200 would hide that the table stops there.
 */
export function readPlayerDefaults(args: Record<string, unknown>): Partial<PlayerPreferences> | undefined {
    const raw = args.playerDefaults;
    if (raw === undefined) {
        return undefined;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw refuse("invalid_args", "`playerDefaults` must be an object, e.g. `{ \"cps\": 40, \"autoForwardDelay\": 1500 }`.");
    }
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!(PLAYER_PREFERENCE_KEYS as readonly string[]).includes(key)) {
            throw refuse("invalid_args", `playerDefaults.${key}: not a player preference.`, `Known: ${PLAYER_PREFERENCE_KEYS.join(", ")}.`);
        }
        const spec = PLAYER_PREFERENCE_SPECS[key as PlayerPreferenceKey];
        if (spec.kind === "boolean") {
            if (typeof value !== "boolean") {
                throw refuse("invalid_args", `playerDefaults.${key} must be true or false.`);
            }
        } else if (spec.kind === "number") {
            if (typeof value !== "number" || !Number.isFinite(value) || value < spec.min || value > spec.max) {
                throw refuse("invalid_args", `playerDefaults.${key} must be a number from ${spec.min} to ${spec.max}${spec.display.unit === "percent" ? " (0-1 = 0-100%)" : ` (${spec.display.unit})`}.`);
            }
        } else if (typeof value !== "string" || !(spec.options as readonly string[]).includes(value)) {
            throw refuse("invalid_args", `playerDefaults.${key} must be one of ${spec.options.join(", ")}.`);
        }
        patch[key] = value;
    }
    return patch as Partial<PlayerPreferences>;
}

export const projectSettingsSet: AgentToolHandler = async (args, { ctx, request, follow, log }) => {
    const name = readOptionalString(args, "name");
    const width = readOptionalInteger(args, "width", { min: 16, max: 16384 });
    const height = readOptionalInteger(args, "height", { min: 16, max: 16384 });
    const languages = readOptionalStringArray(args, "languages");
    const removeLanguages = readOptionalStringArray(args, "removeLanguages") ?? [];
    const playerDefaults = readPlayerDefaults(args);
    if (name === undefined && width === undefined && height === undefined && languages === undefined && removeLanguages.length === 0 && playerDefaults === undefined) {
        throw refuse("invalid_args", "Give at least one of `name`, `width`, `height`, `languages`, `removeLanguages`, `playerDefaults`.");
    }
    const project = ctx.services.get<ProjectService>(Services.Project);
    const changed: string[] = [];
    let languagePlan: LanguagePlan | null = null;
    if (languages !== undefined || removeLanguages.length > 0) {
        languagePlan = await changeLanguages({ ctx, request, follow }, languages?.map(code => code.trim()), removeLanguages.map(code => code.trim()));
        if (languagePlan.add.length > 0 || languagePlan.remove.length > 0) {
            changed.push("languages");
            log("info", `languages +[${languagePlan.add.join(", ")}] -[${languagePlan.remove.join(", ")}]`);
        }
    }
    // Every write below follows an await - the languages, or the setting written before it - and the
    // author may have paused at any of them, so each one asks the gate again.
    if (name !== undefined && name !== project.getProjectConfig().name) {
        assertAgentMayStillWrite({ ctx, request, follow }, writtenSoFar(changed));
        await project.updateProjectName(name);
        changed.push("name");
    }
    if (width !== undefined || height !== undefined) {
        const current = project.getProjectConfig().metadata?.resolution ?? DEFAULT_RESOLUTION;
        const next = { width: width ?? current.width, height: height ?? current.height };
        if (next.width !== current.width || next.height !== current.height) {
            assertAgentMayStillWrite({ ctx, request, follow }, writtenSoFar(changed));
            await project.updateProjectMetadata({ resolution: next });
            changed.push("resolution");
            log("info", `resolution ${current.width}x${current.height} -> ${next.width}x${next.height}`);
        }
    }
    if (playerDefaults) {
        const current = project.getPlayerPreferences();
        const differing = (Object.keys(playerDefaults) as PlayerPreferenceKey[]).filter(key => current[key] !== playerDefaults[key]);
        if (differing.length > 0) {
            assertAgentMayStillWrite({ ctx, request, follow }, writtenSoFar(changed));
            await project.updatePlayerPreferences(playerDefaults);
            changed.push("player defaults");
            log("info", `player defaults ${differing.map(key => `${key}=${String(playerDefaults[key])}`).join(", ")}`);
        }
    }
    const config = project.getProjectConfig();
    const localization = languagePlan ? ctx.services.get<LocalizationService>(Services.Localization).getConfiguration() : null;
    return answerJson(
        {
            changed,
            name: config.name,
            resolution: config.metadata?.resolution ?? DEFAULT_RESOLUTION,
            ...(playerDefaults ? { playerDefaults: project.getPlayerPreferences() } : {}),
            ...(languagePlan && localization
                ? {
                      sourceLanguage: localization.sourceLocale || null,
                      languages: localization.locales.map(locale => locale.code),
                      languagesAdded: languagePlan.add,
                      languagesRemoved: languagePlan.remove,
                  }
                : {}),
        },
        changed.length === 0 ? "Nothing changed: the project already had these settings." : `Changed ${changed.join(" and ")}.`
            + (changed.includes("resolution") ? " Existing pages keep their design size; resize them with ui_patch if they should follow." : "")
            + (languagePlan && languagePlan.remove.length > 0 ? " A removed language's translation file stays on disk; adding the language back restores it." : "")
            + (languagePlan && languagePlan.add.length > 0 ? " A new language starts untranslated: lint lists every line it lacks." : "")
            + (changed.includes("player defaults") ? " New players start with these; a player's own saved settings (and a Dev Mode session's) keep theirs." : ""),
    );
};
