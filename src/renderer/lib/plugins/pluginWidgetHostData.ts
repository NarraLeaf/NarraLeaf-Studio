import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";

/**
 * The live document service behind a plugin widget's narrowed one, for the host's own fields.
 *
 * The properties panel hands one `data` object to every field of a plugin widget's merged schema, and
 * its document service is the narrowed facade (`guardInspectorDataForPluginWidget`), because the
 * plugin's own fields read the same object. A field the host draws into that schema - the text
 * choice for a prop the widget declares as words - is Studio's code, not the plugin's, and needs what
 * Studio's own fields have: it subscribes to document changes, which the facade refuses.
 *
 * Kept here, apart from the guard, so the host field and the guard can both reach it without either
 * importing the other. Nothing a plugin can import leads here: the map is module-private, and a
 * plugin is only ever handed the facade.
 */
const liveBehindFacade = new WeakMap<object, UIInspectorData["documentService"]>();

/** Recorded by the guard as it builds a facade over a live service. */
export function recordLiveDocumentService(
    facade: UIInspectorData["documentService"],
    live: UIInspectorData["documentService"],
): void {
    liveBehindFacade.set(facade, live);
}

/** `data` with its document service as the panel had it before the guard narrowed it. */
export function withLiveDocumentService(data: UIInspectorData): UIInspectorData {
    const live = liveBehindFacade.get(data.documentService);
    return live ? { ...data, documentService: live } : data;
}
