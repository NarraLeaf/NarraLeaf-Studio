import { collectTransfer, listTransfers, offerTransfer } from "@/lib/team/teamTransfer";
import { isVersioned } from "@shared/vcs/workingSet";
import { ASSET_CONTENT_ROOT } from "@shared/authority/project";
import { BaseFileSystemService } from "../core/FileSystem";
import { Services, type WorkspaceContext } from "../services";
import { SaveStatusService } from "../autosave/SaveStatusService";
import { WorkspaceReloadService } from "../core/WorkspaceReloadService";
import type { TeamFilePorts } from "./teamFileSync";

/** Where a window keeps the files it is carrying up or down, inside the project's own state folder. */
const SCRATCH = ".nlstudio/team";
/** Folders that hold no file that travels whole, skipped when only those are looked for. */
const NOT_WHOLE = [ASSET_CONTENT_ROOT, "editor/story/stories"];
/** How long a file coming down from the server may take before it is given up on. */
const COLLECT_TIMEOUT_MS = 10 * 60_000;

/**
 * The disk of one workspace, as {@link TeamFilePorts}: the project folder, the editors' savers and
 * re-reading, and the server's blob store for files too large to travel inline.
 */
export function createTeamFilePorts(ctx: WorkspaceContext, target: { remoteOrigin: string; project: string }): TeamFilePorts {
    const root = ctx.project.getConfig().projectPath.replace(/[\\/]+$/, "");
    const absolute = (path: string) => `${root}/${path}`;
    const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    const relativeOf = (path: string): string | null => {
        const normalized = path.split("\\").join("/");
        const base = root.split("\\").join("/");
        const folded = separator === "\\";
        const inside = folded ? normalized.toLowerCase().startsWith(`${base.toLowerCase()}/`) : normalized.startsWith(`${base}/`);
        return inside ? normalized.slice(base.length + 1) : null;
    };
    const ensureParent = async (path: string) => {
        const at = path.lastIndexOf("/");
        if (at > 0) await BaseFileSystemService.createDir(absolute(path.slice(0, at)));
    };

    return {
        list: async scope => {
            const found: string[] = [];
            const walk = async (relative: string): Promise<void> => {
                const listed = await BaseFileSystemService.list(relative === "" ? root : absolute(relative));
                if (!listed.ok) return;
                for (const entry of listed.data) {
                    const path = relative === "" ? entry.fileName : `${relative}/${entry.fileName}`;
                    if (!isVersioned(path)) continue;
                    if (entry.type === "directory") {
                        if (scope === "whole" && NOT_WHOLE.some(skip => path === skip)) continue;
                        await walk(path);
                    } else {
                        found.push(path);
                    }
                }
            };
            await walk("");
            return found.sort();
        },
        read: async path => {
            const read = await BaseFileSystemService.readRaw(absolute(path));
            return read.ok ? read.data : null;
        },
        write: async (path, bytes) => {
            await ensureParent(path);
            const written = await BaseFileSystemService.writeRaw(absolute(path), bytes);
            if (!written.ok) throw new Error(written.error.message);
        },
        remove: async path => {
            await BaseFileSystemService.deleteFile(absolute(path));
        },
        flush: async () => {
            await ctx.services.get<SaveStatusService>(Services.SaveStatus).flushAll();
        },
        reload: async () => {
            await ctx.services.get<WorkspaceReloadService>(Services.WorkspaceReload).reload("external");
        },
        digest: async bytes => {
            const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
            return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        },
        offer: async (path, bytes) => {
            const transferId = globalThis.crypto.randomUUID();
            const scratch = `${SCRATCH}/outbox/${transferId}`;
            await ensureParent(scratch);
            const written = await BaseFileSystemService.writeRaw(absolute(scratch), bytes);
            if (!written.ok) return null;
            const answered = await offerTransfer({ ...target, transferId, label: path, source: absolute(scratch) });
            if (!answered.ok || answered.kind !== "offered") return null;
            return { transferId, digest: answered.digest, size: answered.size };
        },
        collect: async (path, transfer) => {
            const scratch = `${SCRATCH}/inbox/${transfer.transferId}`;
            await ensureParent(scratch);
            const started = await collectTransfer({ ...target, ...transfer, label: path, destination: absolute(scratch) });
            if (!started.ok) return null;
            const deadline = Date.now() + COLLECT_TIMEOUT_MS;
            while (Date.now() < deadline) {
                const view = (await listTransfers()).find(entry => entry.transferId === transfer.transferId);
                if (view?.state === "failed") return null;
                if (view === undefined || view.state === "done") {
                    const read = await BaseFileSystemService.readRaw(absolute(scratch));
                    if (read.ok && read.data.length === transfer.size) {
                        await BaseFileSystemService.deleteFile(absolute(scratch));
                        return read.data;
                    }
                    if (view?.state === "done") return null;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            return null;
        },
        observe: listener => BaseFileSystemService.observeWrites(outcome => {
            if (!outcome.ok) return;
            const path = relativeOf(outcome.path);
            if (path !== null) listener(path);
        }),
    };
}
