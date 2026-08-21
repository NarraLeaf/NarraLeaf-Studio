/**
 * The one word beside a project's server, decided once for every surface that draws it.
 *
 * Two different questions used to share that spot and only one of them was ever asked.
 * `serverFace` answers **how this branch stands against the server** - ahead, behind, up
 * to date, or not checked - and that is a question somebody presses Check to settle. What
 * the workspace now answers on its own is **whether the server is there and holds this
 * project**, and it answers it continuously.
 *
 * Beside an address, under a heading that says Server, "not checked" was read as the
 * second question rather than the first, and it stopped being true the moment the
 * workspace began checking. So the second question wins wherever it has something to say:
 * a server that is not answering, or one that does not hold this project, is the sentence
 * a reader needs, and no branch comparison outranks it.
 *
 * A project that checks out and has never had its sync compared reads "connected" rather
 * than "not checked" - which is what it is, and the branch comparison is one row away.
 */
import type { TranslationKey } from "@shared/i18n";
import type { VcsSyncState } from "@shared/types/vcs";

import { serverFace } from "../../components/layout/versionRailModel";
import type { TeamProjectState } from "../../hooks/useTeamProject";

export interface TeamFace {
    key: TranslationKey;
    detail: TranslationKey;
    tone: string;
}

export function teamServerFace(state: TeamProjectState, sync: VcsSyncState | null): TeamFace {
    if (state.kind === "not-there") {
        return {
            key: "workspace.shell.team.notThere",
            detail: "workspace.shell.team.notThere",
            tone: "text-warning",
        };
    }
    if (state.kind === "unreachable") {
        return {
            key: "workspace.shell.team.unreachable",
            detail: "workspace.shell.team.unreachable",
            tone: "text-warning",
        };
    }
    if (state.kind === "verified" && sync === null) {
        return {
            key: "workspace.shell.team.connected",
            detail: "workspace.shell.team.connected",
            tone: "text-fg-subtle",
        };
    }
    return serverFace(sync);
}
