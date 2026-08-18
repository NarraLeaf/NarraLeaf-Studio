import { translate } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Services } from "../../services";
import { UIDocumentService } from "../../ui-editor/UIDocumentService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

/** The slice of a UI surface the index needs. */
export interface SearchableSurface {
  id: string;
  name: string;
  /** `appSurface` / `stageSurface`, shown as the context line once localized by the caller. */
  kindLabel?: string;
}

/** UI surface slice: every screen/layer by name, opening its editor tab. */
export function extractSurfaceEntries(surfaces: readonly SearchableSurface[]): SearchIndexEntry[] {
  return surfaces
    .filter((surface) => surface.name)
    .map((surface) => ({
      id: `surface:${surface.id}`,
      group: "uiSurface" as const,
      text: surface.name,
      detail: surface.kindLabel || undefined,
      target: { kind: "uiSurface" as const, surfaceId: surface.id }
    }));
}

/**
 * Every screen and stage layer, in one slice.
 *
 * The empty-document case is swallowed here rather than left to the framework's error isolation: the
 * UI document loads lazily, so "not built yet" is an ordinary startup state and not something to warn
 * about once per project open.
 *
 * No `dedupKey`: each surface opens its own editor tab.
 */
export const surfaceSource: SearchSource = {
  id: "surface",
  groups: ["uiSurface"],
  dependsOn: [Services.UIDocument],
  extract: (ctx) => {
    const uiDocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
    let surfaces;
    try {
      surfaces = uiDocumentService.getDocument().surfaces;
    } catch {
      return [];
    }
    return extractSurfaceEntries(
      surfaces.map((surface) => ({
        id: surface.id,
        name: surface.name,
        kindLabel: translate(
          (surface.kind === "stageSurface"
            ? "uiEditor.surfaceKind.gameUi"
            : "uiEditor.surfaceKind.page") as TranslationKey
        )
      }))
    );
  },
  watch: (ctx, signal) =>
    ctx.services
      .get<UIDocumentService>(Services.UIDocument)
      .onDocumentChanged(() => signal.invalidate())
};
