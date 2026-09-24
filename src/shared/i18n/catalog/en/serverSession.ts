/**
 * `serverSession` - the window that asks whether one project uses the sign-in this installation
 * holds for its server.
 *
 * Its own namespace for the reason `projectTrust` has one: the window is Studio's rather than the
 * workspace's, and the workspace is only where the request that raised it came from.
 *
 * What agreeing does is said in `meaning`, as the result an author will see. Nothing here explains
 * how sign-ins are stored.
 */
export const serverSession = {
    /** Title bar of the window, not the question. */
    window: "Server Sign-in",
    title: "Use this sign-in for this project?",
    signedInAs: "Signed in as {name}",
    // The state until the author answers, in one sentence.
    unused: "This project has not used this sign-in before.",
    // The cost of agreeing, as the author will see it.
    meaning: "Versions from this project are sent and received as {name}.",
    later: "This can be changed under NarraLeaf Team in the project.",
    confirm: "Use sign-in",
    cancel: "Don't use",
    error: {
        load: "The sign-in details could not be read.",
    },
} as const;
