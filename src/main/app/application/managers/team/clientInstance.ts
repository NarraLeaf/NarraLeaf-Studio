/**
 * What this installation of Studio calls itself to a Team server.
 *
 * A server has to be able to tell one installation from another, and nothing it already
 * holds answers that. **An account is a person** - one person is routinely a desktop and
 * a laptop, and a room that could only say "Ada is here twice" would be a room nobody
 * could route anything through. **A connection is new every time** - identifying by one
 * would make the same machine a stranger after every reconnect, which is the opposite of
 * what a live session needs.
 *
 * So there is an id, it is minted here on first use, and it is kept. Three things about
 * it are decisions rather than details:
 *
 *  - **It is not a credential.** It authorises nothing, it is not checked, and a server
 *    that is handed somebody else's learns only that two windows claimed one name. What
 *    authorises anything is the token, which never leaves the main process.
 *  - **It is not what a collaborator reads.** The label beside it is, and the label is a
 *    setting: it falls back to this machine's host name, and somebody who would rather
 *    not publish their host name to their team's server can say so in Settings.
 *  - **It never crosses to the renderer.** A window asks for an announcement to be made;
 *    it is not handed an identity to make one with. That is the same rule the sealed
 *    token follows, for the weaker but same reason: an identity that a renderer could
 *    state is one a plugin could state.
 */
import { hostname } from "os";
import { randomUUID } from "crypto";

/** The two operations this needs of the global state, named so a test can pass a map. */
export interface InstallationStore {
    get: (key: "team.installationId" | "team.machineLabel") => unknown;
    set: (key: "team.installationId" | "team.machineLabel", value: string) => void;
}

const ID_KEY = "team.installationId";
const LABEL_KEY = "team.machineLabel";

/**
 * This installation's id, minting one the first time it is asked for.
 *
 * Written back on the way out, so the next launch reads the same string. There is no
 * default in the state's defaults table on purpose: those are written to every profile on
 * disk the first time it is read, and a default here would hand every installation in the
 * world the same id.
 */
export function installationId(state: InstallationStore): string {
    const stored: unknown = state.get(ID_KEY);
    if (typeof stored === "string" && stored !== "") {
        return stored;
    }
    const minted = randomUUID();
    state.set(ID_KEY, minted);
    return minted;
}

/**
 * What a collaborator sees this machine called.
 *
 * The setting where somebody has written one, this machine's host name otherwise, and a
 * plain word where even that cannot be read. Never empty: a row in a list of who is here
 * with nothing in its name column is worse than a generic one.
 */
export function machineLabel(state: InstallationStore): string {
    const chosen: unknown = state.get(LABEL_KEY);
    if (typeof chosen === "string" && chosen.trim() !== "") {
        return chosen.trim();
    }
    try {
        const name = hostname();
        if (name !== "") {
            return name;
        }
    } catch {
        // A host with no name to read. Rare, and not a reason to fail to connect.
    }
    return "this machine";
}

/** Which client and which build, for a line in somebody's server log. */
export function studioAgent(version: string): string {
    return `NarraLeaf Studio ${version}`;
}
