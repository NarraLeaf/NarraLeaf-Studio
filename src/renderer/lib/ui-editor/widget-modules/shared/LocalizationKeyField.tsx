/**
 * Named-localization-key picker for widget inspectors. Wraps the source-text key
 * dropdown (listLocalizationKeyOptions) and appends an in-dropdown "Create new
 * key…" action that opens a two-input dialog (key name + source-language text).
 * Creating writes the key through the workspace LocalizationService and selects
 * it on the element in one step, so authors never leave the inspector.
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { selfReadOnly } from "@/apps/workspace/modules/properties/framework/fields/fieldReadOnlyStrategy";
import type { UIElement } from "@shared/types/ui-editor/document";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { isValidLocalizationKeyName } from "@shared/types/localization";
import { useTranslation } from "@/lib/i18n";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { listLocalizationKeyOptions } from "./localizationKeyOptions";

/** Sentinel option value that opens the create dialog instead of selecting a key. */
const CREATE_KEY_SENTINEL = "\0nl.localization.create-key";

export type LocalizationKeyFieldConfig = {
  /** Current localization key on the element ("" when unset). */
  getKey: (element: UIElement) => string;
  /** Persist the chosen or newly created key onto the element (undefined clears it). */
  setKey: (data: UIInspectorData, value: string | undefined) => void;
};

function resolveService(): LocalizationService | null {
  try {
    return LocalizationService.getInstance();
  } catch {
    return null;
  }
}

export function createLocalizationKeyField(config: LocalizationKeyFieldConfig) {
  /**
   * `selfReadOnly` + `Select readOnly`, rather than the framework's structural clamp.
   *
   * Clamped, this field's only control was a dropdown that could not be OPENED, so a frozen
   * project showed the author the key this element is bound to and no way to see the list it came
   * from - which keys exist is project data, and reading it is what a past version is for. Opened
   * read-only, the list renders with the current key marked, every row is inert, and the
   * "Create new key…" row cannot start the dialog it would otherwise write through.
   */
  const LocalizationKeyField = selfReadOnly(function LocalizationKeyField({
    data,
    disabled,
    readOnly
  }: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    const currentKey = config.getKey(live);

    // Keep the dropdown in sync when the key registry changes elsewhere.
    const [registryTick, setRegistryTick] = useState(0);
    useEffect(() => {
      const service = resolveService();
      if (!service) {
        return;
      }
      return service.onKeysChanged(() => setRegistryTick((tick) => tick + 1));
    }, []);

    const options = useMemo<SelectOption[]>(() => {
      void registryTick;
      return [
        {
          value: CREATE_KEY_SENTINEL,
          label: t("widgets.localization.createKey"),
          icon: <Plus className="h-3.5 w-3.5" />
        },
        ...listLocalizationKeyOptions()
      ];
    }, [t, registryTick]);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [keyName, setKeyName] = useState("");
    const [sourceText, setSourceText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const sourceLocaleLabel = useMemo(() => {
      if (!dialogOpen) {
        return "";
      }
      const service = resolveService();
      if (!service) {
        return "";
      }
      try {
        const cfg = service.getConfiguration();
        const entry = cfg.locales.find((locale) => locale.code === cfg.sourceLocale);
        return entry?.displayName || cfg.sourceLocale || "";
      } catch {
        return "";
      }
    }, [dialogOpen]);

    const openDialog = () => {
      setKeyName("");
      setSourceText("");
      setError(null);
      setDialogOpen(true);
    };

    const closeDialog = () => {
      setDialogOpen(false);
      setError(null);
    };

    const handleSelect = (value: string | number) => {
      if (value === CREATE_KEY_SENTINEL) {
        openDialog();
        return;
      }
      config.setKey(data, String(value).trim() || undefined);
    };

    const handleCreate = async () => {
      const name = keyName.trim();
      if (!isValidLocalizationKeyName(name)) {
        setError(t("widgets.localization.invalidKeyName"));
        return;
      }
      const service = resolveService();
      if (!service) {
        setError(t("widgets.localization.keyServiceUnavailable"));
        return;
      }
      setSubmitting(true);
      try {
        await service.loadKeys();
        if (service.getKeysIfLoaded()?.keys[name]) {
          setError(t("widgets.localization.keyExists", { name }));
          return;
        }
        service.setKey(name, { sourceText });
        config.setKey(data, name);
        closeDialog();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    };

    const sourceTextLabel = sourceLocaleLabel
      ? `${t("widgets.localization.sourceText")}（${sourceLocaleLabel}）`
      : t("widgets.localization.sourceText");

    return (
      <>
        <Select
          fullWidth
          options={options}
          value={currentKey}
          onChange={handleSelect}
          disabled={disabled}
          readOnly={readOnly}
          portalMenu
        />
        <Modal
          isOpen={dialogOpen}
          onClose={closeDialog}
          title={t("widgets.localization.createKeyTitle")}
          size="sm"
          closeOnOverlayClick={!submitting}
          footer={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={dialogFooterButtonClass({ variant: "secondary", disabled: submitting })}
                onClick={closeDialog}
                disabled={submitting}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={dialogFooterButtonClass({
                  variant: "primary",
                  disabled: submitting || !keyName.trim()
                })}
                onClick={handleCreate}
                disabled={submitting || !keyName.trim()}
              >
                {t("common.create")}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {t("widgets.localization.keyName")}
              </label>
              <input
                type="text"
                autoFocus
                value={keyName}
                onChange={(event) => {
                  setKeyName(event.target.value);
                  if (error) {
                    setError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
                placeholder={t("widgets.localization.keyNamePlaceholder")}
                className="w-full rounded-md border border-edge bg-fill-subtle px-2 py-1.5 font-mono text-sm text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {sourceTextLabel}
              </label>
              <textarea
                value={sourceText}
                rows={3}
                onChange={(event) => setSourceText(event.target.value)}
                placeholder={t("widgets.localization.sourceTextPlaceholder")}
                className="min-h-[72px] w-full resize-y rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-sm text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
            </div>
            {error ? (
              <p className="text-xs text-danger">{error}</p>
            ) : (
              <p className="text-xs text-fg-subtle">{t("widgets.localization.keyNameHint")}</p>
            )}
          </div>
        </Modal>
      </>
    );
  });

  return LocalizationKeyField;
}
