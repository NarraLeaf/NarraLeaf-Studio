import fs from "fs/promises";
import path from "path";
import type { ProjectTemplateDescriptor } from "@shared/types/projectTemplate";
import { isStageSizeUsable, stageSizesEqual, type StageSize } from "@shared/types/stageSize";
import { PROJECT_TEMPLATE_CONTENT_DIR, PROJECT_TEMPLATE_MANIFEST } from "@shared/constants/projectTemplate";

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
 */

/** `id` comes from the renderer, so it must not be able to name a directory elsewhere. */
const SAFE_TEMPLATE_ID = /^[a-z0-9][a-z0-9._-]*$/;

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
 * Read one template's manifest, or `null` if the directory is not a template.
 * A malformed manifest costs its own template, never the list.
 */
async function readManifest(templatesDir: string, id: string): Promise<ProjectTemplateDescriptor | null> {
    if (!SAFE_TEMPLATE_ID.test(id)) {
        return null;
    }
    const manifestPath = path.join(templatesDir, id, PROJECT_TEMPLATE_MANIFEST);
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    const record = parsed as Record<string, unknown>;
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
    return {
        id,
        name,
        description: asString(record.description),
        version: asString(record.version),
        locales,
        designSize: asStageSize(record.designSize),
        designSizes: designSizes.length > 0 ? designSizes : undefined,
    };
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

/**
 * Copy a bundled template's content over a project that has just been written.
 *
 * Runs after the generated skeleton and before version control is enabled, so the
 * first revision records the project the author actually received rather than an
 * empty one that grew content in its second commit.
 */
export async function scaffoldProjectFromTemplate(
    templatesDir: string,
    templateId: string,
    projectPath: string,
): Promise<{ filesCopied: number }> {
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
        return { filesCopied: 0 };
    }
    return { filesCopied: await copyTree(resolvedContent, projectPath) };
}
