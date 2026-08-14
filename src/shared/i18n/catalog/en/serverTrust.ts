/**
 * `serverTrust` - the window that asks whether one server is trusted.
 *
 * Its own namespace rather than a corner of `workspace`: the window opens over Settings
 * as readily as over a project, and belongs to neither.
 *
 * Nothing here names a trust store, a chain or a root. What the author is agreeing to is
 * said in `meaning`, in the words of the thing itself, and the name for the machinery
 * behind it is not theirs to learn.
 */
export const serverTrust = {
    /** Title bar of the window, not the question. */
    window: "Server Trust",
    title: "Trust this server?",
    /** The authority's subject, on one line, under the address it answers for. */
    issuedBy: "Issued by {subject}",
    fingerprint: "Fingerprint",
    // The cost of being wrong, in one sentence and without softening it. The account
    // rather than the computer is not a detail: it is what bounds the damage.
    meaning: "Once trusted, certificates issued by this authority are accepted for this account.",
    confirm: "Trust it",
    cancel: "Cancel",
    working: "Trusting…",
    error: {
        load: "The server details could not be read.",
        // Covers a refusal by the operating system and a system with nothing to install
        // into. Whatever the command printed follows this line where there is any.
        trust: "This authority was not trusted.",
    },
} as const;
