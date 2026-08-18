import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import {
  formatKeybinding,
  keybindingFromKeyboardEvent,
  sanitizeKeybindingOverrides,
  KEYBINDING_OVERRIDES_SETTINGS_KEY
} from "@/lib/workspace/services/ui/KeybindingService";
import { KEYBINDING_CATALOG } from "@/lib/workspace/services/ui/keybindingCatalog";
import { isMacPlatform } from "@/lib/app/platform";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";

interface BindingRow {
  /** Catalog id — what overrides persist under. */
  id: string;
  name: string;
  category: string;
  defaultKey: string;
  effectiveKey: string;
  overridden: boolean;
}

/** Canonical chord for conflict grouping: lowercased, modifier order ignored. */
function canonicalChord(binding: string): string {
  return binding
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .sort()
    .join("+");
}

/**
 * Keyboard-shortcut settings: the full declarative catalog, grouped by category, with an inline
 * recorder and per-row/global reset.
 *
 * Lives in the Settings window rather than the workspace because nothing here needs a workspace:
 * the catalog is static and overrides are one global-state map (`keybindings.overrides`) that
 * every open workspace already follows through the state broadcast — a rebind recorded here takes
 * effect in them live. The one thing a registry-backed table had that this cannot is *unregistered*
 * live bindings (a plugin's, with no catalog entry); overrides already recorded against ids outside
 * the catalog still list under "Other" so they remain visible and resettable.
 */
export function KeybindingsPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const isMac = isMacPlatform();

  // Seed from global state, then follow cross-window writes — a workspace can reset overrides
  // too, and two Settings windows may be open at once.
  useEffect(() => {
    let mounted = true;
    void getInterface()
      .app.state.getGlobalState(KEYBINDING_OVERRIDES_SETTINGS_KEY)
      .then((result) => {
        if (mounted && result.success) {
          setOverrides(sanitizeKeybindingOverrides(result.data.value));
        }
      })
      .catch(() => undefined);
    const token = getInterface().app.state.onGlobalStateChanged?.((change) => {
      if (change.key === KEYBINDING_OVERRIDES_SETTINGS_KEY) {
        setOverrides(sanitizeKeybindingOverrides(change.value));
      }
    });
    return () => {
      mounted = false;
      token?.cancel();
    };
  }, []);

  const persist = useCallback(async (next: Record<string, string>) => {
    // Optimistic: the broadcast comes back and re-sets the same value, so a failed write is
    // corrected by the next change event rather than leaving the row lying about its chord.
    setOverrides(next);
    await getInterface().app.state.setGlobalState(
      KEYBINDING_OVERRIDES_SETTINGS_KEY as GlobalStateKeys,
      next as unknown as GlobalStateValue<GlobalStateKeys>
    );
  }, []);

  const applyOverride = useCallback(
    (id: string, key: string | null) => {
      const next = { ...overrides };
      if (key && key.trim()) {
        next[id] = key.trim();
      } else {
        delete next[id];
      }
      void persist(next);
    },
    [overrides, persist]
  );

  // While recording, capture at the document level: the chord being recorded must not also *run*
  // (recording a shortcut that this window handles must not trigger it).
  useEffect(() => {
    if (!recordingId) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingId(null);
        return;
      }
      const binding = keybindingFromKeyboardEvent(event, isMac);
      if (!binding) {
        return; // Bare modifier — keep listening.
      }
      applyOverride(recordingId, binding);
      setRecordingId(null);
    };
    const cancel = () => setRecordingId(null);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", cancel);
    };
  }, [recordingId, isMac, applyOverride]);

  const rows = useMemo<BindingRow[]>(() => {
    const result: BindingRow[] = [];
    const catalogIds = new Set<string>();
    for (const entry of KEYBINDING_CATALOG) {
      catalogIds.add(entry.id);
      result.push({
        id: entry.id,
        name: t(entry.labelKey),
        category: t(entry.categoryKey),
        defaultKey: entry.key,
        effectiveKey: overrides[entry.id] ?? entry.key,
        overridden: overrides[entry.id] !== undefined
      });
    }
    // Rebinds recorded against ids the catalog does not know (a plugin's binding, or one
    // retired since). Without this they would be stored, in force, and unreachable.
    const otherLabel = t("workspace.shell.keybindings.categories.other");
    for (const [id, key] of Object.entries(overrides)) {
      if (catalogIds.has(id)) {
        continue;
      }
      result.push({
        id,
        name: id,
        category: otherLabel,
        defaultKey: key,
        effectiveKey: key,
        overridden: true
      });
    }
    return result;
  }, [overrides, t]);

  // Conflicts only matter within a category: the same chord in different editors (undo is
  // mod+z everywhere) is scoped by focus and perfectly fine.
  const conflicts = useMemo(() => {
    const byScopeChord = new Map<string, BindingRow[]>();
    for (const row of rows) {
      const scopeKey = `${row.category}\u0000${canonicalChord(row.effectiveKey)}`;
      const bucket = byScopeChord.get(scopeKey);
      if (bucket) {
        bucket.push(row);
      } else {
        byScopeChord.set(scopeKey, [row]);
      }
    }
    const conflictNames = new Map<string, string[]>();
    for (const bucket of byScopeChord.values()) {
      if (bucket.length < 2) {
        continue;
      }
      for (const row of bucket) {
        conflictNames.set(
          row.id,
          bucket.filter((other) => other.id !== row.id).map((other) => other.name)
        );
      }
    }
    return conflictNames;
  }, [rows]);

  const trimmedQuery = query.trim().toLowerCase();
  const filteredRows = !trimmedQuery
    ? rows
    : rows.filter(
        (row) =>
          row.name.toLowerCase().includes(trimmedQuery) ||
          row.id.toLowerCase().includes(trimmedQuery) ||
          row.effectiveKey.toLowerCase().includes(trimmedQuery) ||
          formatKeybinding(row.effectiveKey, isMac).toLowerCase().includes(trimmedQuery)
      );

  // Preserve catalog declaration order for categories; "Other" trails naturally (appended last).
  const grouped: Array<{ category: string; items: BindingRow[] }> = [];
  for (const row of filteredRows) {
    const group = grouped.find((candidate) => candidate.category === row.category);
    if (group) {
      group.items.push(row);
    } else {
      grouped.push({ category: row.category, items: [row] });
    }
  }

  const hasOverrides = rows.some((row) => row.overridden);

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center gap-3 pb-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={t("workspace.shell.keybindings.searchPlaceholder")}
          className="max-w-72 flex-1"
        />
        <span className="flex-1 truncate text-xs text-fg-subtle">
          {t("workspace.shell.keybindings.hint")}
        </span>
        {hasOverrides && (
          <button
            type="button"
            onClick={() => void persist({})}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
          >
            {t("workspace.shell.keybindings.resetAll")}
          </button>
        )}
      </div>

      <div className="max-h-[28rem] overflow-y-auto pr-1">
        {filteredRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-fg-subtle">
            {t("workspace.shell.keybindings.empty")}
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.category}>
              <div className="px-2 pt-3 pb-1 text-xs font-medium text-fg-muted">
                {group.category}
              </div>
              {group.items.map((row) => {
                const conflictWith = conflicts.get(row.id);
                const recording = recordingId === row.id;
                return (
                  <div
                    key={row.id}
                    className="group flex h-9 items-center gap-3 rounded-md px-2 transition-colors hover:bg-fill-subtle"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-fg-muted"
                      data-tip={row.id}
                    >
                      {row.name}
                    </span>

                    {row.overridden && !recording && (
                      <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-2xs text-primary">
                        {t("workspace.shell.keybindings.customized")}
                      </span>
                    )}

                    {conflictWith && !recording && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-2xs text-warning"
                        data-tip={t("workspace.shell.keybindings.conflict", {
                          name: conflictWith.join("、")
                        })}
                      >
                        <TriangleAlert className="h-3 w-3" />
                      </span>
                    )}

                    {recording ? (
                      <span className="shrink-0 rounded-md border border-primary/60 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {t("workspace.shell.keybindings.recording")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRecordingId(row.id)}
                        data-tip={t("workspace.shell.keybindings.record")}
                        aria-label={t("workspace.shell.keybindings.record")}
                        className="shrink-0 rounded-md border border-edge bg-fill-subtle px-2 py-0.5 text-xs tabular-nums text-fg-muted transition-colors hover:border-edge-strong hover:text-fg"
                      >
                        {formatKeybinding(row.effectiveKey, isMac)}
                      </button>
                    )}

                    <span className="flex w-12 shrink-0 items-center justify-end gap-1">
                      {!recording && (
                        <button
                          type="button"
                          onClick={() => setRecordingId(row.id)}
                          data-tip={t("workspace.shell.keybindings.record")}
                          aria-label={t("workspace.shell.keybindings.record")}
                          className="rounded-md p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover:opacity-100"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      {row.overridden && !recording && (
                        <button
                          type="button"
                          onClick={() => applyOverride(row.id, null)}
                          data-tip={t("workspace.shell.keybindings.reset")}
                          aria-label={t("workspace.shell.keybindings.reset")}
                          className="rounded-md p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover:opacity-100"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
