/**
 * A build stopped by something in the project, in a sentence written for its author.
 *
 * The pack is assembled in a worker process, so its failure reaches the build as text. An error
 * that comes from a defect in Studio travels with its stack, because that is what someone fixing
 * Studio needs. One of these travels as its message alone: the build dialog and the console print it
 * as it is, it is the whole of what the author is told, and a stack under it reads as a crash rather
 * than as something in their project to change.
 */
export class BuildRefusal extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BuildRefusal";
    }
}

/** The text a worker sends for an error it caught: a refusal's sentence, anything else with its stack. */
export function describeWorkerFailure(error: unknown): string {
    if (error instanceof BuildRefusal) {
        return error.message;
    }
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
