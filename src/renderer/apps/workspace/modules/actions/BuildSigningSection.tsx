import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, IconButton, Input, Select } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import {
  useFreezeGuard,
  type FrozenControlProps
} from "@/apps/workspace/components/ui/freezeGuard";
import { getInterface } from "@/lib/app/bridge";
import { basename } from "@shared/utils/path";
import {
  SIGNING_CREDENTIAL_PLATFORM,
  SIGNING_EXPIRY_WARNING_DAYS,
  signingKindsForPlatform,
  signingNotarizes,
  type MacSigningIdentity,
  type SigningCredential,
  type SigningCredentialKind,
  type SigningInspectResult,
  type SigningPlatform
} from "@shared/types/signing";
import type { SigningConfiguration } from "@/lib/workspace/project/configuration";
import {
  buildSigningImport,
  importFieldsFor,
  isImportComplete,
  type SigningImportDraft,
  type SigningImportField
} from "./buildSigningImport";

/**
 * The signing credential UI, in the two shapes its two hosts need.
 *
 * {@link SigningSection} is the editable one - a row per signable platform, each
 * pointing that platform at a credential from the machine's vault (or at
 * nothing, which builds it unsigned), plus the form that puts a credential on
 * this machine. It is hosted by Project ▸ Settings, because obtaining a
 * certificate is preparation: it happens days before the build that uses it, and
 * a wizard nobody can reach without opening the build dialog is a wizard nobody
 * runs early.
 *
 * {@link SigningSummary} is the read-only one, hosted by the build dialog as the
 * last look before building. It is a second *view*, not a second implementation:
 * both read the vault through {@link useSigningVault} and describe a credential
 * through {@link CredentialSummary}, so the two cannot come to disagree about
 * what a certificate says.
 *
 * The project stores only the credential id. Everything shown here - subject,
 * expiry, key id - is read back through `signing.inspect`, which is the only
 * thing that can open the material; no key and no password ever reaches this
 * process.
 */

/**
 * What a row is called.
 *
 * The GPG slot is stored under "linux" but is not about Linux: its detached
 * signatures cover every artifact the build writes. Labelling it "Linux" would
 * be a lie on a Windows host, where it is the only signature offered for the
 * whole build.
 */
function signingRowLabel(
  platform: SigningPlatform,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return platform === "linux" ? t("build.signing.detached") : t(`build.platform.${platform}`);
}

export function SigningSection({
  platforms,
  signing,
  busy = false,
  onChange,
  onRemove,
  children
}: {
  /** Signable platforms to offer a row for, in display order. */
  platforms: SigningPlatform[];
  signing: SigningConfiguration;
  /** A write of the host's is in flight; the controls wait rather than queue a second one. */
  busy?: boolean;
  onChange: (platform: SigningPlatform, credentialId: string | undefined) => void;
  /** Asks the author first, then deletes from the vault. True when it went through. */
  onRemove: (credential: SigningCredential) => Promise<boolean>;
  /** The section's preflight findings, rendered under the rows. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Every control here ends in a write of `project.json` - the Import button included, because the
  // form finishes by pointing the project at what it imported. A frozen workspace refuses that at
  // the boundary, so the whole set greys out rather than offering a choice that cannot land.
  const freeze = useFreezeGuard();
  const frozen = freeze.writes(busy);
  const selectedIds = useMemo(
    () => platforms.map((platform) => signing[platform]).filter((id): id is string => Boolean(id)),
    [platforms, signing]
  );
  const { credentials, certificates, loaded, reload } = useSigningVault(selectedIds);
  const [importing, setImporting] = useState<SigningPlatform | null>(null);

  if (importing) {
    return (
      <SigningImportForm
        platform={importing}
        onCancel={() => setImporting(null)}
        onImported={async (credential) => {
          setImporting(null);
          await reload();
          onChange(importing, credential.id);
        }}
      />
    );
  }

  if (platforms.length === 0) {
    return (
      <div className="grid gap-3">
        <span className="text-2xs text-fg-subtle">{t("build.signing.empty")}</span>
        {children}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {platforms.map((platform) => {
        const selectedId = signing[platform];
        const credential = credentials.find((candidate) => candidate.id === selectedId) ?? null;
        return (
          <SigningRow
            key={platform}
            platform={platform}
            credentials={credentials}
            selectedId={selectedId}
            credential={credential}
            certificate={selectedId ? certificates[selectedId] : undefined}
            loaded={loaded}
            frozen={frozen}
            onSelect={(id) => onChange(platform, id)}
            onImport={() => setImporting(platform)}
            onRemove={async () => {
              if (credential && (await onRemove(credential))) {
                onChange(platform, undefined);
                await reload();
              }
            }}
          />
        );
      })}
      {children}
    </div>
  );
}

/** One platform: what signs it, and what that credential turns out to be. */
function SigningRow({
  platform,
  credentials,
  selectedId,
  credential,
  certificate,
  loaded,
  frozen,
  onSelect,
  onImport,
  onRemove
}: {
  platform: SigningPlatform;
  credentials: SigningCredential[];
  selectedId: string | undefined;
  credential: SigningCredential | null;
  certificate: SigningInspectResult | undefined;
  /** Whether the vault has answered yet; until it has, nothing is missing, it is merely unread. */
  loaded: boolean;
  /** From `FreezeGuard.writes` - the reason goes on the row, because a disabled select has no hover. */
  frozen: FrozenControlProps;
  onSelect: (credentialId: string | undefined) => void;
  onImport: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => {
    const mine = credentials.filter(
      (candidate) => SIGNING_CREDENTIAL_PLATFORM[candidate.kind] === platform
    );
    const list = [
      { value: "", label: t("build.signing.none") },
      ...mine.map((candidate) => ({ value: candidate.id, label: candidate.label }))
    ];
    // A project opened on another machine points at an id that is not here.
    // Without a matching option the picker would silently read as "unsigned"
    // while preflight said otherwise; this keeps the two telling one story.
    //
    // Only once the vault has answered, though. `credentials` starts empty, and this option
    // carries `selectedId` as its value, so it would be the *selected* one - every configured
    // row would open reading "missing on this machine" and then correct itself, which is the
    // one thing about a signing credential an author must be able to believe on sight.
    if (loaded && selectedId && !mine.some((candidate) => candidate.id === selectedId)) {
      list.push({ value: selectedId, label: t("build.signing.missing") });
    }
    return list;
  }, [credentials, loaded, platform, selectedId, t]);

  return (
    // The same frame every project setting row uses (`settingRows.SettingShell`), because this now
    // sits among them in a 318px panel.
    //
    // Stacked rather than label-beside-control: the picker and the Import button together have a
    // min-content floor well above that width, and `min-width: auto` on a grid item refuses to
    // shrink below it - which showed up once as a horizontal scrollbar across the whole section
    // and a preflight message clipped mid-word. On its own line the picker flexes instead.
    <div
      className="group min-w-0 rounded-md border border-edge bg-fill-subtle p-3"
      data-tip={frozen["data-tip"]}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-fg">
          {signingRowLabel(platform, t)}
        </span>
        {credential && (
          <IconButton
            size="sm"
            variant="ghost"
            className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t("build.signing.remove")}
            data-tip={t("build.signing.remove")}
            disabled={frozen.disabled}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <Select
            size="sm"
            fullWidth
            portalMenu
            disabled={frozen.disabled}
            value={selectedId ?? ""}
            ariaLabel={signingRowLabel(platform, t)}
            onChange={(value) => onSelect(String(value) || undefined)}
            options={options}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={frozen.disabled}
          onClick={onImport}
        >
          {t("build.signing.import")}
        </Button>
      </div>
      {credential && <CredentialSummary credential={credential} certificate={certificate} />}
    </div>
  );
}

/**
 * The same selection, reported rather than offered: what signs each target of
 * this build, and whether this machine can honour it.
 *
 * The build dialog's half. The picker and the import form both moved to the
 * project panel - a certificate is prepared before a build, not during one - and
 * what is left here is the last look, plus the one state worth crossing the
 * workspace for: a project that names a credential this machine does not hold.
 */
export function SigningSummary({
  platforms,
  signing,
  children
}: {
  /** Signable platforms the current target selection includes, in display order. */
  platforms: SigningPlatform[];
  signing: SigningConfiguration;
  /** Preflight findings and the jump back to the panel, rendered under the rows. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const selectedIds = useMemo(
    () => platforms.map((platform) => signing[platform]).filter((id): id is string => Boolean(id)),
    [platforms, signing]
  );
  const { credentials, certificates, loaded } = useSigningVault(selectedIds);

  return (
    <div className="grid gap-2">
      {platforms.length === 0 ? (
        <span className="text-2xs text-fg-subtle">{t("build.signing.empty")}</span>
      ) : (
        platforms.map((platform) => {
          const selectedId = signing[platform];
          const credential = credentials.find((candidate) => candidate.id === selectedId) ?? null;
          return (
            <div
              key={platform}
              className="min-w-0 rounded-md border border-edge-subtle px-3 py-2.5"
            >
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="shrink-0 text-fg">{signingRowLabel(platform, t)}</span>
                <SelectedCredential
                  selectedId={selectedId}
                  credential={credential}
                  loaded={loaded}
                />
              </div>
              {credential && (
                <CredentialSummary
                  credential={credential}
                  certificate={selectedId ? certificates[selectedId] : undefined}
                />
              )}
            </div>
          );
        })
      )}
      {children}
    </div>
  );
}

/**
 * What the project points this platform at, in one phrase.
 *
 * The missing case is the reason this section is still in the dialog at all: key
 * material never travels with a project, so an id that resolves to nothing here
 * means the build ships unsigned. It is only claimed once the vault has actually
 * answered - before that every id looks missing, and a warning that appears and
 * then withdraws itself teaches the author to ignore it.
 */
function SelectedCredential({
  selectedId,
  credential,
  loaded
}: {
  selectedId: string | undefined;
  credential: SigningCredential | null;
  loaded: boolean;
}) {
  const { t } = useTranslation();
  if (!selectedId) {
    return (
      <span className="min-w-0 truncate text-2xs text-fg-subtle">{t("build.signing.none")}</span>
    );
  }
  if (credential) {
    return (
      <span className="min-w-0 truncate text-2xs text-fg-muted" data-tip={credential.label}>
        {credential.label}
      </span>
    );
  }
  if (!loaded) {
    return null;
  }
  return (
    <span className="min-w-0 truncate text-2xs text-warning">{t("build.signing.missing")}</span>
  );
}

/**
 * What the chosen credential actually is, in one line. A credential with a
 * certificate is described by that certificate; the others are described by the
 * fact that identifies them, because there is nothing to read.
 */
function CredentialSummary({
  credential,
  certificate
}: {
  credential: SigningCredential;
  certificate: SigningInspectResult | undefined;
}) {
  const { t } = useTranslation();

  if (credential.kind === "linux-gpg") {
    return <SummaryLine text={t("build.signing.keyId", { keyId: credential.keyId })} />;
  }
  if (credential.kind === "windows-azure") {
    return (
      <SummaryLine
        text={t("build.signing.azure", {
          account: credential.codeSigningAccountName,
          profile: credential.certificateProfileName
        })}
      />
    );
  }
  if (credential.kind === "windows-store") {
    return <SummaryLine text={credential.subjectName || credential.sha1 || ""} />;
  }
  if (credential.kind === "macos-keychain") {
    // No file to read, so the identity name is the whole description. The
    // notarization note still applies and is the half an author is most
    // likely to have got wrong.
    return (
      <>
        <SummaryLine text={credential.identity} />
        <NotarizationLine credential={credential} />
      </>
    );
  }
  if (!certificate) {
    // Still being read. An empty line beats a spinner that flashes for the
    // 200ms an already-cached certificate takes.
    return null;
  }
  if (!certificate.available) {
    return certificate.reason === "no-certificate" ? null : (
      <SummaryLine
        tone="warning"
        text={
          certificate.reason === "unsupported-format"
            ? t("build.signing.certUnsupported")
            : t("build.signing.certUnreadable")
        }
      />
    );
  }

  const { subject, notAfter } = certificate.certificate;
  const expiry = expiryOf(notAfter);
  const date = formatDate(notAfter);
  return (
    <>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted" data-tip={subject}>
          {credential.kind === "android-keystore"
            ? `${t("build.signing.alias", { alias: credential.alias })} · ${subject}`
            : subject}
        </span>
        <span
          className={cn(
            "shrink-0 text-2xs",
            expiry === "expired"
              ? "text-danger"
              : expiry === "expiring"
                ? "text-warning"
                : "text-fg-subtle"
          )}
        >
          {expiry === "expired"
            ? t("build.signing.expired", { date })
            : t("build.signing.expires", { date })}
        </span>
      </div>
      <NotarizationLine credential={credential} />
    </>
  );
}

/**
 * Whether a macOS credential notarizes, said plainly on the row.
 *
 * Worth its own line because the two outcomes look identical until a player
 * opens the app: a signed-but-unnotarized build passes every check on the
 * machine that made it and is refused by Gatekeeper on any other. An author who
 * skipped notarization should have decided to, not discovered it later.
 *
 * Renders nothing for the non-macOS kinds, so callers can place it
 * unconditionally.
 */
function NotarizationLine({ credential }: { credential: SigningCredential }) {
  const { t } = useTranslation();
  if (credential.kind !== "macos-keychain" && credential.kind !== "macos-apple") {
    return null;
  }
  return signingNotarizes(credential) ? (
    <SummaryLine text={t("build.signing.notarized")} />
  ) : (
    <SummaryLine tone="warning" text={t("build.signing.notNotarized")} />
  );
}

function SummaryLine({ text, tone }: { text: string; tone?: "warning" }) {
  if (!text) {
    return null;
  }
  return (
    <p
      className={cn(
        "mt-1.5 truncate text-2xs",
        tone === "warning" ? "text-warning" : "text-fg-muted"
      )}
      data-tip={text}
    >
      {text}
    </p>
  );
}

/**
 * Import a credential into the machine's vault. Which fields appear is driven
 * by the credential kind (see `buildSigningImport`), so a new kind cannot ship
 * with a form that quietly omits one of its fields.
 */
function SigningImportForm({
  platform,
  onCancel,
  onImported
}: {
  platform: SigningPlatform;
  onCancel: () => void;
  onImported: (credential: SigningCredential) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const kinds = useMemo(() => signingKindsForPlatform(platform), [platform]);
  const [kind, setKind] = useState<SigningCredentialKind>(kinds[0]);
  const [draft, setDraft] = useState<SigningImportDraft>({ label: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = useMemo(() => importFieldsFor(kind), [kind]);

  const set = (name: string, value: string) =>
    setDraft((current) => ({ ...current, [name]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await getInterface().signing.import(buildSigningImport(kind, draft));
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? null);
      return;
    }
    await onImported(result.data.credential);
  };

  return (
    <div className="grid gap-3">
      <span className="text-xs text-fg">
        {t("build.signing.importTitle", { platform: signingRowLabel(platform, t) })}
      </span>

      {kinds.length > 1 && (
        <ImportRow label={t("build.signing.field.kind")}>
          <Select
            size="sm"
            value={kind}
            onChange={(value) => {
              setKind(value as SigningCredentialKind);
              setDraft((current) => ({ label: current.label }));
            }}
            options={kinds.map((candidate) => ({
              value: candidate,
              label: t(`build.signing.kind.${candidate}`)
            }))}
            fullWidth
          />
        </ImportRow>
      )}

      <ImportRow label={t("build.signing.field.label")}>
        <Input
          size="sm"
          fullWidth
          value={draft.label}
          onChange={(event) => set("label", event.target.value)}
        />
      </ImportRow>

      {fields.map((field) => (
        <ImportRow key={field.name} label={t(field.labelKey)}>
          <ImportField field={field} draft={draft} onChange={set} />
        </ImportRow>
      ))}

      {error && <p className="whitespace-pre-wrap text-2xs leading-relaxed text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !isImportComplete(kind, draft)}
          onClick={() => {
            void submit();
          }}
        >
          {t("build.signing.importAction")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Label above the control, not beside it - the shape `settingRows.SettingStack` uses, and for the
 * same reason: this form is only ever hosted by the project panel, which the author may drag down
 * to 240px. A fixed-width label there left the certificate field about 90px wide, so a chosen file
 * read as "未..." - no overflow, just a filename nobody can check before typing its password.
 */
function ImportRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 [&>*]:min-w-0">
      <span className="text-xs text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function ImportField({
  field,
  draft,
  onChange
}: {
  field: SigningImportField;
  draft: SigningImportDraft;
  onChange: (name: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const value = draft[field.name] ?? "";

  if (field.type === "file") {
    return (
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate rounded-md bg-fill-subtle px-2 py-1 text-2xs text-fg"
          data-tip={value || undefined}
        >
          {value ? basename(value) : t("build.signing.noFile")}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void (async () => {
              // The picker's own "All Files" entry stays available:
              // Android Studio writes PKCS#12 into files named
              // `.jks`, and a keystore is judged by its bytes, not
              // by what it happens to be called.
              const selection = await getInterface().fs.selectFile(field.extensions, false);
              if (selection.success && selection.data.ok && selection.data.data[0]) {
                onChange(field.name, selection.data.data[0]);
              }
            })();
          }}
        >
          {t("build.signing.chooseFile")}
        </Button>
      </div>
    );
  }

  if (field.type === "alias") {
    return <AliasField field={field} draft={draft} onChange={onChange} />;
  }

  if (field.type === "identity") {
    return <MacIdentityField field={field} draft={draft} onChange={onChange} />;
  }

  return (
    <Input
      size="sm"
      fullWidth
      type={field.type === "secret" ? "password" : "text"}
      value={value}
      placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
      onChange={(event) => onChange(field.name, event.target.value)}
    />
  );
}

/**
 * The key to sign with, offered rather than typed. A keystore can hold several,
 * and the only way to know their names is to open it - so this asks the main
 * process once the file and the store password are both there.
 */
function AliasField({
  field,
  draft,
  onChange
}: {
  field: SigningImportField & { type: "alias" };
  draft: SigningImportDraft;
  onChange: (name: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const file = draft[field.fileField] ?? "";
  const password = draft[field.passwordField] ?? "";
  const [aliases, setAliases] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !password) {
      setAliases(null);
      setError(null);
      return;
    }
    let cancelled = false;
    // Debounced: opening a keystore runs the password through PBKDF2, which
    // is deliberately slow - not something to do per keystroke.
    const timer = setTimeout(() => {
      void (async () => {
        const result = await getInterface().signing.keystoreAliases(file, password);
        if (cancelled) {
          return;
        }
        setAliases(result.success ? result.data.aliases : null);
        setError(result.success ? null : (result.error ?? null));
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [file, password]);

  // Choosing for the author when there is only one key: a picker with a single
  // entry is a question with one answer.
  const single = aliases?.length === 1 ? aliases[0] : null;
  const selected = draft[field.name] ?? "";
  useEffect(() => {
    if (single && selected !== single) {
      onChange(field.name, single);
    }
    // `onChange` is a fresh closure each render; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, selected, field.name]);

  return (
    <div className="grid gap-1">
      <Select
        size="sm"
        fullWidth
        disabled={!aliases || aliases.length === 0}
        value={selected}
        placeholder={
          aliases?.length === 0 ? t("build.signing.aliasEmpty") : t("build.signing.aliasLocked")
        }
        onChange={(value) => onChange(field.name, String(value))}
        options={(aliases ?? []).map((alias) => ({ value: alias, label: alias }))}
      />
      {error && <p className="whitespace-pre-wrap text-2xs leading-relaxed text-danger">{error}</p>}
    </div>
  );
}

/**
 * The certificate to sign a Mac build with, offered rather than typed.
 *
 * The name is long, punctuated and case-sensitive
 * (`Developer ID Application: Someone (A1B2C3D4E5)`), and a typo in it does not
 * fail at import - it fails much later, when codesign cannot find a match. So
 * the host is asked what it actually holds and the author picks from that.
 *
 * Identities that are not `Developer ID Application` ones are still listed, and
 * marked: they sign a build that runs locally but that Gatekeeper rejects
 * everywhere else, which is a legitimate thing to want and a terrible thing to
 * choose by accident.
 */
function MacIdentityField({
  field,
  draft,
  onChange
}: {
  field: SigningImportField & { type: "identity" };
  draft: SigningImportDraft;
  onChange: (name: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const [identities, setIdentities] = useState<MacSigningIdentity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getInterface().signing.macIdentities();
      if (!cancelled) {
        setIdentities(result.success ? result.data.identities : []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = draft[field.name] ?? "";
  // Same reasoning as the keystore alias picker: one identity is a question
  // with a single answer, so it answers itself.
  const single = identities?.length === 1 ? identities[0].name : null;
  useEffect(() => {
    if (single && selected !== single) {
      onChange(field.name, single);
    }
    // `onChange` is a fresh closure each render; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, selected, field.name]);

  if (identities !== null && identities.length === 0) {
    return (
      <p className="text-2xs leading-relaxed text-warning">{t("build.signing.macIdentityEmpty")}</p>
    );
  }
  return (
    <Select
      size="sm"
      fullWidth
      disabled={identities === null}
      value={selected}
      placeholder={t("build.signing.macIdentityLoading")}
      onChange={(value) => onChange(field.name, String(value))}
      options={(identities ?? []).map((identity) => ({
        value: identity.name,
        label: identity.developerId
          ? identity.name
          : `${identity.name} · ${t("build.signing.macIdentityNotDeveloperId")}`
      }))}
    />
  );
}

/**
 * The machine's credentials, plus the certificate behind each one the project
 * currently uses. Certificates are fetched one id at a time and cached, because
 * opening a keystore is not cheap and the section re-renders on every keystroke
 * elsewhere in the dialog.
 */
function useSigningVault(selectedIds: string[]) {
  const [credentials, setCredentials] = useState<SigningCredential[]>([]);
  const [certificates, setCertificates] = useState<Record<string, SigningInspectResult>>({});
  // Whether the vault has answered at all. An empty list and a list not yet fetched are the same
  // value and opposite facts: the first means "this id is not here", the second means "ask later".
  const [loaded, setLoaded] = useState(false);
  const inspected = useRef<Record<string, SigningInspectResult>>({});

  const reload = useCallback(async () => {
    // A fresh list invalidates the certificates: an id can be gone, or be
    // back under the same label with entirely different material.
    inspected.current = {};
    setCertificates({});
    const result = await getInterface().signing.list();
    setCredentials(result.success ? result.data.credentials : []);
    // Never goes back to false: a reload replaces a list that was already answered for, and
    // withdrawing the answer mid-flight would flicker every row it had already described.
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Joined rather than passed as an array: the caller derives it per render,
  // so its identity changes even when the ids do not.
  const wanted = selectedIds.join(",");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const id of wanted.split(",").filter(Boolean)) {
        if (cancelled || inspected.current[id]) {
          continue;
        }
        const result = await getInterface().signing.inspect(id);
        if (cancelled) {
          return;
        }
        inspected.current[id] = result.success
          ? result.data
          : { available: false, reason: "unreadable" };
        setCertificates({ ...inspected.current });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, credentials]);

  return { credentials, certificates, loaded, reload };
}

/** Where `notAfter` sits relative to now. Mirrors the main process's own reading. */
function expiryOf(notAfter: string): "valid" | "expiring" | "expired" {
  const at = Date.parse(notAfter);
  if (Number.isNaN(at)) {
    return "expired";
  }
  const remaining = at - Date.now();
  if (remaining <= 0) {
    return "expired";
  }
  return remaining <= SIGNING_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000 ? "expiring" : "valid";
}

function formatDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString();
}
