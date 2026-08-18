import { useEffect, useState } from "react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { StoryScriptExportMode } from "@/lib/story/script/storyScriptTypes";

const MODES: readonly StoryScriptExportMode[] = ["roundtrip", "review"];

/**
 * The one question an export has to ask: is this file coming back?
 *
 * Asked rather than inferred because the two answers produce genuinely different files - one carries
 * the scene's data and imports cleanly, the other is prose a `git diff` can read - and neither is a
 * degraded version of the other. Round-trip leads because "I am taking this away to write on it" is
 * why an author reaches for the export at all.
 */
export function StoryScriptExportModal(props: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onExport: (mode: StoryScriptExportMode) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<StoryScriptExportMode>("roundtrip");

  // Re-armed on every opening rather than remembered: "review" writes a file that cannot come back,
  // and inheriting that answer from some earlier export is not a choice the author made about this
  // one. The modal stays mounted while closed, so without this it would be sticky for the session.
  useEffect(() => {
    if (props.open) {
      setMode("roundtrip");
    }
  }, [props.open]);

  return (
    <Modal
      isOpen={props.open}
      onClose={props.onClose}
      title={t("story.script.exportTitle")}
      helpTopic="storyScript"
      size="sm"
      closeOnOverlayClick={!props.busy}
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={dialogFooterButtonClass({ variant: "secondary", disabled: props.busy })}
            onClick={props.onClose}
            disabled={props.busy}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={dialogFooterButtonClass({ variant: "primary", disabled: props.busy })}
            onClick={() => props.onExport(mode)}
            disabled={props.busy}
          >
            {t("story.script.exportAction")}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        {MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            data-story-script-mode={candidate}
            onClick={() => setMode(candidate)}
            className={[
              "rounded-md border px-3 py-2 text-left transition-colors",
              mode === candidate ? "border-primary/60 bg-primary/15" : "border-edge hover:bg-fill"
            ].join(" ")}
          >
            <div className="text-xs font-medium text-fg">
              {t(`story.script.mode.${candidate}` as TranslationKey)}
            </div>
            <div className="text-2xs text-fg-subtle">
              {t(`story.script.mode.${candidate}Detail` as TranslationKey)}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
