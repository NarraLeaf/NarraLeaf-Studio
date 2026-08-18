import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type {
  StoryScriptDiagnostic,
  StoryScriptImportPlan,
  StoryScriptSceneStats
} from "@/lib/story/script/storyScriptTypes";
import { applicableScenePlans, type StoryScriptUndoState } from "./storyScriptIo";

const ROW =
  "flex items-start gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";
const NOTE = "flex items-start gap-1.5 px-1 text-2xs";

/** The counts, in the order an author reads them: what survived, then what the file changed. */
const STAT_KEYS: readonly (keyof StoryScriptSceneStats)[] = [
  "unchanged",
  "edited",
  "added",
  "removed",
  "cloned",
  "moved"
];

function Note(props: { kind: "warning" | "error"; children: ReactNode }) {
  const Icon = props.kind === "error" ? AlertCircle : AlertTriangle;
  return (
    <div className={[NOTE, props.kind === "error" ? "text-danger" : "text-warning"].join(" ")}>
      <Icon className="mt-px h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1">{props.children}</span>
    </div>
  );
}

function Diagnostic(props: { diagnostic: StoryScriptDiagnostic }) {
  const { t } = useTranslation();
  const { diagnostic } = props;
  return (
    <Note kind={diagnostic.severity === "error" ? "error" : "warning"}>
      <span data-story-script-diag={diagnostic.code}>
        {diagnostic.line !== undefined
          ? `${t("story.script.line", { line: diagnostic.line })} · `
          : ""}
        {t(`story.script.diag.${diagnostic.code}` as TranslationKey)}
      </span>
    </Note>
  );
}

/**
 * What importing this file would do, before it does it.
 *
 * The dialog is not a formality and is never skipped, however clean the plan looks: an import
 * rewrites whole scenes from a file the author edited somewhere Studio could not see, and the two
 * things they cannot recover from - a scene that moved on since the export, and lines the codec had
 * to drop - are invisible in the file itself. Both are stated here, per scene, beside the counts.
 *
 * A plan carrying `error` diagnostics still imports. The codec has already dropped the offending
 * lines and the rest of the scene is sound, so refusing would strand the author with a file they
 * cannot get back in and no way to see what is wrong with it.
 */
export function StoryScriptImportModal(props: {
  plan: StoryScriptImportPlan | null;
  busy: boolean;
  /** Undo is per open scene editor, so a multi-scene import can be undoable in part. */
  undo: StoryScriptUndoState;
  onClose: () => void;
  onImport: () => void;
}) {
  const { t, tn } = useTranslation();
  const plan = props.plan;
  const applicable = plan ? applicableScenePlans(plan) : [];

  return (
    <Modal
      isOpen={plan !== null}
      onClose={props.onClose}
      title={t("story.script.importTitle")}
      helpTopic="storyScript"
      size="lg"
      closeOnOverlayClick={!props.busy}
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-2xs text-warning">
            {applicable.length === 0 || props.undo.coverage === "all"
              ? ""
              : props.undo.coverage === "none"
                ? t("story.script.noUndo")
                : tn("story.script.noUndoSome", props.undo.unundoable)}
          </span>
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
            className={dialogFooterButtonClass({
              variant: "primary",
              disabled: props.busy || applicable.length === 0
            })}
            onClick={props.onImport}
            disabled={props.busy || applicable.length === 0}
          >
            {t("story.script.importAction")}
          </button>
        </div>
      }
    >
      {plan && (
        <div className="flex flex-col gap-3">
          {!plan.storyMatches && <Note kind="warning">{t("story.script.storyMismatch")}</Note>}
          {plan.diagnostics.map((diagnostic, index) => (
            <Diagnostic key={`file-${index}`} diagnostic={diagnostic} />
          ))}
          {plan.scenes.length === 0 && (
            <p className="px-1 text-xs text-fg-subtle">{t("story.script.nothingToImport")}</p>
          )}
          {plan.scenes.map((scene) => (
            <div
              key={scene.sceneId}
              className="flex flex-col gap-1"
              data-story-script-scene={scene.sceneId}
            >
              <div className={ROW}>
                <span className="min-w-0 flex-1 truncate font-medium">{scene.sceneName}</span>
                <span className="shrink-0 text-2xs text-fg-subtle">
                  {STAT_KEYS.filter((key) => scene.stats[key] > 0)
                    .map((key) =>
                      t(`story.script.stat.${key}` as TranslationKey, { count: scene.stats[key] })
                    )
                    .join(" · ")}
                </span>
              </div>
              {scene.missing && <Note kind="warning">{t("story.script.sceneMissing")}</Note>}
              {scene.stale && !scene.missing && (
                <Note kind="warning">{t("story.script.stale")}</Note>
              )}
              {scene.diagnostics.map((diagnostic, index) => (
                <Diagnostic key={`${scene.sceneId}-${index}`} diagnostic={diagnostic} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
