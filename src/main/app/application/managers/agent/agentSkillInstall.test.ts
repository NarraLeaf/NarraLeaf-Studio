import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_CLIENTS, AGENT_INSTALLED_SKILLS, findAgentClient } from "@shared/agent/clients";
import { agentSkillDir, buildSkillZip, homeRelativeDisplay, installSkillFolders } from "./agentSkillInstall";

/**
 * Installing the skill writes into the author's own home folder, next to whatever skills they
 * already keep there. What matters is that it puts the bundled folders where the client reads them
 * and leaves everything else exactly as it was.
 */

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-skill-install-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

async function writeFile(file: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
}

describe("where each client's skill goes", () => {
    it("names a folder under home for folder clients and none for the rest", () => {
        const home = "/Users/author";
        expect(agentSkillDir(home, findAgentClient("claudeCode")!)).toBe(path.join(home, ".claude", "skills"));
        expect(agentSkillDir(home, findAgentClient("codex")!)).toBe(path.join(home, ".agents", "skills"));
        expect(agentSkillDir(home, findAgentClient("opencode")!)).toBe(path.join(home, ".agents", "skills"));
        for (const client of AGENT_CLIENTS.filter(entry => entry.skill !== "folder")) {
            expect(agentSkillDir(home, client)).toBeNull();
        }
    });

    it("writes the home folder as ~ and leaves other paths alone", () => {
        const home = path.join(root, "home");
        expect(homeRelativeDisplay(home, path.join(home, ".claude", "skills"))).toBe("~/.claude/skills");
        expect(homeRelativeDisplay(home, path.join(root, "elsewhere"))).toBe(path.join(root, "elsewhere"));
    });

    it("lists every client once", () => {
        expect(new Set(AGENT_CLIENTS.map(client => client.id)).size).toBe(AGENT_CLIENTS.length);
    });
});

describe("installSkillFolders", () => {
    it("copies the bundled skills in, replaces their files and keeps the author's other skills", async () => {
        const source = path.join(root, "bundled");
        for (const name of AGENT_INSTALLED_SKILLS) {
            await writeFile(path.join(source, name, "SKILL.md"), `new ${name}`);
            await writeFile(path.join(source, name, "references", "a.md"), "a");
        }
        await writeFile(path.join(source, "README.md"), "not a skill");
        const target = path.join(root, "home", ".claude", "skills");
        await writeFile(path.join(target, "their-skill", "SKILL.md"), "theirs");
        await writeFile(path.join(target, AGENT_INSTALLED_SKILLS[0], "SKILL.md"), "old");

        const copied = await installSkillFolders(fs, source, target);

        expect(copied).toBe(AGENT_INSTALLED_SKILLS.length * 2);
        expect(await fs.readFile(path.join(target, AGENT_INSTALLED_SKILLS[0], "SKILL.md"), "utf8")).toBe(`new ${AGENT_INSTALLED_SKILLS[0]}`);
        expect(await fs.readFile(path.join(target, "their-skill", "SKILL.md"), "utf8")).toBe("theirs");
        await expect(fs.access(path.join(target, "README.md"))).rejects.toThrow();
    });
});

describe("buildSkillZip", () => {
    it("puts the skill folder at the root of the archive and gives the same bytes twice", async () => {
        const skill = path.join(root, "narraleaf-make-game");
        await writeFile(path.join(skill, "SKILL.md"), "---\nname: narraleaf-make-game\n---\n");
        await writeFile(path.join(skill, "references", "story-format.md"), "rows");

        const zip = await buildSkillZip(fs, skill, "narraleaf-make-game");
        const again = await buildSkillZip(fs, skill, "narraleaf-make-game");

        expect(zip.equals(again)).toBe(true);
        const names = readCentralDirectoryNames(zip);
        expect(names).toEqual(["narraleaf-make-game/SKILL.md", "narraleaf-make-game/references/story-format.md"]);
        expect(readEntry(zip, "narraleaf-make-game/references/story-format.md").toString("utf8")).toBe("rows");
    });
});

/** The names in a zip's central directory, in order. */
function readCentralDirectoryNames(zip: Buffer): string[] {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = zip.readUInt16LE(eocd + 10);
    let offset = zip.readUInt32LE(eocd + 16);
    const names: string[] = [];
    for (let index = 0; index < count; index += 1) {
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

/** One entry's uncompressed bytes, read through its local header. */
function readEntry(zip: Buffer, name: string): Buffer {
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
        const method = zip.readUInt16LE(offset + 8);
        const compressedSize = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const entryName = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
        const start = offset + 30 + nameLength + extraLength;
        const data = zip.subarray(start, start + compressedSize);
        if (entryName === name) {
            return method === 8 ? zlib.inflateRawSync(data) : data;
        }
        offset = start + compressedSize;
    }
    throw new Error(`No entry ${name}`);
}
