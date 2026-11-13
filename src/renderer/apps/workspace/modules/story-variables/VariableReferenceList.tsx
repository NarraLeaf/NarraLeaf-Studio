import { useEffect, useState } from "react";
import type { TranslationKey } from "@shared/i18n/catalog";
import type { StoryId, StoryVariableRef } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { loadRenameStories } from "@/lib/workspace/services/refactor/applyRename";
import { collectVariableReferences, type ReferenceSite } from "@/lib/workspace/services/refactor/renameModel";
import { resolveVariableSubject } from "@/lib/workspace/services/refactor/resolveRename";
import { jumpToSearchTarget } from "../search/searchJump";
import { referenceSiteDetail, referenceSitePlace } from "../refactor/referenceSiteText";

/**
 * Where one variable is read and where it is written, read off the whole project while the list is
 * open and again whenever a story or the registry changes under it.
 */
function useVariableReferences(ref: StoryVariableRef, storyId: StoryId | undefined): ReferenceSite[] | null {
    const { context } = useWorkspace();
    const [sites, setSites] = useState<ReferenceSite[] | null>(null);
    const refKey = `${ref.scope}:${ref.variableId}`;
    useEffect(() => {
        if (!context) {
            return;
        }
        let cancelled = false;
        let timer: number | null = null;
        const read = async () => {
            const stories = await loadRenameStories(context);
            const registry = context.services.get<VariableRegistryService>(Services.VariableRegistry).listEntries();
            let blueprints = null;
            try {
                blueprints = context.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
            } catch {
                blueprints = null;
            }
            const subject = resolveVariableSubject(ref, stories, registry, storyId);
            const found = collectVariableReferences({ stories, ref, declaration: subject?.declaration, registry, blueprints })
                .filter(site => site.access !== "declaration");
            if (!cancelled) {
                setSites(found);
            }
        };
        const schedule = () => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(() => void read(), 250);
        };
        void read();
        const offStory = context.services.get<StoryService>(Services.Story).onDocumentChanged(schedule);
        const offRegistry = context.services.get<VariableRegistryService>(Services.VariableRegistry).onRegistryChanged(schedule);
        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            offStory();
            offRegistry();
        };
        // `ref` is identified by its key; a fresh object with the same key is the same variable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context, refKey, storyId]);
    return sites;
}

function SiteButton(props: { site: ReferenceSite }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const { site } = props;
    const target = site.target;
    return (
        <button
            type="button"
            disabled={!target}
            onClick={() => target && jumpToSearchTarget(target, { openEditorTab, setPanelVisibility, context })}
            className={cn(
                "flex w-full min-w-0 flex-col rounded-md px-2 py-1 text-left",
                "hover:bg-fill focus:border-primary disabled:cursor-not-allowed disabled:opacity-50",
            )}
        >
            <span className="flex min-w-0 items-baseline gap-2 text-xs">
                <span className="min-w-0 truncate text-fg">{referenceSitePlace(site, t)}</span>
                <span className="shrink-0 text-2xs text-fg-subtle">{referenceSiteDetail(site, t)}</span>
            </span>
            {site.excerpt ? <span className="min-w-0 truncate font-mono text-2xs text-fg-muted">{site.excerpt}</span> : null}
        </button>
    );
}

/** The two lists under an expanded variable row: reads, then writes. */
export function VariableReferenceList(props: { variableRef: StoryVariableRef; storyId?: StoryId }) {
    const { t } = useTranslation();
    const sites = useVariableReferences(props.variableRef, props.storyId);
    if (!sites) {
        return null;
    }
    const reads = sites.filter(site => site.access === "read");
    const writes = sites.filter(site => site.access === "write");
    const section = (titleKey: string, list: ReferenceSite[]) => (
        <div className="flex flex-col gap-0.5">
            <div className="px-2 text-2xs text-fg-subtle">{t(titleKey as TranslationKey)} · {list.length}</div>
            {list.map(site => <SiteButton key={site.id} site={site} />)}
        </div>
    );
    return (
        <div className="ml-1 flex flex-col gap-1.5 border-l border-edge-subtle py-1 pl-2" data-variable-references="">
            {sites.length === 0 ? (
                <div className="px-2 text-2xs text-fg-subtle">{t("refactor.refs.none" as TranslationKey)}</div>
            ) : (
                <>
                    {section("refactor.refs.reads", reads)}
                    {section("refactor.refs.writes", writes)}
                </>
            )}
        </div>
    );
}
