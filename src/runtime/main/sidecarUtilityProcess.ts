/**
 * Starting a `kind: "node"` sidecar as an Electron utility process.
 *
 * These used to run under the game's own binary with `ELECTRON_RUN_AS_NODE=1`, which meant the
 * shipped game had to keep the `RunAsNode` fuse open - and that fuse is a way into the game that
 * has nothing to do with sidecars: it turns the executable into a general Node interpreter that
 * runs any script named on the command line, with the app's own native modules loadable and none
 * of the main script's guards on the way. It is also the one route that steps around asar
 * integrity, because nothing loads the app at all. A utility process needs no such fuse: Electron
 * starts the child itself.
 *
 * The one thing a utility process does not have is stdin. `process.stdin` there is an
 * already-ended stream, and it is a non-configurable getter, so nothing can hand the child a
 * different one. So a node sidecar reads its frames from `process.parentPort` instead:
 *
 *   - **Frames both ways over the port**, newline-delimited JSON exactly as before. A null message
 *     is the end of input, which is the "terminate now" signal stdin EOF used to be.
 *   - **stdout and stderr are both log channels.** An executable sidecar keeps stdout as the
 *     protocol; here the protocol is the port, so anything the child prints is a log line.
 *
 * The adapter below presents all of that as the same {@link SidecarChildProcess} shape a spawned
 * process has, so the host's framing, restart, shutdown and logging are one implementation rather
 * than two.
 *
 * Comments in English per project convention.
 */

import { utilityProcess } from "electron/main";
import type {
    SidecarChildProcess,
    SidecarReadableStream,
    SidecarSpawnOptions,
    SidecarWritableStream,
} from "./sidecarHost";

/** The smallest thing that can stand in for a piped stream the host listens to. */
class MessageStream implements SidecarReadableStream {
    private readonly listeners: Array<(chunk: unknown) => void> = [];

    public on(event: "data", listener: (chunk: unknown) => void): this {
        if (event === "data") {
            this.listeners.push(listener);
        }
        return this;
    }

    public emit(chunk: unknown): void {
        for (const listener of [...this.listeners]) {
            listener(chunk);
        }
    }
}

/**
 * Start one node sidecar.
 *
 * `entry` is the .js file, run as the main module - `require.main` is the sidecar's own module, its
 * `__dirname` is its own directory, and its arguments arrive on `process.argv` where a program
 * started any other way would find them.
 */
export function forkSidecarUtilityProcess(
    entry: string,
    args: readonly string[],
    options: SidecarSpawnOptions,
): SidecarChildProcess {
    const child = utilityProcess.fork(entry, [...args], {
        cwd: options.cwd,
        env: options.env as Record<string, string>,
        // stdin cannot be anything but ignored here; the two we can have are the log channels.
        stdio: ["ignore", "pipe", "pipe"],
        // What `app.getAppMetrics` and the crash reports call it. Without this every sidecar shows
        // up as "Node Utility Process" and a crash report cannot say which one went down.
        serviceName: options.label,
    });

    const frames = new MessageStream();
    child.on("message", message => {
        frames.emit(typeof message === "string" ? message : String(message));
    });

    /*
     * Writing a frame posts it. `end()` posts the one message that is not a frame: null, which the
     * sidecar reads as the end of input. It is deliberately the same event stdin EOF was, so a
     * sidecar's shutdown path is the shape it always had.
     */
    const stdin: SidecarWritableStream = {
        write(chunk: string): boolean {
            child.postMessage(chunk);
            return true;
        },
        end(): void {
            child.postMessage(null);
        },
    };

    /*
     * Both pipes are logs here, so both go to the channel the host treats as logs. A sidecar that
     * prints its frames on stdout - the shape an executable one uses - gets them read as log lines
     * rather than silently swallowed, which is the difference between a plugin author seeing their
     * mistake and not.
     */
    const logs = new MessageStream();
    // Both pipes exist as soon as fork returns, and a paused stream holds whatever the child wrote
    // before anything read it, so nothing the sidecar says on its way up is lost.
    child.stdout?.on("data", chunk => logs.emit(chunk));
    child.stderr?.on("data", chunk => logs.emit(chunk));

    return {
        get pid() {
            return child.pid;
        },
        stdin,
        stdout: frames,
        stderr: logs,
        on(event: "error", listener: (error: Error) => void) {
            // A utility process reports a V8 fatal error with a type and a location rather than an
            // Error, and the host only wants something it can put in a log line.
            child.on("error", (type: string, location: string) => listener(new Error(`${type} at ${location}`)));
            return this;
        },
        once(event: "exit", listener: (code: number | null, signal: string | null) => void) {
            // No signal ever: Electron ends a utility process itself and reports only a code.
            child.once("exit", (code: number) => listener(code, null));
            return this;
        },
        kill(): boolean {
            // One kill, whichever signal the caller had in mind. The escalation the host runs for a
            // spawned process has no equivalent here, and asking twice is harmless.
            return child.kill();
        },
    };
}
