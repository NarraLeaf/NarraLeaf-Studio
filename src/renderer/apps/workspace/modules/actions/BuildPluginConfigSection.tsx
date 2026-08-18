/**
 * Build ▸ Plugins: the values the installed plugins ask the author for before a build can ship.
 *
 * The page exists only where a plugin declares something for the platforms being built, so there is
 * no empty state here - see `visibleBuildDialogPages`.
 *
 * **Inheritance is legible from the field itself**, the way Project ▸ App shows a variant's identity:
 * a key the variant does not state is an empty input with the inherited value as its placeholder, a
 * key it does state holds real text and grows a Restore beside it. Restore is the marker as well as
 * the action, so nothing here carries a badge saying "overridden". A `global`- or `platform`-scoped
 * field has one value for the whole project, so it has nothing to inherit and gets neither.
 *
 * **Edits write through immediately.** `AppTagService` autosaves and its mutations are not on the
 * project's undo stack, so closing this dialog is not a cancel - a value typed here is already in
 * `editor/app-tags.json`. That is deliberate (it matches the panel that owns the same document), and
 * it is the one thing about this page that surprises people.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@/lib/components/elements";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { GameBuildPlatform } from "@shared/types/gameBuild";
import {
  isPlatformScopedBuildConfig,
  isVariantScopedBuildConfig,
  pluginBuildConfigStorageKey,
  type PluginBuildConfigField
} from "@shared/types/plugins";
import { appliesToPlatform } from "@shared/utils/pluginBuildConfig";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";

/** One plugin's fields, in declaration order, under the name the plugin goes by. */
type PluginGroup = {
  pluginId: string;
  pluginName: string;
  fields: PluginBuildConfigField[];
};

export function PluginConfigSection({
  fields,
  platforms,
  appTagId,
  service,
  children
}: {
  /** Already folded for the platforms being built; see `collectPluginBuildConfigFields`. */
  fields: PluginBuildConfigField[];
  /** The platforms being built, in display order. A platform-scoped field takes one value each. */
  platforms: GameBuildPlatform[];
  /** The selected variant, `""` for the release variant. */
  appTagId: string;
  service: AppTagService | null;
  /** The section's findings, rendered underneath by the dialog. */
  children?: React.ReactNode;
}) {
  // Values are read straight off the service on every render, and the service is what changes them,
  // so a write anywhere (this page, the project panel, another window's autosave) has to be what
  // re-renders this one.
  const [, setRevision] = useState(0);
  useEffect(() => service?.onTagsChanged(() => setRevision((revision) => revision + 1)), [service]);

  return (
    <div className="grid gap-4">
      {groupByPlugin(fields).map((group) => (
        <div key={group.pluginId} className="grid gap-2.5">
          <span className="text-xs font-medium text-fg">{group.pluginName}</span>
          {group.fields.map((field) => (
            <FieldRows
              key={field.key}
              field={field}
              platforms={platforms}
              appTagId={appTagId}
              service={service}
            />
          ))}
        </div>
      ))}
      {children}
    </div>
  );
}

/** Fields in plugin order, then declaration order - the order `collectPluginBuildConfigFields` gives. */
function groupByPlugin(fields: PluginBuildConfigField[]): PluginGroup[] {
  const groups: PluginGroup[] = [];
  for (const field of fields) {
    const existing = groups.find((group) => group.pluginId === field.pluginId);
    if (existing) {
      existing.fields.push(field);
      continue;
    }
    groups.push({ pluginId: field.pluginId, pluginName: field.pluginName, fields: [field] });
  }
  return groups;
}

/**
 * One field: its label and description once, then a control per value it asks for.
 *
 * A platform-scoped field asks once per platform being built, so those rows carry the platform's name
 * and every other field's single row carries none - the field's own label is directly above it.
 */
function FieldRows({
  field,
  platforms,
  appTagId,
  service
}: {
  field: PluginBuildConfigField;
  platforms: GameBuildPlatform[];
  appTagId: string;
  service: AppTagService | null;
}) {
  const { t } = useTranslation();
  const perPlatform = isPlatformScopedBuildConfig(field.scope);
  const slots = perPlatform
    ? platforms.filter((platform) => appliesToPlatform(field, platform))
    : [undefined];

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-2xs font-medium text-fg-muted">{field.label}</span>
        {field.description ? (
          <span className="text-2xs leading-relaxed text-fg-subtle">{field.description}</span>
        ) : null}
      </div>
      {slots.map((platform) => (
        <ConfigSlot
          key={platform ?? field.key}
          field={field}
          platform={platform}
          label={platform ? t(`build.platform.${platform}`) : null}
          appTagId={appTagId}
          service={service}
        />
      ))}
    </div>
  );
}

/** One value: what it is set to, where that came from, and the way to change it. */
function ConfigSlot({
  field,
  platform,
  label,
  appTagId,
  service
}: {
  field: PluginBuildConfigField;
  platform: GameBuildPlatform | undefined;
  /** The platform's name for a per-platform value; absent where the field asks for one value. */
  label: string | null;
  appTagId: string;
  service: AppTagService | null;
}) {
  const { t } = useTranslation();
  const freeze = useFreezeGuard();
  const frozen = freeze.writes(!service);

  const resolved = service?.resolvePluginConfigValue(appTagId, field, platform) ?? {
    value: "",
    overridden: false
  };
  /*
   * Whether this control is showing a variant's own value or the project's. A variant can state a
   * value only where the field's scope lets it AND a variant is selected: the release variant
   * stores nothing, and a `global` or `platform` field has one value for the whole project. Where
   * it cannot, there is nothing to inherit and the control is just a value.
   */
  const inheritable = isVariantScopedBuildConfig(field.scope) && Boolean(appTagId);
  // The same resolution, read against the release variant - which stores nothing, so what comes
  // back is the project's own value. Reading it through the one helper rather than reaching into
  // the record keeps this page and the checks answering from the same fold.
  const inherited = inheritable
    ? (service?.resolvePluginConfigValue(null, field, platform).value ?? "")
    : "";
  const stated = inheritable ? (resolved.overridden ? resolved.value : "") : resolved.value;
  const storageKey = pluginBuildConfigStorageKey(field.key, platform);
  const handle = `${field.pluginId}:${storageKey}`;

  const restore =
    inheritable && resolved.overridden
      ? {
          label: t("project.appTags.restore"),
          onClick: () => service?.clearPluginConfigValue(appTagId, field, platform)
        }
      : null;

  return (
    <div className="grid min-w-0 gap-1">
      {(label || restore) && (
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-2xs text-fg-subtle">{label}</span>
          {restore ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={frozen.disabled}
              data-tip={frozen["data-tip"]}
              onClick={restore.onClick}
              className="px-1.5"
              data-build-plugin-restore={handle}
            >
              {restore.label}
            </Button>
          ) : null}
        </div>
      )}
      {field.type === "secret" ? (
        <SecretValue
          field={field}
          platform={platform}
          appTagId={appTagId}
          service={service}
          storedHandle={resolved.value}
          /* A handle the variant merely inherits is the project's secret, so supplying a
                       value for it would rewrite what every other variant reads. Only the record
                       this control is editing may be filled in under the handle it already names. */
          fillsHandle={!inheritable || resolved.overridden}
          disabled={frozen.disabled}
          title={frozen["data-tip"]}
          handle={handle}
        />
      ) : (
        <CommittedInput
          value={stated}
          placeholder={inheritable ? inherited : undefined}
          disabled={frozen.disabled}
          title={frozen["data-tip"]}
          label={label ? `${field.label} - ${label}` : field.label}
          handle={handle}
          onCommit={(next) => service?.setPluginConfigValue(appTagId, field, next, platform)}
        />
      )}
    </div>
  );
}

/**
 * A secret, which is never shown.
 *
 * The project stores a handle; the value behind it is sealed on the machine that entered it. So the
 * three states are the whole reading: nothing set, set and readable here, set on another machine.
 * The last is the ordinary state of a project someone else configured, and the way out of it is to
 * enter the value again - which is what the input under the state line does.
 */
function SecretValue({
  field,
  platform,
  appTagId,
  service,
  storedHandle,
  fillsHandle,
  disabled,
  title,
  handle
}: {
  field: PluginBuildConfigField;
  platform: GameBuildPlatform | undefined;
  appTagId: string;
  service: AppTagService | null;
  /** What the project stores in place of the value; empty when nothing has been entered. */
  storedHandle: string;
  /** Whether a new value fills in `storedHandle` rather than minting one. */
  fillsHandle: boolean;
  disabled: boolean;
  title: string | undefined;
  handle: string;
}) {
  const { t } = useTranslation();
  // `null` until the vault has answered. Claiming "set on another machine" before it does would be
  // a warning that appears on every open and then withdraws itself.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAvailable(null);
    if (!storedHandle) {
      return;
    }
    let active = true;
    void getInterface()
      .pluginBuildSecret.available(storedHandle)
      .then((result) => {
        if (active) {
          setAvailable(result.success ? result.data.available : false);
        }
      });
    return () => {
      active = false;
    };
  }, [storedHandle]);

  const store = useCallback(
    async (value: string) => {
      setFailed(false);
      const result = await getInterface().pluginBuildSecret.set(
        value,
        fillsHandle && storedHandle ? storedHandle : undefined
      );
      if (!result.success) {
        setFailed(true);
        return;
      }
      // The handle is what the project holds. Written through even when it is the one already
      // stored: the value behind it changed, and this is what marks the document dirty.
      service?.setPluginConfigValue(appTagId, field, result.data.handle, platform);
      setAvailable(result.data.available);
    },
    [appTagId, field, fillsHandle, platform, service, storedHandle]
  );

  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-2xs text-fg-muted">{secretState(t, storedHandle, available)}</span>
      <div className="flex min-w-0 items-center gap-2">
        <CommittedInput
          value=""
          type="password"
          placeholder={t("build.pluginConfig.secretEnter")}
          disabled={disabled}
          title={title}
          label={field.label}
          handle={handle}
          onCommit={(next) => {
            void store(next);
          }}
        />
        {storedHandle && fillsHandle ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            data-tip={title}
            className="shrink-0 px-1.5"
            onClick={() => service?.clearPluginConfigValue(appTagId, field, platform)}
            data-build-plugin-clear={handle}
          >
            {t("build.pluginConfig.clear")}
          </Button>
        ) : null}
      </div>
      {failed ? (
        <span className="text-2xs text-danger">{t("build.pluginConfig.secretFailed")}</span>
      ) : null}
    </div>
  );
}

/** Which of the three things is true of a secret right now. */
function secretState(
  t: ReturnType<typeof useTranslation>["t"],
  storedHandle: string,
  available: boolean | null
): string {
  if (!storedHandle) {
    return t("build.pluginConfig.secretUnset");
  }
  if (available === null) {
    return t("build.pluginConfig.secretSet");
  }
  return available ? t("build.pluginConfig.secretHere") : t("build.pluginConfig.secretElsewhere");
}

/**
 * Committed on blur or Enter rather than per keystroke, for the reason the variants panel gives: the
 * service trims what it is handed and reads blank as "clear this value", so a per-keystroke commit
 * would delete the value the moment the author selected the text to retype it.
 *
 * A blank commit is passed on for a text field (that is how an author says "inherit this again") and
 * dropped for a secret, whose control is empty by construction - see {@link SecretValue}.
 */
function CommittedInput({
  value,
  type,
  placeholder,
  disabled,
  title,
  label,
  handle,
  onCommit
}: {
  value: string;
  type?: "password";
  placeholder?: string;
  disabled: boolean;
  title: string | undefined;
  label: string;
  /** `<plugin id>:<storage key>` - what verification finds this field by. */
  handle: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next === value || (type === "password" && !next)) {
      setDraft(value);
      return;
    }
    onCommit(next);
    // A secret's control shows nothing, so it goes back to empty rather than to what was typed.
    setDraft(type === "password" ? "" : next);
  }, [draft, onCommit, type, value]);

  return (
    <Input
      size="sm"
      type={type}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      data-tip={title}
      aria-label={label}
      className="w-full min-w-0"
      data-build-plugin-field={handle}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
