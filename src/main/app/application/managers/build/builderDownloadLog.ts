import type { DownloadProgressEvent } from "@shared/types/downloadProgress";

/**
 * Reads electron-builder's own output for the downloads it starts without telling anybody.
 *
 * A production build fetches things Studio never asked for by name: the Electron distribution for a
 * cross-platform target, the NSIS and AppImage tooling, the code-signing helpers, 7za. On a machine
 * that has none of them cached those are the longest minutes of the build, and until now they were
 * also the quietest - the packaging phase simply stopped for a while.
 *
 * ## Why this is a parser and not a callback
 *
 * There is no seam to hook. The toolchain artifacts go through `executeAppBuilder`, which hands the
 * work to `app-builder`, a Go binary; the Electron distribution goes the same way through
 * `unpack-electron`. Neither crosses back into JavaScript between the request and the finished file,
 * so nothing in the Node process can be wrapped to observe them. The one thing that does come back
 * is the child's own log, on the worker's standard streams, which the build console already prints.
 *
 * ## What makes that acceptable to depend on
 *
 * Its failure mode. These lines are electron-builder's, not a contract, and a future release may
 * word them differently - at which point this stops matching and the status bar goes back to saying
 * nothing during a download. It cannot start saying something wrong: an unmatched line produces no
 * event, and every transfer this does open is closed by the packaging step ending whether or not the
 * closing line was ever recognised. A readout that can only fall silent is worth having; one that
 * could invent a download would not be.
 *
 * Deliberately not a progress source. Both halves announce a download and then announce that it
 * finished, with nothing in between - app-builder's byte counter is a terminal progress bar drawn to
 * a TTY the worker does not have, and its `size` field reports `18 EB` for any server that does not
 * send a content length. So these tasks say what is being fetched and spin. The downloads Studio
 * makes itself - the code-signing bundle, a Zig toolchain - count their own bytes and do report a
 * fraction; see {@link readBodyWithProgress}.
 */

/** `\x1b[…m` and friends: the child colours its output when it thinks a terminal is listening. */
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * A line opens or closes a transfer, or says nothing about one.
 *
 * Anchored at the start of the line after the level bullet, so a line that merely mentions
 * downloading - a plugin's own log, an artifact whose name contains the word - is not one of these.
 */
const MARKER = /^\s*(?:[•⨯*]\s*)?(downloading|downloaded)\b(.*)$/;

/** `url=…`, which both halves emit, and which names the file rather than the request. */
const URL_FIELD = /\burl=(\S+)/;
/** What the JavaScript half emits instead: the release and the file inside it. */
const FILE_FIELD = /\bfile=(\S+)/;

/**
 * One transfer's identity, taken from the line.
 *
 * The URL is the natural one: the same address appears on the opening and closing lines, so the pair
 * matches without any state. Where there is no URL the file name serves, and where there is neither
 * the rest of the line does - two downloads announced identically are, as far as anything here can
 * tell, one download announced twice.
 */
function transferId(rest: string): string {
    return URL_FIELD.exec(rest)?.[1] ?? FILE_FIELD.exec(rest)?.[1] ?? rest.trim();
}

/**
 * What one line of a packaging worker's output means for the download readout, or null.
 *
 * Exported for its tests and used through {@link BuilderDownloadWatcher}, which is what callers want:
 * process output arrives in chunks that split lines wherever the pipe happened to fill.
 */
export function readBuilderDownloadLine(line: string): DownloadProgressEvent | null {
    const match = MARKER.exec(line.replace(ANSI, ""));
    if (!match) {
        return null;
    }
    const [, verb, rest] = match;
    const id = transferId(rest ?? "");
    if (id.length === 0) {
        return null;
    }
    return verb === "downloading"
        ? { phase: "start", id, kind: "toolchainDownload" }
        : { phase: "end", id };
}

/**
 * Feeds a stream of process output through {@link readBuilderDownloadLine}, holding back the tail.
 *
 * A chunk from a pipe ends wherever the buffer filled, which is regularly in the middle of the one
 * line that matters. Without this the opening line arrives as two halves and neither matches.
 */
export class BuilderDownloadWatcher {
    private pending = "";

    public constructor(private readonly emit: (event: DownloadProgressEvent) => void) {}

    public read(text: string): void {
        this.pending += text.replace(/\r\n?/g, "\n");
        const lines = this.pending.split("\n");
        // The last piece has no newline after it yet, so it may be half a line; it waits for the
        // rest rather than being tested and thrown away.
        this.pending = lines.pop() ?? "";
        for (const line of lines) {
            const event = readBuilderDownloadLine(line);
            if (event) {
                this.emit(event);
            }
        }
    }
}
