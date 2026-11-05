import type { CommandLineRunLogLine } from "@shared/types/commandLineRun";
import { getCommandLineRunEnd } from "./commandLineRunEnd";

/** Where a command-line run's lines go besides standard output: the profile's own log. */
export type CommandLineRunLogSink = { info(message: string): void };

/**
 * Keep a line of a command-line run, print it, and write it into the profile's log.
 *
 * Standard output carries the prose, which is what a person tailing a job reads; the report file
 * carries the same lines with their timestamps and levels intact, which is what a job archives.
 * Nothing a script needs is read off this stream - see the report.
 *
 * The log file is written as the run goes. Standard output is the stream a job captures, but on
 * Windows it is buffered by whoever redirected it, so a run that ends without a clean exit - a
 * renderer that took the process with it - takes its whole console with it and leaves the operator
 * nothing to read.
 */
export function recordCommandLineRunLine(
    log: CommandLineRunLogLine[],
    sink: CommandLineRunLogSink,
    line: CommandLineRunLogLine,
): void {
    log.push(line);
    // Every line is progress, to the watchdog as to the run's own deadline.
    getCommandLineRunEnd()?.progress();
    const source = line.source ? `${line.source}: ` : "";
    const text = `[${line.level}] ${source}${line.message}`;
    process.stdout.write(`${text}\n`);
    sink.info(`[CommandLine] ${text}`);
}

/**
 * Wait for everything written to standard output to have left this process.
 *
 * Writes to a pipe are asynchronous on Windows - and a pipe is exactly what a build agent captures
 * output through - so `exit()` can end the process with the last few lines still queued. Which lines
 * those are is the worst possible sample: the outcome and the exit code are the last thing written.
 * An empty write is enough, because the callback runs behind everything already in the queue.
 *
 * Resolves rather than rejects if the stream is gone: the exit code is what carries the result, and
 * losing the log must not turn a finished run into a failed one.
 */
export function flushStandardOutput(): Promise<void> {
    return new Promise<void>(resolve => {
        try {
            process.stdout.write("", () => resolve());
        } catch {
            resolve();
        }
    });
}

export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
