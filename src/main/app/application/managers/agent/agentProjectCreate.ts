import crypto from "crypto";
import path from "path";
import { transliterate } from "transliteration";
import { unpatchedFsPromises as fs } from "../../../../utils/unpatchedFs";
import { encodeProjectConfig, getProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";
import { isValidLocaleCode, localeAutonym } from "@shared/types/localization";
import { NEW_PROJECT_TEXT_REVEAL_DURATION, normalizePlayerPreferences } from "@shared/types/preference";
import { stageOrientation, type StageSize } from "@shared/types/stageSize";
import { PROJECT_DEPENDENCY_SCHEMA_VERSION, type ProjectPluginDependency } from "@shared/types/pluginDependencies";
import { NEW_PROJECT_DIRECTORIES, newProjectFiles } from "@shared/project/newProject";
import { listProjectTemplates, scaffoldProjectFromTemplate, type ScaffoldResult } from "../projectTemplates";

/**
 * `project_create`: write a new project on disk, the way the project wizard writes one.
 *
 * The wizard writes through the renderer, out of a window the author is filling in; an agent is not
 * a window, so this runs in the main process. What it writes is the same project, by construction
 * where that is possible: the empty skeleton is `@shared/project/newProject`, which the wizard
 * writes from too, and a template's content lands through the very `scaffoldProjectFromTemplate`
 * the wizard's scaffold request runs. What is repeated here is the project config's contents and
 * the two follow-up writes the wizard makes into it after a template lands (its languages and its
 * plugin dependencies), because those live in the wizard's renderer code; they are short, and the
 * comments on the wizard's versions say why each exists.
 *
 * The directory the agent names was not picked in a folder dialog. That is acceptable because the
 * author switched agent writes on, which is the consent this tool runs under; what this module adds
 * is refusing to write into a directory that already has anything in it.
 */

export type AgentProjectCreateInput = {
    name: string;
    /** Absolute parent directory; the project lands in `<parentDir>/<appId>`. */
    parentDir: string;
    template: "skeleton" | "empty";
    language: string;
    width: number;
    height: number;
};

export type InstalledPluginInfo = {
    pluginId: string;
    builtIn: boolean;
    manifest: { name: string; publisher?: string; version: string };
};

export type AgentProjectCreateResult =
    | { ok: true; projectPath: string; appId: string; scaffold: ScaffoldResult | null }
    | { ok: false; code: "invalid_args" | "unavailable"; message: string; hint?: string };

export async function writeAgentProject(
    input: AgentProjectCreateInput,
    deps: {
        templatesDir: string;
        installedPlugins: () => Promise<InstalledPluginInfo[]>;
        createId?: () => string;
    },
): Promise<AgentProjectCreateResult> {
    const name = input.name.trim();
    if (!name) {
        return { ok: false, code: "invalid_args", message: "The project needs a name." };
    }
    if (!path.isAbsolute(input.parentDir)) {
        return { ok: false, code: "invalid_args", message: `dir must be an absolute path: ${input.parentDir}` };
    }
    const designSize: StageSize = { width: input.width, height: input.height };
    if (!Number.isInteger(designSize.width) || !Number.isInteger(designSize.height) || designSize.width < 64 || designSize.height < 64) {
        return { ok: false, code: "invalid_args", message: "width and height must be whole numbers of at least 64 pixels." };
    }

    if (input.template !== "empty") {
        // A template's surfaces are laid out in absolute coordinates for the sizes it declares; a
        // project at any other size has its interface off the edge of its own stage. The wizard
        // offers only the declared sizes for the same reason.
        const templates = await listProjectTemplates(deps.templatesDir);
        const template = templates.find(entry => entry.id === input.template);
        if (!template) {
            return { ok: false, code: "unavailable", message: `The ${input.template} template is not installed with this Studio.` };
        }
        const sizes = template.designSizes?.length ? template.designSizes : template.designSize ? [template.designSize] : [];
        if (sizes.length > 0 && !sizes.some(size => size.width === designSize.width && size.height === designSize.height)) {
            return {
                ok: false,
                code: "invalid_args",
                message: `The ${input.template} template is laid out for ${sizes.map(size => `${size.width}x${size.height}`).join(", ")}, not ${designSize.width}x${designSize.height}.`,
                hint: "Use one of those sizes, or the empty template for a free size.",
            };
        }
    }

    const appId = suggestAppId(name);
    const projectPath = path.join(path.resolve(input.parentDir), appId);
    const existing = await fs.readdir(projectPath).catch(() => null);
    if (existing && existing.length > 0) {
        return {
            ok: false,
            code: "unavailable",
            message: `${projectPath} already exists and is not empty.`,
            hint: "Pick another name or parent directory; to work on an existing project, call project_open.",
        };
    }

    await fs.mkdir(projectPath, { recursive: true });
    const sourceLocale = input.language.trim();
    const configPath = path.join(projectPath, getProjectConfigFileName(name));
    let config: ProjectConfigData = {
        name,
        identifier: appId,
        metadata: {
            description: "",
            author: "",
            website: "",
            // Without it the build preflight refuses (`version-missing`).
            version: "1.0.0",
            resolution: designSize,
        },
        app: newProjectAppConfiguration(sourceLocale, designSize),
    };
    await fs.writeFile(configPath, encodeProjectConfig(config));

    for (const directory of NEW_PROJECT_DIRECTORIES) {
        await fs.mkdir(path.join(projectPath, ...directory), { recursive: true });
    }
    const createId = deps.createId ?? (() => crypto.randomUUID());
    for (const file of newProjectFiles(designSize, createId)) {
        await fs.writeFile(path.join(projectPath, ...file.path), file.text, "utf8");
    }

    let scaffold: ScaffoldResult | null = null;
    if (input.template !== "empty") {
        scaffold = await scaffoldProjectFromTemplate(deps.templatesDir, input.template, projectPath, sourceLocale);
        const withLocales = registerTemplateLocales(config, scaffold.locales);
        const withDependencies = await registerTemplateDependencies(withLocales, scaffold.dependencies, deps.installedPlugins);
        if (withDependencies !== config) {
            config = withDependencies;
            await fs.writeFile(configPath, encodeProjectConfig(config));
        }
    }

    return { ok: true, projectPath, appId, scaffold };
}

/**
 * The `app` block a new project starts with: only what the wizard has an answer for. The network
 * policy is left out on purpose - an absent policy reads as the secure default, which is exactly
 * what the wizard writes out in full - and the mobile block is the documented defaults with the
 * orientation the stage implies.
 */
function newProjectAppConfiguration(sourceLocale: string, designSize: StageSize): Record<string, unknown> {
    return {
        preferences: {
            ...normalizePlayerPreferences(undefined),
            textRevealDuration: NEW_PROJECT_TEXT_REVEAL_DURATION,
        },
        mobile: {
            orientation: stageOrientation(designSize),
            fit: "contain",
            cropAnchorX: "center",
            cropAnchorY: "center",
        },
        ...(isValidLocaleCode(sourceLocale)
            ? { localization: { sourceLocale, locales: [{ code: sourceLocale, displayName: localeAutonym(sourceLocale) }] } }
            : {}),
    };
}

/** The wizard's `registerTemplateLocales`: the translations a template shipped, made reachable. */
function registerTemplateLocales(config: ProjectConfigData, codes: readonly string[]): ProjectConfigData {
    const app = config.app as { localization?: { sourceLocale: string; locales: { code: string; displayName: string }[] } } | undefined;
    const existing = app?.localization;
    if (!existing || !isValidLocaleCode(existing.sourceLocale)) {
        return config;
    }
    const known = new Set(existing.locales.map(entry => entry.code));
    const added = codes.filter(code => isValidLocaleCode(code) && !known.has(code));
    if (added.length === 0) {
        return config;
    }
    return {
        ...config,
        app: {
            ...config.app,
            localization: {
                sourceLocale: existing.sourceLocale,
                locales: [...existing.locales, ...added.map(code => ({ code, displayName: localeAutonym(code) }))],
            },
        },
    };
}

/** The wizard's `registerTemplateDependencies`: the plugins a template is built on, declared from the first open. */
async function registerTemplateDependencies(
    config: ProjectConfigData,
    pluginIds: readonly string[],
    installedPlugins: () => Promise<InstalledPluginInfo[]>,
): Promise<ProjectConfigData> {
    if (pluginIds.length === 0) {
        return config;
    }
    try {
        const installed = new Map((await installedPlugins()).map(plugin => [plugin.pluginId, plugin] as const));
        const plugins: ProjectPluginDependency[] = [];
        for (const id of [...pluginIds].sort()) {
            const match = installed.get(id);
            if (!match) {
                continue;
            }
            plugins.push({
                id,
                name: match.manifest.name,
                publisher: match.manifest.publisher,
                builtIn: match.builtIn,
                authoredVersion: match.manifest.version,
                hard: true,
                usedBy: {},
            });
        }
        return plugins.length === 0
            ? config
            : { ...config, dependencies: { schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION, plugins } };
    } catch {
        // As in the wizard: the first scan writes the table anyway.
        return config;
    }
}

/**
 * An app id - and the project's folder name - from the project name, by the wizard's rule:
 * transliterated, lower case, `[a-z0-9-]`. A name that transliterates to nothing usable (a title in
 * a script `transliteration` cannot romanize) gets a neutral id with a random tail rather than a
 * folder called `-`.
 */
export function suggestAppId(name: string): string {
    const id = transliterate(name)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50);
    return id || `game-${crypto.randomBytes(3).toString("hex")}`;
}
