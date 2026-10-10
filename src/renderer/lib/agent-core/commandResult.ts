/**
 * What a text-format command answers with, wherever it runs.
 *
 * The three command lines (`ui`, `story`, `blueprint`) and Studio's agent bridge run the same
 * command bodies. A body never prints: it returns the lines the command line would have written to
 * stdout and to stderr, and the exit code it would have left with. The command line writes them out
 * one call per entry, exactly as it did when the body printed for itself (`emitCommandResult`); the
 * bridge hands `out` to the agent as the tool's text and `err` as its notes. So the help pages and
 * the format guides, which quote that output, stay true for both.
 *
 * Comments in English per project convention.
 */

export type CommandResult = {
    /** 0 clean, 1 problems found, 2 bad usage or unreadable input - the command line's exit codes. */
    exitCode: 0 | 1 | 2;
    /** Each entry is one write to stdout; the command line ends each with a newline. */
    out: string[];
    /** Each entry is one write to stderr. */
    err: string[];
};

export type CommandIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

/** A result being built up, with the same two calls a command body used to make on its `io`. */
export function commandWriter(): CommandIo & { finish: (exitCode: CommandResult["exitCode"]) => CommandResult } {
    const out: string[] = [];
    const err: string[] = [];
    return {
        out: text => {
            out.push(text);
        },
        err: text => {
            err.push(text);
        },
        finish: exitCode => ({ exitCode, out, err }),
    };
}

/**
 * Write a result to an `io`, stderr first.
 *
 * The order matches what the bodies did: everything they said on stderr - a note about a renamed
 * node, the line saying nothing was written - came before or beside the main output, and two
 * streams read separately cannot tell the difference.
 */
export function emitCommandResult(result: CommandResult, io: CommandIo): number {
    for (const text of result.err) {
        io.err(text);
    }
    for (const text of result.out) {
        io.out(text);
    }
    return result.exitCode;
}

/** The stdout entries as one text, the way a terminal would show them. */
export function commandText(result: Pick<CommandResult, "out">): string {
    return result.out.join("\n");
}
