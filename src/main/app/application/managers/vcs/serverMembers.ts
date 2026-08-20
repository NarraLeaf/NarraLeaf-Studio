/**
 * Who is on a server, asked over the same API its projects are.
 *
 * A revision carries an identity string and nothing else, so until now a name on a
 * version was a name and an address an author either recognised or did not. This is the
 * roster behind those names: who else works here, which of them administers the server,
 * and which of them is a machine.
 *
 * **The address is read and not published.** Every account on one server can already ask
 * for this list, so an address here is not a secret being handed out — but a list that
 * prints everybody's address at once is a different artefact from an address on one
 * revision, and it is the kind of thing that gets screenshotted into a chat. So it
 * crosses this boundary, because the renderer needs it the moment somebody opens one
 * member, and the renderer is where the decision not to draw it by default lives.
 *
 * Only reached when the server advertised `members`; a server that did not is never asked
 * (see `serverCan` in the renderer), so a 404 here is a fault rather than an ordinary
 * answer.
 */
import type { VcsServerMember } from "@shared/types/vcs";

import {
    STUDIO_API_ROOT,
    asRecord,
    askServer,
    numberField,
    type ServerApiProblem,
} from "./serverApi";

/** Where the roster lives. */
const MEMBERS_PATH = `${STUDIO_API_ROOT}/members`;

export type ServerMembersResult =
    | { ok: true; members: VcsServerMember[] }
    | { ok: false; problem: ServerApiProblem };

/**
 * One account, insisting only on the name it answers to.
 *
 * The username is the identity: it is what a revision is written with, what an operator
 * types, and the one field a server cannot omit. A display name it did not give falls
 * back to the username rather than to a blank, because a row with no name is a row nobody
 * can read — and that is a presentation fallback, not an invented fact.
 *
 * The three flags default to false. That is the only direction that is safe to guess in:
 * a server too old to say who administers it says nothing about anybody, and marking
 * nobody is a plain list, where marking somebody would be a claim about their authority.
 */
function readMember(value: unknown): VcsServerMember | null {
    const record = asRecord(value);
    if (record === null) return null;
    const username = record["username"];
    if (typeof username !== "string" || username.trim() === "") return null;
    const displayName = record["displayName"];
    return {
        username,
        displayName: typeof displayName === "string" && displayName.trim() !== ""
            ? displayName
            : username,
        email: typeof record["email"] === "string" ? record["email"] : "",
        operator: record["operator"] === true,
        disabled: record["disabled"] === true,
        serviceAccount: record["serviceAccount"] === true,
        ...numberField(record, "createdAt"),
    };
}

/** Everyone one server holds an account for, as that server lists them. */
export async function listServerMembers(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
}): Promise<ServerMembersResult> {
    const answer = await askServer({ ...options, path: MEMBERS_PATH });
    if (!answer.ok) return answer;

    const list = asRecord(answer.value)?.["members"];
    if (!Array.isArray(list)) return { ok: false, problem: { kind: "unknown" } };
    const members = list.map(readMember);
    // All or nothing, as with the projects list: a roster with somebody quietly missing
    // from it is worse than no roster, because it reads as complete.
    if (members.some((member) => member === null)) {
        return { ok: false, problem: { kind: "unknown" } };
    }
    return { ok: true, members: members as VcsServerMember[] };
}
