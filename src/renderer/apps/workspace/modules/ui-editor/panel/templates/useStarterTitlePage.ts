import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import { useWorkspace } from "@/apps/workspace/context";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { addStarterTitlePage } from "./addStarterTitlePage";
import { hasNoInterfaceYet, STARTER_TITLE_PAGE_TEMPLATE_ID } from "./starterTitlePage";

/**
 * Whether this build ships the template the title page is taken from.
 *
 * Asked once per window: a build with no templates directory is legitimate, and an offer that can
 * only fail is worse than none.
 */
let availability: Promise<boolean> | null = null;

function isStarterTitlePageAvailable(): Promise<boolean> {
    if (!availability) {
        availability = getInterface().projectTemplates.list()
            .then(result => Boolean(result.success && result.data?.some(template => template.id === STARTER_TITLE_PAGE_TEMPLATE_ID)))
            .catch(() => false);
    }
    return availability;
}

export type StarterTitlePageOffer = {
    /** True while the project has no interface yet and the template is there to take the page from. */
    offered: boolean;
    /** Make the page. Resolves to it, or to null when it could not be made (the author is told why). */
    add: () => Promise<UISurface | null>;
};

/**
 * The title page offered to a project that has no interface yet, for whichever surface offers it.
 *
 * Two surfaces do - the interfaces panel and the Welcome tab - and both have to agree on when the
 * offer stands, so the rule lives here once: while no page and no Game UI has anything on it. The
 * first thing an author puts on any page ends the offer, and so does the page this makes.
 */
export function useStarterTitlePage(): StarterTitlePageOffer {
    const { context } = useWorkspace();
    const blueprintRevision = useBlueprintDocumentRevision();
    const [documentRevision, setDocumentRevision] = useState(0);
    const [available, setAvailable] = useState(false);
    const adding = useRef(false);

    const documentService = useMemo(() => {
        try {
            return context?.services.get<UIDocumentService>(Services.UIDocument) ?? null;
        } catch {
            return null;
        }
    }, [context]);

    useEffect(() => documentService?.onDocumentChanged?.(() => setDocumentRevision(revision => revision + 1)), [documentService]);

    useEffect(() => {
        let live = true;
        void isStarterTitlePageAvailable().then(result => {
            if (live) {
                setAvailable(result);
            }
        });
        return () => {
            live = false;
        };
    }, []);

    const offered = useMemo(() => {
        if (!available || !documentService || !context) {
            return false;
        }
        try {
            const blueprints = context.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
            return hasNoInterfaceYet(documentService.getDocument(), blueprints);
        } catch {
            return false;
        }
    }, [available, blueprintRevision, context, documentRevision, documentService]);

    const add = useCallback(async () => {
        if (!context || adding.current) {
            return null;
        }
        adding.current = true;
        const ui = context.services.get<UIService>(Services.UI);
        try {
            const result = await addStarterTitlePage(context);
            if (result.ok) {
                ui.showNotification(translate("uiEditor.templateStore.applied", { name: result.surface.name }), "info");
                return result.surface;
            }
            if (result.frozen) {
                return null;
            }
            if (result.error) {
                console.warn("[starterTitlePage] could not add the title page", result.error);
            }
            ui.showNotification(translate("uiEditor.templateStore.error.apply"), "warning");
            return null;
        } catch (error) {
            console.warn("[starterTitlePage] could not add the title page", error);
            ui.showNotification(translate("uiEditor.templateStore.error.apply"), "warning");
            return null;
        } finally {
            adding.current = false;
        }
    }, [context]);

    return useMemo(() => ({ offered, add }), [offered, add]);
}
