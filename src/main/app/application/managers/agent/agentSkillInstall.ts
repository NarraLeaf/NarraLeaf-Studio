import path from "path";
import { AGENT_INSTALLED_SKILLS, type AgentClientDescriptor } from "@shared/agent/clients";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "../../../../buildWorker/mobile/zipWriter";
import { copySkillTree, type SkillExportFs } from "./agentWorkspaceAccess";

/**
 * Putting the bundled skill where an agent application looks for it: a copy into its skill folder,
 * or a zip for one that takes an upload. The file operations are injected, as the export's are, so
 * both can be tested on a temporary directory.
 *
 * Comments in English per project convention.
 */

/** The skill folder of a `folder` client under `home`, or null for a client that has none. */
export function agentSkillDir(home: string, client: AgentClientDescriptor): string | null {
    return client.skill === "folder" && client.skillDir ? path.join(home, ...client.skillDir) : null;
}

/** `path` with the home folder written as `~`, which is how the agents' own documentation names these folders. */
export function homeRelativeDisplay(home: string, target: string): string {
    const relative = path.relative(home, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return target;
    }
    return `~/${relative.split(path.sep).join("/")}`;
}

/**
 * Copy every bundled skill folder into `targetDir`, each under its own name. Files of the same name
 * are replaced - which is how a newer Studio updates the skill - and anything else in the folder,
 * the author's other skills above all, is left as it is.
 */
export async function installSkillFolders(fs: SkillExportFs, sourceRoot: string, targetDir: string): Promise<number> {
    let copied = 0;
    for (const name of AGENT_INSTALLED_SKILLS) {
        copied += await copySkillTree(fs, path.join(sourceRoot, name), path.join(targetDir, name));
    }
    return copied;
}

export type SkillZipFs = Pick<SkillExportFs, "readdir"> & {
    readFile(file: string): Promise<Buffer>;
};

/**
 * The main skill as a zip with the folder at its root, which is the shape an uploaded skill takes
 * (Claude's Settings, Capabilities, Skills). Entries in name order and stamped with one fixed time,
 * so the same skill gives the same bytes.
 */
export async function buildSkillZip(fs: SkillZipFs, skillDir: string, rootName: string): Promise<Buffer> {
    const entries: ZipWriteEntry[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
        const children = (await fs.readdir(dir, { withFileTypes: true })).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const child of children) {
            const from = path.join(dir, child.name);
            const name = `${prefix}${child.name}`;
            if (child.isDirectory()) {
                await walk(from, `${name}/`);
            } else if (child.isFile()) {
                entries.push({ name, source: { kind: "buffer", data: await fs.readFile(from) }, method: "deflate", unixMode: 0o644 });
            }
        }
    };
    await walk(skillDir, `${rootName}/`);
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: new Date(Date.UTC(2026, 0, 1)), allowZip64: false });
    return output.toBuffer();
}
