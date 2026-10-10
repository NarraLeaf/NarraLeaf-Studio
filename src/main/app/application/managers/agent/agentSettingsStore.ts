import crypto from "crypto";
import path from "path";
import { unpatchedFsPromises as fs } from "../../../../utils/unpatchedFs";
import {
    AGENT_SETTINGS_FILE_NAME,
    normalizeAgentSettings,
    type AgentSettingsFile,
} from "@shared/agent/settings";

/**
 * `<userData>/agent-mcp.json`: agent access's switches, its token, and the address it is served on.
 *
 * Owner-only (0600) from the moment it exists, because it holds the bearer token, and anything that
 * can read the token can change the author's projects while the server is on. The file is written
 * to a temporary name created with that mode and renamed over the old one, so there is never an
 * instant at which a reader sees half a file or a file with a looser mode - and a `chmod` follows
 * the rename for a profile whose file an older build, or a person, left readable.
 *
 * Read once at start-up and then served from memory; every change goes through {@link update}, which
 * writes before it returns. Nothing else writes the file, except a stdio bridge that only reads it.
 */
export class AgentSettingsStore {
    private settings: AgentSettingsFile | null = null;
    private writing: Promise<void> = Promise.resolve();

    constructor(private readonly userDataDir: string) {}

    public get filePath(): string {
        return path.join(this.userDataDir, AGENT_SETTINGS_FILE_NAME);
    }

    /** Read the file, minting a token (and writing it) when there is none yet. */
    public async load(): Promise<AgentSettingsFile> {
        if (this.settings) {
            return this.settings;
        }
        let raw: unknown = null;
        try {
            raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
        } catch {
            // Missing or unreadable: the defaults, which keep the server off.
        }
        let minted = false;
        const settings = normalizeAgentSettings(raw, () => {
            minted = true;
            return mintAgentToken();
        });
        // Whatever the previous run recorded as the live address is not live any more.
        settings.url = null;
        this.settings = settings;
        if (minted || raw === null || (raw as { url?: unknown })?.url) {
            await this.persist();
        }
        return settings;
    }

    /** The settings in memory. Only valid after {@link load}. */
    public get current(): AgentSettingsFile {
        if (!this.settings) {
            throw new Error("Agent settings were read before they were loaded");
        }
        return this.settings;
    }

    public async update(change: (draft: AgentSettingsFile) => void): Promise<AgentSettingsFile> {
        await this.load();
        // Cloned from what is in memory *after* the await, never from what `load` returned: two
        // updates started together would otherwise both start from the same base, and the second
        // would silently undo the first.
        const draft = structuredClone(this.current);
        change(draft);
        this.settings = draft;
        await this.persist();
        return draft;
    }

    /** Writes are queued so two quick changes land in order and the second is never overwritten by the first. */
    private persist(): Promise<void> {
        const snapshot = JSON.stringify(this.settings, null, 2) + "\n";
        const run = this.writing.then(() => writeOwnerOnly(this.filePath, snapshot));
        this.writing = run.catch(() => undefined);
        return run;
    }
}

/** 32 random bytes as URL-safe base64: long enough that guessing is not a strategy. */
export function mintAgentToken(): string {
    return crypto.randomBytes(32).toString("base64url");
}

export async function writeOwnerOnly(filePath: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
        await fs.writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
        await fs.rename(temporary, filePath);
    } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
    // Windows has no owner-only mode to set; `chmod` there only toggles read-only, which is not
    // what is wanted, so it is left to the profile directory's own ACL.
    if (process.platform !== "win32") {
        await fs.chmod(filePath, 0o600);
    }
}
