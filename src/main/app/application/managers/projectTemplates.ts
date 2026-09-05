import fs from "fs/promises";
import path from "path";
import { pickTemplateContentLocale, type ProjectTemplateDescriptor } from "@shared/types/projectTemplate";
import { isStageSizeUsable, stageSizesEqual, type StageSize } from "@shared/types/stageSize";
import {
    PROJECT_TEMPLATE_CONTENT_DIR,
    projectTemplateContentDirForLocale,
    PROJECT_TEMPLATE_MANIFEST,
} from "@shared/constants/projectTemplate";

/**
 * Project templates that ship inside Studio.
 *
 * **Bundled, not fetched.** A new project has to be creatable on a machine with no
 * network — it is the first thing an author does, and the one moment where failing
 * leaves them with nothing at all. So these live under `resources/templates/`,
 * which electron-builder copies whole into the installer, and are read from disk.
 *
 * A template is a manifest plus a `content/` tree that is copied verbatim over the
 * freshly written project skeleton. Verbatim is the point: the ids inside an
 * authored project (assets, surfaces, stories) reference each other, and anything
 * that rewrote them on the way in would have to understand every one of those file
 * formats. Two projects made from the same template share those ids and never meet,
 * exactly as with any project template.
 *
 * A template may also ship its content a second time, written in another language
 * (`content.<locale>/`, declared as `contentLocales` in the manifest). That tree is
 * copied over the first one when the author is writing in that language, so what
 * they open is a project authored in it — story, screens and layer names alike -
 * rather than an English project with a translation attached. It stays a verbatim
 * copy of files prepared beforehand: nothing here reads a story or a surface.
 */

/** `id` comes from the renderer, so it must not be able to name a directory elsewhere. */
const SAFE_TEMPLATE_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** The shape a plugin id has, so a malformed manifest cannot write nonsense into a project's table. */
const SAFE_PLUGIN_ID = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;

/** Where a project keeps its translations, relative to the project root. */
const TEMPLATE_LOCALIZATION_DIR = ["editor", "localization"] as const;

/** The key catalogue sits beside the translations and is not one of them. */
const TEMPLATE_LOCALIZATION_KEYS_FILE = "keys.json";

/** A filename only counts as a language if it reads as one; anything else is some other JSON. */
const SAFE_LOCALE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Never copied out of a template, whatever the template ships. */
function isExcludedFromScaffold(relativePath: string): boolean {
    const name = path.basename(relativePath).toLowerCase();
    // The project config is generated per project from the author's own name, app id
    // and resolution. A template shipping one would silently rename their project.
    return name.endsWith(".nlproj");
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/**
 * One language a template ships a whole second copy of its content in.
 *
 * `remove` names the base files the variant replaces rather than adds to. A copy is
 * additive, and the one thing a translated variant needs to take away is a base
 * translation file: the language the base content was translated INTO is the language
 * the variant is written in, so left behind it would register a language whose every
 * unit translates itself.
 */
type TemplateContentLocale = { remove: string[] };

/**
 * A path a variant may take out of a project: relative, and pointing downwards.
 *
 * These paths delete files inside a project that has just been created, so they are
 * checked here as well as resolved against the project root later — a template is
 * ours, but a template is also data, and data is the thing that gets edited.
 */
function isSafeContentPath(value: unknown): value is string {
    return typeof value === "string"
        && value.length > 0
        && !path.isAbsolute(value)
        && value.split(/[\\/]/).every(segment => segment !== "" && segment !== "." && segment !== "..");
}

function asContentLocales(value: unknown): Record<string, TemplateContentLocale> {
    const locales: Record<string, TemplateContentLocale> = {};
    if (!value || typeof value !== "object") {
        return locales;
    }
    for (const [code, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!SAFE_LOCALE_CODE.test(code)) {
            continue;
        }
        const remove = entry && typeof entry === "object" && Array.isArray((entry as Record<string, unknown>).remove)
            ? ((entry as Record<string, unknown>).remove as unknown[]).filter(isSafeContentPath)
            : [];
        locales[code] = { remove };
    }
    return locales;
}

/** The manifest as parsed JSON, or `null` if the directory has no readable one. */
async function readManifestRecord(templateDir: string): Promise<Record<string, unknown> | null> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(path.join(templateDir, PROJECT_TEMPLATE_MANIFEST), "utf-8"));
    } catch {
        return null;
    }
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
}

/**
 * Read one template's manifest, or `null` if the directory is not a template.
 * A malformed manifest costs its own template, never the list.
 */
async function readManifest(templatesDir: string, id: string): Promise<ProjectTemplateDescriptor | null> {
    if (!SAFE_TEMPLATE_ID.test(id)) {
        return null;
    }
    const record = await readManifestRecord(path.join(templatesDir, id));
    if (!record) {
        return null;
    }
    const name = asString(record.name);
    if (!name) {
        return null;
    }
    const locales: Record<string, { name?: string; description?: string }> = {};
    if (record.locales && typeof record.locales === "object") {
        for (const [locale, value] of Object.entries(record.locales as Record<string, unknown>)) {
            if (value && typeof value === "object") {
                const entry = value as Record<string, unknown>;
                locales[locale] = {
                    name: asString(entry.name) || undefined,
                    description: asString(entry.description) || undefined,
                };
            }
        }
    }
    const designSizes = asStageSizes(record.designSizes);
    const contentLocales = Object.keys(asContentLocales(record.contentLocales)).sort();
    const dependencies = asPluginIds(record.dependencies);
    return {
        id,
        name,
        description: asString(record.description),
        version: asString(record.version),
        locales,
        designSize: asStageSize(record.designSize),
        designSizes: designSizes.length > 0 ? designSizes : undefined,
        contentLocales: contentLocales.length > 0 ? contentLocales : undefined,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
    };
}

/** A plugin id the template names as its own dependency; anything else in the list is dropped. */
function asPluginIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const ids: string[] = [];
    for (const entry of value) {
        const id = asString(entry).trim();
        if (SAFE_PLUGIN_ID.test(id) && !ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids.sort();
}

function asStageSize(value: unknown): StageSize | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.width !== "number" || typeof record.height !== "number") {
        return undefined;
    }
    const size = { width: record.width, height: record.height };
    // A size outside the bounds is dropped rather than offered: the wizard would show it as the
    // only choice a template allows, and creating at it produces a stage nothing can lay out in.
    return isStageSizeUsable(size) ? size : undefined;
}

function asStageSizes(value: unknown): StageSize[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const sizes: StageSize[] = [];
    for (const entry of value) {
        const size = asStageSize(entry);
        if (size && !sizes.some(existing => stageSizesEqual(existing, size))) {
            sizes.push(size);
        }
    }
    return sizes;
}

/** Every template bundled with this build, in directory order. */
export async function listProjectTemplates(templatesDir: string): Promise<ProjectTemplateDescriptor[]> {
    let entries: string[];
    try {
        entries = (await fs.readdir(templatesDir, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        // No templates directory at all is a legitimate build, not an error.
        return [];
    }
    const templates: ProjectTemplateDescriptor[] = [];
    for (const id of entries.sort()) {
        const manifest = await readManifest(templatesDir, id);
        if (manifest) {
            templates.push(manifest);
        }
    }
    return templates;
}

async function copyTree(sourceDir: string, targetDir: string, relativePath = ""): Promise<number> {
    const entries = await fs.readdir(path.join(sourceDir, relativePath), { withFileTypes: true });
    let copied = 0;
    for (const entry of entries) {
        const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
        if (entry.isDirectory()) {
            await fs.mkdir(path.join(targetDir, childRelative), { recursive: true });
            copied += await copyTree(sourceDir, targetDir, childRelative);
            continue;
        }
        if (!entry.isFile() || isExcludedFromScaffold(childRelative)) {
            continue;
        }
        const target = path.join(targetDir, childRelative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Overwrites: the generated skeleton wrote empty defaults (an interface
        // document with one blank page, empty asset shards) and the template's
        // versions of those files are the content the author asked for.
        await fs.copyFile(path.join(sourceDir, childRelative), target);
        copied += 1;
    }
    return copied;
}

/** What a scaffold leaves behind, beyond the files themselves. */
export type ScaffoldResult = {
    filesCopied: number;
    /** The languages the finished project has translations for. */
    locales: string[];
    /** Plugin ids the template declares its content depends on. */
    dependencies: string[];
    /** The language variant of the content that landed, when one did. */
    contentLocale?: string;
};

/**
 * Copy a bundled template's content over a project that has just been written.
 *
 * Runs after the generated skeleton and before version control is enabled, so the
 * first revision records the project the author actually received rather than an
 * empty one that grew content in its second commit.
 *
 * `locale` is the language the author said they are writing the story in. When the
 * template ships its content in that language too, that copy goes on top of the base
 * one - the project is then authored in it, rather than being the English project with
 * a translation attached, which is a different thing to open on the first morning.
 */
export async function scaffoldProjectFromTemplate(
    templatesDir: string,
    templateId: string,
    projectPath: string,
    locale?: string,
): Promise<ScaffoldResult> {
    if (!SAFE_TEMPLATE_ID.test(templateId)) {
        throw new Error(`Unsafe project template id: ${templateId}`);
    }
    const templateDir = path.join(templatesDir, templateId);
    const contentDir = path.join(templateDir, PROJECT_TEMPLATE_CONTENT_DIR);
    // Belt and braces over the id check: whatever `templateId` was, the directory
    // finally read must still be inside the bundled templates directory.
    const resolvedContent = path.resolve(contentDir);
    if (!resolvedContent.startsWith(path.resolve(templatesDir) + path.sep)) {
        throw new Error(`Project template escapes the templates directory: ${templateId}`);
    }
    const stat = await fs.stat(resolvedContent).catch(() => null);
    if (!stat?.isDirectory()) {
        // A template with a manifest and no content is a metadata-only entry; it
        // produces the plain skeleton rather than failing the author's creation.
        return { filesCopied: 0, locales: [], dependencies: [] };
    }
    let filesCopied = await copyTree(resolvedContent, projectPath);
    const contentLocale = await applyContentLocale(templateDir, projectPath, locale);
    if (contentLocale) {
        filesCopied += contentLocale.filesCopied;
    }
    return {
        // Read from the project rather than from the template: after a variant has landed,
        // the languages the author can reach are the files in front of them, and those are
        // not the ones the base content shipped.
        locales: await readScaffoldedLocales(projectPath),
        filesCopied,
        // Handed back rather than written here: the table needs each plugin's installed
        // version, which the window that asked for the scaffold is the side that can read.
        dependencies: asPluginIds((await readManifestRecord(templateDir))?.dependencies),
        ...(contentLocale ? { contentLocale: contentLocale.code } : {}),
    };
}

/**
 * Lay the variant written in `locale` over the content already copied, if there is one.
 *
 * Copying a second tree rather than editing the first: what the variant replaces are
 * whole authored documents (the story, the interface, the translations), and a file is
 * the only form of them that this module can carry across without reading them.
 */
async function applyContentLocale(
    templateDir: string,
    projectPath: string,
    locale: string | undefined,
): Promise<{ code: string; filesCopied: number } | null> {
    if (!locale) {
        return null;
    }
    const declared = asContentLocales((await readManifestRecord(templateDir))?.contentLocales);
    const code = pickTemplateContentLocale(locale, Object.keys(declared));
    if (!code) {
        return null;
    }
    const variantDir = path.resolve(templateDir, projectTemplateContentDirForLocale(code));
    const stat = await fs.stat(variantDir).catch(() => null);
    if (!stat?.isDirectory()) {
        // Declared and missing: the author gets the base content, which is the whole
        // project minus its language. Failing here would cost them the project instead.
        return null;
    }
    const filesCopied = await copyTree(variantDir, projectPath);
    for (const relative of declared[code].remove) {
        const target = path.resolve(projectPath, relative);
        if (target.startsWith(path.resolve(projectPath) + path.sep)) {
            await fs.rm(target, { force: true });
        }
    }
    return { code, filesCopied };
}

/**
 * The locale codes the scaffolded project now has a translation file for.
 *
 * The registry of a project's languages lives in its `.nlproj`, which is generated per project
 * and never copied out of a template - so a template that ships `editor/localization/zh-CN.json`
 * handed the author the file and no way to reach it: the localization panel listed the source
 * language alone, and the translations were on disk, complete, addressed to nobody. Reporting the
 * codes here is what lets the creator register them.
 *
 * Derived from the files rather than declared in the manifest, so the two cannot disagree: the
 * languages a template offers ARE the ones it has translations for, and adding a language to a
 * template is adding its file. Read after every copy for the same reason - a content variant
 * brings its own set, and the base's are not it.
 */
async function readScaffoldedLocales(projectPath: string): Promise<string[]> {
    const localizationDir = path.join(projectPath, ...TEMPLATE_LOCALIZATION_DIR);
    const entries = await fs.readdir(localizationDir, { withFileTypes: true }).catch(() => null);
    if (!entries) {
        return [];
    }
    return entries
        .filter(entry => entry.isFile() && entry.name.endsWith(".json") && entry.name !== TEMPLATE_LOCALIZATION_KEYS_FILE)
        .map(entry => entry.name.slice(0, -".json".length))
        .filter(code => SAFE_LOCALE_CODE.test(code))
        .sort();
}
