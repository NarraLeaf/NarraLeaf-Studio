import type { TranslationKey } from "@shared/i18n";
import type { VcsServerProjectsProblem } from "@shared/types/vcs";

/**
 * The sentence for each way a server can refuse a question.
 *
 * One table for every question this tab asks - what it holds, who is on it, what it knows
 * about one project - because the refusals are the same refusals: the server was not
 * reached, or it did not accept the account signed in here. Nothing about that is
 * different for a roster than it is for a list of projects, and three copies of this map
 * would be three chances for one of them to grow a sentence of its own.
 *
 * **A capability the server does not offer is not in here**, and that is the point of
 * keeping the two apart: a missing capability is answered by not drawing the section, so
 * it never needs a sentence at all.
 */
export const SERVER_PROBLEM_KEYS: Record<VcsServerProjectsProblem["kind"], TranslationKey> = {
    "no-token": "launcher.servers.problem.noToken",
    refused: "launcher.servers.problem.refused",
    unreachable: "launcher.servers.problem.unreachable",
    // A server that gave a reason of its own still reads as the general case: what it put
    // in the refusal is English written for whoever runs it.
    rejected: "launcher.servers.problem.unknown",
    unknown: "launcher.servers.problem.unknown",
};
