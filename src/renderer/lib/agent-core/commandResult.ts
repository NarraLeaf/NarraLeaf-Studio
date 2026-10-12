/**
 * What a text-format command answers with, wherever it runs.
 *
 * The three command lines (`ui`, `story`, `blueprint`) and Studio's agent bridge run the same
 * command bodies. A body never prints: it returns the lines the command line would have written to
 * stdout and to stderr, and the exit code it would have left with. The command line writes them out
 * one call per entry, in the order the body made them, exactly as it did when the body printed for
 * itself (`emitCommandResult`); the bridge hands `out` to the agent as the tool's text and `err` as
 * its notes. So the help pages and the format guides, which quote that output, stay true for both.
 *
 * ## Order is part of the output
 *
 * Two streams read separately cannot tell what order they were written in, but a terminal that
 * shows both can, and that is where these commands are read: `Nothing written.` belongs after the
 * diagnostics that explain it. So a result keeps one list of writes tagged by stream, and the
 * command line replays it as it was made.
 *
 * ## A body that throws still said what it said
 *
 * Some bodies call back into their caller after they have written something - `story stories` asks
 * for each story's document as it lists them, `apply` asks the caller to keep the change - and the
 * command line's callbacks throw when the project cannot be read. Printing as it went, the command
 * listed the stories that opened and then the error; buffered, the error would arrive alone. A body
 * makes such a call through `guard`, which hangs what was written so far on the error, and the
 * command line says it (`emitPartialOutput`) before it reports the error.
 *
 * Comments in English per project convention.
 */

export type CommandStream = "out" | "err";

/** One write, as the body made it. */
export type CommandWrite = { stream: CommandStream; text: string };

export type CommandResult = {
    /** 0 clean, 1 problems found, 2 bad usage or unreadable input - the command line's exit codes. */
    exitCode: 0 | 1 | 2;
    /** Each entry is one write to stdout; the command line ends each with a newline. */
    out: string[];
    /** Each entry is one write to stderr. */
    err: string[];
    /** Every write to either stream, in the order the body made them. What the command line replays. */
    writes: CommandWrite[];
};

export type CommandIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

export type CommandWriter = CommandIo & {
    finish: (exitCode: CommandResult["exitCode"]) => CommandResult;
    /**
     * Make a (synchronous) call back into the caller. When it throws, the writes made so far travel
     * with the error, for the command line to say before the error itself - see the note at the top.
     */
    guard: <T>(call: () => T) => T;
};

/** Writes a body made before an error ended it, keyed by the error. See `guard`. */
const abandonedWrites = new WeakMap<object, CommandWrite[]>();

/** A result being built up, with the same two calls a command body used to make on its `io`. */
export function commandWriter(): CommandWriter {
    const out: string[] = [];
    const err: string[] = [];
    const writes: CommandWrite[] = [];
    return {
        out: text => {
            out.push(text);
            writes.push({ stream: "out", text });
        },
        err: text => {
            err.push(text);
            writes.push({ stream: "err", text });
        },
        finish: exitCode => ({ exitCode, out, err, writes }),
        guard: call => {
            try {
                return call();
            } catch (error) {
                if (typeof error === "object" && error !== null) {
                    // Ahead of anything already on it, which a body further in wrote after these.
                    abandonedWrites.set(error, [...writes, ...(abandonedWrites.get(error) ?? [])]);
                }
                throw error;
            }
        },
    };
}

function replay(writes: readonly CommandWrite[], io: CommandIo): void {
    for (const write of writes) {
        io[write.stream](write.text);
    }
}

/** Write a result to an `io`, every write on its own stream and in the order the body made it. */
export function emitCommandResult(result: CommandResult, io: CommandIo): number {
    replay(result.writes, io);
    return result.exitCode;
}

/**
 * Write what a body had said before `error` ended it, if anything, and forget it. The command line
 * calls this first thing when a command throws, so the output comes before the error's message.
 */
export function emitPartialOutput(error: unknown, io: CommandIo): void {
    if (typeof error !== "object" || error === null) {
        return;
    }
    const writes = abandonedWrites.get(error);
    if (writes) {
        abandonedWrites.delete(error);
        replay(writes, io);
    }
}

/** The stdout entries as one text, the way a terminal would show them. */
export function commandText(result: Pick<CommandResult, "out">): string {
    return result.out.join("\n");
}
