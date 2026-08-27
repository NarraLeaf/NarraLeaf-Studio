import type { ReactNode } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useReadOnlyInspection } from "@/apps/workspace/components/ui/readOnlyInspection";
import { useWorkspaceFreezeReason } from "@/apps/workspace/hooks/useWorkspaceFrozen";
import { HelpTrigger, type HelpTopicId } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";

/**
 * Chrome for a project sub-page: a back header (title + optional description)
 * over a scrollable content area. The slide-in transition is owned by the
 * parent panel; this component only provides the static layout.
 *
 * A page whose parts each answer for themselves passes no `helpTopic` and tags its own
 * `SettingsGroup`s instead; this is for the pages that are one subject end to end.
 *
 * ⚠ **Says out loud when the project's own settings are read-only.** They all grey out together -
 * the project configuration is one file, and no freeze lets it through - and until this line
 * existed the only trace of why was a tooltip on fields that are disabled and therefore awkward to
 * hover at all. Said here rather than in each section because there are twenty of them across six
 * pages, and twenty copies of one sentence is a page about being frozen.
 *
 * ⚠ **It does not claim the whole screen is off, because during a session it is not.** Three of the
 * tables reachable from these pages have documents of their own that a session carries - the build
 * variants, the DLC and the palette - and they stay live while everything around them greys. The
 * live sentence says so in the one form that cannot go stale: what is still editable here is what
 * the session carries.
 */
export function ProjectSubPage({
    title,
    description,
    helpTopic,
    onBack,
    children,
}: {
    title: string;
    description?: string;
    helpTopic?: HelpTopicId;
    onBack: () => void;
    children: ReactNode;
}) {
    const { t } = useTranslation();
    // No scope, which is the unscoped guard's own meaning: blocked by any freeze at all. That is
    // exactly the project configuration's situation - it is in no session's writable set - and it
    // is what the sections writing it already ask.
    const frozen = useFreezeGuard().frozen;
    const inspecting = useReadOnlyInspection();
    const kind = useWorkspaceFreezeReason();
    // ⚠ The kind picks the SENTENCE and nothing else - the split `useFreezeUnavailableReason`
    // makes, with the same warning attached: what may be written is the write boundary's answer,
    // never a surface's reading of which freeze is armed.
    const notice = !frozen ? null
        : inspecting ? t("documentDiff.inspector.readOnly")
            : kind === "live-session" ? t("project.frozen.live")
                : t("project.frozen.frozen");
    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg" data-help-topic={helpTopic}>
            <div className="group/help flex items-center gap-2 border-b border-edge p-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    aria-label={t("project.subPage.backAria")}
                    data-tip={t("common.back")}
                >
                    <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{title}</div>
                    {description ? (
                        <div className="truncate text-2xs text-fg-subtle">{description}</div>
                    ) : null}
                </div>
                {helpTopic ? <HelpTrigger topic={helpTopic} /> : null}
            </div>
            {notice !== null && (
                <div
                    data-project-frozen
                    className="flex shrink-0 items-center gap-2 border-b border-edge bg-fill-subtle px-3 py-2"
                >
                    <Lock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 text-2xs text-fg-muted">{notice}</span>
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </div>
    );
}
