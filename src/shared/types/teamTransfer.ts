/**
 * Moving a file between a project on this disk and a NarraLeaf Team server.
 *
 * **The one thing in the Team surface that is bytes rather than a call**, and it is a vocabulary of
 * its own for exactly that reason. Everything else Studio asks a server is a named method with JSON
 * on either side, which `team.call` carries; a file is a request that runs for minutes, reports
 * how far it has got, can be stopped, and must never put its contents through an inter-process
 * message. So the renderer names a **path** and never holds a byte: the main process reads the file
 * off disk and writes it to the socket, or reads the socket and writes the file, and the only
 * things that cross between the two processes are an address and a count.
 *
 * That is also what keeps the renderer's rule intact. The renderer does not reach the network; it
 * says which file and which project, and the main process resolves the server, presents the
 * certificate authority the author accepted and does the work.
 */

/** Which way a file is going. */
export type TeamTransferDirection =
    /** This machine has the file and the room does not. */
    | "out"
    /** The room has the file and this machine does not. */
    | "in";

/** Where a transfer has got to. */
export type TeamTransferState =
    /** Between attempts: interrupted, and waiting to be picked up again. */
    | "waiting"
    /** Bytes are moving now. */
    | "moving"
    /** Every byte is where it belongs, and verified. */
    | "done"
    /** It will not finish. `problem` says why. */
    | "failed";

/** Why a transfer will not happen, or will not finish. */
export type TeamTransferProblem =
    /** The project has as many bytes in flight on that server as it may. */
    | { kind: "quota"; limit: number }
    /** The server is not answering. Ordinary, and retried. */
    | { kind: "offline"; detail: string }
    /** Every byte arrived and they are not the file that was sent. */
    | { kind: "corrupt" }
    /** The server has nothing under that name. Somebody cancelled, or the server was restarted. */
    | { kind: "gone" }
    /** The server said no, in its own words. */
    | { kind: "refused"; detail: string }
    /** This build has no session with that server, or no token for it. */
    | { kind: "unavailable"; detail: string };

/** One file on the move, as a window reads it. */
export interface TeamTransferView {
    /** What the file is called on the server. `LiveAssetBytePart.transferId`. */
    readonly transferId: string;
    /**
     * What the window called it when it asked.
     *
     * Opaque here: the main process neither reads it nor writes it anywhere, and it exists so a
     * panel can find the row a transfer belongs to without keeping a second table.
     */
    readonly label: string;
    readonly direction: TeamTransferDirection;
    /** How many bytes have moved. */
    readonly bytes: number;
    /** How many there are altogether. */
    readonly total: number;
    readonly state: TeamTransferState;
    readonly problem?: TeamTransferProblem;
}

/** What a window asks the main process to do about bytes. */
export type TeamTransferRequest =
    /**
     * Take this file, and put it where the room can read it.
     *
     * Answered once the file has been measured and fingerprinted and the server has agreed to hold
     * it - which is deliberately **before** the bytes have gone anywhere, because that answer is
     * what the operation naming the file is stated on. A refusal here is a refusal an author is
     * told about by name, rather than an import that stops halfway on somebody else's screen.
     */
    | {
        readonly action: "offer";
        readonly remoteOrigin: string;
        readonly project: string;
        readonly transferId: string;
        readonly label: string;
        /** The file, on this disk. Inside the project this window has open. */
        readonly source: string;
    }
    /**
     * Collect this file, and put it here.
     *
     * Returns as soon as the collection has begun. What tells a caller it has finished is the file
     * being where it asked for it, which `status` reports.
     */
    | {
        readonly action: "collect";
        readonly remoteOrigin: string;
        readonly project: string;
        readonly transferId: string;
        readonly label: string;
        /** Where the file belongs, on this disk. Inside the project this window has open. */
        readonly destination: string;
        readonly size: number;
        readonly digest: string;
    }
    /**
     * Stop these, and take them off the server.
     *
     * What cancelling an import reaches, from whichever machine the author cancelled on. Safe to
     * ask about a transfer this machine has never heard of - every machine in the room applies the
     * same cancellation, so most of them are saying it about somebody else's transfer.
     */
    | {
        readonly action: "abandon";
        readonly remoteOrigin: string;
        readonly project: string;
        readonly transferIds: readonly string[];
    }
    /** Everything this window has in flight. */
    | { readonly action: "status" }
    /**
     * Pick up whatever was interrupted on this project.
     *
     * Asked when a window joins a session. A transfer outlives the session it began in and outlives
     * Studio being closed, so this is what turns "the file is half there" back into "the file is
     * arriving" rather than into a record whose file never came.
     */
    | { readonly action: "resume"; readonly remoteOrigin: string; readonly project: string };

/** What the main process answers. */
export type TeamTransferOutcome =
    /** An `offer` that the server has agreed to hold, with what the file turned out to be. */
    | { readonly ok: true; readonly kind: "offered"; readonly size: number; readonly digest: string }
    /** A `collect`, `abandon` or `resume` that was taken. */
    | { readonly ok: true; readonly kind: "accepted"; readonly count?: number }
    /** A `status`. */
    | { readonly ok: true; readonly kind: "transfers"; readonly transfers: readonly TeamTransferView[] }
    | { readonly ok: false; readonly problem: TeamTransferProblem };
