/**
 * What the agent access window is asked about.
 *
 * Every confirmation agent access puts to the author shares the window: four of them decide how
 * far an outside program may reach, and the fifth writes into a folder the author picked. The
 * same threat decides where they are asked: a workspace runs plugin code, so none may be answered
 * by anything drawn inside one. The window is Studio's own, and everything in these props is
 * main's record, set when the window is made. The renderer reads them and sends back nothing but
 * the answer, so a plugin has no way to change which client is named or which folders are listed.
 *
 * The folder pickers stay native; only the questions moved here.
 */
export type AgentAccessPromptProps =
    | {
        kind: "folderAccess";
        /**
         * The connected client's name as main recorded it when the call arrived, or null when it
         * gave none. Never the renderer's word.
         */
        clientName: string | null;
        /** The folders an answer of "Allow" adds to the allowed list, already planned and capped. */
        folders: string[];
        /** The agent's own words for what it will do: one line, at most 300 characters. */
        reason?: string;
    }
    | {
        /** Agents may have writes and every folder but Studio's own. Asked in a warning tone. */
        kind: "fullAccess";
    }
    | {
        /**
         * Agent access may be switched on from a workspace's Agent menu: connected agents can then
         * read the projects open in Studio.
         */
        kind: "enable";
    }
    | {
        /** Agents may change projects. */
        kind: "allowWrites";
    }
    | {
        /** The skill export would write into a folder that already holds something. Warning tone. */
        kind: "exportOverwrite";
        /** The folder's own name, as the message names it. */
        folder: string;
        /** Where it is, in full. */
        path: string;
    };

export type AgentAccessPromptKind = AgentAccessPromptProps["kind"];

/**
 * How the window ended.
 *
 * `allowed` is the author's answer. `null` where the window closed without one - Escape, the
 * window it was raised over going away - which every caller reads as "no".
 */
export type AgentAccessPromptResult = { allowed: boolean } | null;
