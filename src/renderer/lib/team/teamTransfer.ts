/**
 * Asking the main process to move a file between this project and a server.
 *
 * The other half of `teamCall.ts`, for the one thing a call cannot carry. A call is a named method
 * with JSON on either side; a file is a request that runs for minutes and says how far it has got.
 * So it has an event of its own, and this is the only place in the renderer that names it.
 *
 * ⚠ **Nothing here reads or writes a file, and nothing here reaches the network.** What crosses is a
 * path and a count; the reading, the writing, the certificate and the connection are all the main
 * process's, which is the rule every remote byte in Studio is held to.
 */
import { getInterface } from "@/lib/app/bridge";
import type {
    TeamTransferOutcome,
    TeamTransferRequest,
    TeamTransferView,
} from "@shared/types/teamTransfer";

/** What an answer that never arrived looks like, so a caller has one shape to read. */
function unreachable(detail: string): TeamTransferOutcome {
    return { ok: false, problem: { kind: "unavailable", detail } };
}

/**
 * One request, with the IPC's own failures folded into the answer.
 *
 * A window with no project open is refused by the handler rather than here - it is the handler that
 * knows which project a window has, and a renderer that decided for itself would be deciding about
 * a boundary it is on the wrong side of.
 */
export async function teamTransfer(request: TeamTransferRequest): Promise<TeamTransferOutcome> {
    let answered;
    try {
        answered = await getInterface().team.transfer(request);
    } catch (error) {
        return unreachable(error instanceof Error ? error.message : String(error));
    }
    if (!answered.success) {
        return unreachable(answered.error ?? "that could not be asked");
    }
    return answered.data;
}

/** Put one file where the room can read it, and say what it turned out to be. */
export async function offerTransfer(input: {
    remoteOrigin: string;
    project: string;
    transferId: string;
    label: string;
    source: string;
}): Promise<TeamTransferOutcome> {
    return teamTransfer({ action: "offer", ...input });
}

/** Start collecting one file into the place it belongs. */
export async function collectTransfer(input: {
    remoteOrigin: string;
    project: string;
    transferId: string;
    label: string;
    destination: string;
    size: number;
    digest: string;
}): Promise<TeamTransferOutcome> {
    return teamTransfer({ action: "collect", ...input });
}

/** Stop these and take them off the server. */
export async function abandonTransfers(
    remoteOrigin: string,
    project: string,
    transferIds: readonly string[],
): Promise<TeamTransferOutcome> {
    return teamTransfer({ action: "abandon", remoteOrigin, project, transferIds });
}

/** Pick up whatever this project left half-carried. */
export async function resumeTransfers(
    remoteOrigin: string,
    project: string,
): Promise<TeamTransferOutcome> {
    return teamTransfer({ action: "resume", remoteOrigin, project });
}

/**
 * Everything this window is carrying or collecting.
 *
 * Empty rather than a refusal when nothing can be asked: what this answers drives a progress band,
 * and a band that cannot be drawn is one that is not there rather than one that reports an error.
 */
export async function listTransfers(): Promise<readonly TeamTransferView[]> {
    const answered = await teamTransfer({ action: "status" });
    return answered.ok && answered.kind === "transfers" ? answered.transfers : [];
}
