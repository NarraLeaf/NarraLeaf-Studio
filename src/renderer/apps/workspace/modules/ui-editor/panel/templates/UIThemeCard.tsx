import { ImageOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { UIThemeDescriptor } from "@shared/types/uiTemplateRegistry";
import { resolveLocalizedText } from "@shared/types/localizedText";

type UIThemeCardProps = {
  theme: UIThemeDescriptor;
  /** Data URL of the fetched poster, or null while loading / unavailable. */
  posterUrl: string | null;
  /** Screens actually present in the index for this theme. */
  count: number;
  onOpen: () => void;
};

/**
 * One theme on the store's browse level.
 *
 * The poster is an image rather than a live-rendered document — see
 * {@link UIThemeDescriptor}. The whole card is the control, because a theme has
 * exactly one thing you can do to it: look inside.
 */
export function UIThemeCard({ theme, posterUrl, count, onOpen }: UIThemeCardProps) {
  const { t, tn, locale } = useTranslation();
  // A theme ships its own translations; Studio's catalogs cannot carry text
  // for content published after this build.
  const text = resolveLocalizedText(theme, locale);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-md border border-edge bg-surface-raised text-left transition-colors hover:border-edge-strong"
    >
      <div className="relative aspect-video w-full shrink-0 bg-surface-canvas">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={text.name}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-fg-subtle">
            <ImageOff className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <div className="truncate text-sm font-medium text-fg" data-tip={text.name}>
          {text.name}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
          <span>{tn("uiEditor.templateStore.themeScreens", count)}</span>
          {theme.publisher ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{theme.publisher}</span>
            </>
          ) : null}
        </div>
        {text.description ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-fg-muted">{text.description}</p>
        ) : null}
        <span className="mt-auto pt-3 text-2xs text-primary">
          {t("uiEditor.templateStore.themeOpen")}
        </span>
      </div>
    </button>
  );
}
