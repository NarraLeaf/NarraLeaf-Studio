/**
 * What the sign-in window is asked about: one project, one server, and the account this
 * installation is signed in to that server as.
 *
 * Everything here is for reading. The host keeps the pair it asked about and writes the answer
 * itself, so nothing in these props is sent back or trusted on the way out.
 */
export interface ServerSessionPromptProps {
    /** The project's own name from its configuration, or its folder name when it has none. */
    projectName: string;
    /** The project directory. */
    projectPath: string;
    /** What the server calls itself, or its host where it gave no name. */
    serverName: string;
    /** The server's host and port, e.g. `team.example.lan:41337`. */
    serverHost: string;
    /** The name the account goes by on that server. */
    accountName: string;
    /** The account as a version records it, `Name <email>` or the username. */
    accountDetail: string;
}

/**
 * How the window ended.
 *
 * `use` is the author's answer and the host records it for the pair. `null` where the window was
 * closed without one: nothing is recorded, the request that raised it goes ahead without the
 * sign-in, and the question is put again the next time a request needs it.
 */
export type ServerSessionPromptResult = { use: boolean } | null;
