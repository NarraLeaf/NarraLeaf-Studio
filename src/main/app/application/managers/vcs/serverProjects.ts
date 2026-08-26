/**
 * Reading a project row out of what a server answered.
 *
 * A server records a project the moment it is created and reads its repository
 * afterwards, so between those two moments there is a project with no history —
 * and that is not a project with zero versions. **What a server did not say is
 * left out rather than defaulted**, all the way to the renderer, and this is
 * where that begins: a field the answer does not carry has to survive the trip
 * as nothing.
 *
 * Used by the main process, which asks a server about its projects over the
 * session it keeps open — see `serverProjectsSession`. The reading is here
 * rather than there because it is about what an answer means, which is the same
 * question whatever carried the bytes.
 */
import type {
    VcsServerProject,
    VcsServerProjectHistory,
    VcsServerProjectsProblem,
} from "@shared/types/vcs";

import { asRecord, numberField, textField } from "./serverApi";

/**
 * Why an ask did not produce a list.
 *
 * Coded rather than worded, for the reason the probe's failures are: the
 * sentence an author reads is written in the renderer, in their language, and a
 * string invented here would arrive in English in the middle of it.
 */
export type ServerProjectsProblem = VcsServerProjectsProblem;

export type ServerProjectsResult =
    | { ok: true; projects: VcsServerProject[] }
    | { ok: false; problem: ServerProjectsProblem };

export type ServerProjectResult =
    | { ok: true; project: VcsServerProject }
    | { ok: false; problem: ServerProjectsProblem };

/**
 * What the server has read off a project's repository, field by field.
 *
 * **Nothing is filled in.** A server that has not read the repository yet sends this
 * object with nothing in it, which is the ordinary case for a project made a moment ago,
 * and it has to survive the trip as nothing rather than as zeroes.
 */
function readHistory(value: unknown): VcsServerProjectHistory | undefined {
    const record = asRecord(value);
    if (record === null) return undefined;
    return {
        ...numberField(record, "revisions"),
        ...textField(record, "branch"),
        ...numberField(record, "bytes"),
        ...numberField(record, "lastAt"),
        ...textField(record, "lastBy"),
        ...textField(record, "lastMessage"),
    };
}

/** Read one project out of an answer, insisting on the fields everything downstream uses. */
export function readProject(value: unknown): VcsServerProject | null {
    const record = asRecord(value);
    if (record === null) return null;
    const id = record["id"];
    const name = record["name"];
    const remote = record["remote"];
    if (typeof id !== "string" || typeof name !== "string" || typeof remote !== "string") {
        return null;
    }
    const history = readHistory(record["history"]);
    return {
        id,
        name,
        description: typeof record["description"] === "string" ? record["description"] : "",
        ...(typeof record["createdBy"] === "string" ? { createdBy: record["createdBy"] } : {}),
        createdAt: typeof record["createdAt"] === "number" ? record["createdAt"] : 0,
        remote,
        ...(history === undefined ? {} : { history }),
    };
}
