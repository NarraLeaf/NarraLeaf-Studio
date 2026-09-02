/**
 * `projectTrust` - the window that asks whether one project is trusted.
 *
 * Its own namespace rather than a corner of `workspace`: the window opens over the launcher, the
 * wizard's opener and a workspace alike, and belongs to none of them. The project's origin is
 * labelled with the settings page's own words (`settings.data.projectTrust.origin`), so the two
 * surfaces never disagree about how a project arrived.
 *
 * What the author is agreeing to is said in `meaning`, in the words of the thing itself. Nothing
 * here explains the ledger.
 */
export const projectTrust = {
    /** Title bar of the window, not the question. */
    window: "Project Trust",
    title: "Trust this project?",
    // The state until the author agrees, in one sentence: what still works, and what does not.
    untrusted: "Studio did not create this project. Until it is trusted, it can be edited but not run, previewed, built or tested.",
    // The cost of agreeing, without softening it.
    meaning: "Once trusted, the code this project ships runs on this machine.",
    later: "This can be changed under Trusted projects in Settings.",
    confirm: "Trust",
    cancel: "Not now",
    error: {
        load: "The project details could not be read.",
    },
} as const;
