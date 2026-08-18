import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useWorkspace } from "../../../context";
import {
  PuppetRuntimeInstaller,
  type PuppetRuntimeInstallTarget
} from "@/apps/workspace/modules/characters/editors/components/PuppetRuntimeInstaller";
import {
  listProjectPuppetRuntimes,
  readPuppetRuntimeInstallState,
  type PuppetRuntimeInstallState
} from "@/lib/workspace/services/puppet/projectPuppetRuntimes";
import { removePuppetRuntime } from "@/lib/workspace/services/puppet/installPuppetRuntime";
import {
  knownPuppetRuntimeFor,
  listKnownPuppetRuntimes,
  type KnownPuppetRuntime
} from "@shared/utils/puppetRuntimes";
import type { TranslationKey } from "@shared/i18n";
import type { ProjectSectionProps } from "./types";

/** One row of the table: a runtime Studio knows, a runtime the author wrote, or both at once. */
type RuntimeRow = {
  /** The directory under `runtimes/puppet/`, which is also the backend name a character refers to. */
  backend: string;
  /** Set when this is one of the runtimes Studio can name and guide the author through. */
  known: KnownPuppetRuntime | null;
  state: PuppetRuntimeInstallState;
};

/**
 * Colour for the word, and only for the word. The coloured dot that used to lead every row said the
 * same thing the label beside it says, and a column of green dots reads as a status board rather
 * than a list of runtimes. Same removal as the dependency rows next door.
 */
const STATUS_TEXT_STYLES: Record<PuppetRuntimeInstallState["status"], string> = {
  installed: "text-success",
  incomplete: "text-warning",
  absent: "text-fg-subtle"
};

const STATUS_LABEL_KEYS: Record<PuppetRuntimeInstallState["status"], TranslationKey> = {
  installed: "characters.editor.puppet.runtimeInstalled",
  incomplete: "characters.editor.puppet.runtimeIncomplete",
  absent: "characters.editor.puppet.runtimeMissing"
};

/**
 * The drawing runtimes this project carries.
 *
 * The permanent home for a question that previously had no surface at all: an author who wanted a
 * Live2D character had to know that Studio looks for `runtimes/puppet/<name>/index.js` and build one
 * themselves, because nothing in the application mentioned either the path or the products.
 *
 * Both halves are listed together on purpose. The runtimes Studio can name appear whether or not they
 * are installed — that is how the author discovers Live2D and Spine exist — and anything else found on
 * disk appears beside them, because a runtime is ultimately just a folder the author put there and this
 * table would be lying if it only showed the two it recognises.
 */
export function ProjectRuntimesSection({ uiService }: ProjectSectionProps) {
  const { t } = useTranslation();
  const freeze = useFreezeGuard();
  const { context } = useWorkspace();

  const [installed, setInstalled] = useState<RuntimeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<PuppetRuntimeInstallTarget | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!context) {
      return;
    }
    let active = true;
    setBusy(true);
    void (async () => {
      const onDisk = await listProjectPuppetRuntimes(context.project).catch(() => [] as string[]);
      // Every name to report: the two Studio knows, plus whatever else is in the directory.
      const names = [
        ...new Set([...listKnownPuppetRuntimes().map((runtime) => runtime.backend), ...onDisk])
      ];
      const rows = await Promise.all(
        names.map(async (backend) => ({
          backend,
          known: knownPuppetRuntimeFor(backend),
          state: await readPuppetRuntimeInstallState(context.project, backend).catch(
            (): PuppetRuntimeInstallState => ({ status: "absent" })
          )
        }))
      );
      if (active) {
        // Known runtimes first and in registry order, so the list reads the same as the
        // character-creation menu; anything the author added follows, alphabetically.
        rows.sort((left, right) => {
          if (Boolean(left.known) !== Boolean(right.known)) {
            return left.known ? -1 : 1;
          }
          return left.backend.localeCompare(right.backend);
        });
        setInstalled(rows);
        setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [context, version]);

  const remove = useCallback(
    async (row: RuntimeRow) => {
      if (!context || !uiService) {
        return;
      }
      // Destructive rather than a plain confirm: this deletes a megabyte the author cannot get back
      // without their SDK archive, and every character using it stops drawing until it is reinstalled.
      const confirmed = await uiService.showDestructiveConfirm(
        t("characters.editor.runtime.removeConfirm", { backend: row.backend }),
        t("characters.editor.runtime.removeDetail"),
        t("characters.editor.runtime.remove")
      );
      if (!confirmed) {
        return;
      }
      await removePuppetRuntime(context.project, row.backend).catch(() => undefined);
      refresh();
    },
    [context, refresh, t, uiService]
  );

  const custom: PuppetRuntimeInstallTarget = useMemo(() => ({ kind: "custom" }), []);

  return (
    <div className="grid gap-3">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setInstalling(custom)}
          {...freeze.writes(busy, t("characters.editor.kind.puppet"))}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-2 py-1 text-2xs font-medium text-fg-muted transition hover:bg-fill disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("characters.editor.kind.puppet")}
        </button>
        <button
          type="button"
          onClick={refresh}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-2 py-1 text-2xs font-medium text-fg-muted transition hover:bg-fill disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </button>
      </div>

      <div className="grid gap-2">
        {installed.map((row) => (
          <div
            key={row.backend}
            className="flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              {/* The product's own name when Studio knows it, the folder name otherwise. A
                                trademark is not translated and does not live in the catalogue. */}
              <p className="truncate text-xs text-fg">{row.known?.productName ?? row.backend}</p>
              <p className="truncate text-2xs text-fg-subtle">
                {row.known ? row.backend : t("characters.editor.kind.puppet")}
              </p>
            </div>
            <span className={`shrink-0 text-2xs ${STATUS_TEXT_STYLES[row.state.status]}`}>
              {t(STATUS_LABEL_KEYS[row.state.status])}
            </span>
            <button
              type="button"
              className="rounded-md p-1 text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40"
              onClick={() =>
                setInstalling(
                  row.known
                    ? { kind: "known", id: row.known.id }
                    : { kind: "custom", suggestedName: row.backend }
                )
              }
              {...freeze.writes(
                false,
                row.state.status === "installed"
                  ? t("characters.editor.puppet.reinstall")
                  : t("characters.editor.puppet.install")
              )}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            {row.state.status !== "absent" && (
              <button
                type="button"
                className="rounded-md p-1 text-fg-muted transition-colors hover:bg-fill hover:text-danger disabled:opacity-40"
                onClick={() => void remove(row)}
                {...freeze.writes(false, t("characters.editor.runtime.remove"))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <PuppetRuntimeInstaller
        visible={installing !== null}
        target={installing ?? custom}
        onClose={() => setInstalling(null)}
        onInstalled={refresh}
      />
    </div>
  );
}
