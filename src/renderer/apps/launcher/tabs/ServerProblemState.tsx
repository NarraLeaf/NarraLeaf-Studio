import { KeyRound, ServerCrash, ServerOff, ShieldX, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";

// Picked by the sentence rather than by the refusal, because the sentence is what this tab
// keeps: several refusals share one sentence, and they share its picture with it.
const ICONS: Partial<Record<TranslationKey, LucideIcon>> = {
    "launcher.servers.problem.unreachable": ServerOff,
    "launcher.servers.problem.refused": ShieldX,
    "launcher.servers.problem.noToken": KeyRound,
};

/**
 * A server's refusal standing in for the whole list it refused - drawn as the same empty
 * state as the workspace's "not a project" screen (a boxed icon over a line) instead of a
 * red line of small text at the top of an otherwise blank pane.
 */
export function ServerProblemState({ problem }: { problem: TranslationKey }) {
    const { t } = useTranslation();
    const Icon = ICONS[problem] ?? ServerCrash;

    return (
        <div className="flex flex-col items-center px-8 py-16 text-center" role="status">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted">
                <Icon className="h-5 w-5" />
            </div>
            <p className="text-sm text-fg-muted">{t(problem)}</p>
        </div>
    );
}
