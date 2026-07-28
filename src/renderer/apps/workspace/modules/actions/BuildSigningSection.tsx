import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, IconButton, Input, Select } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { basename } from "@shared/utils/path";
import {
    SIGNING_CREDENTIAL_PLATFORM,
    SIGNING_EXPIRY_WARNING_DAYS,
    signingKindsForPlatform,
    type SigningCredential,
    type SigningCredentialKind,
    type SigningInspectResult,
    type SigningPlatform,
} from "@shared/types/signing";
import type { SigningConfiguration } from "@/lib/workspace/project/configuration";
import {
    buildSigningImport,
    importFieldsFor,
    isImportComplete,
    type SigningImportDraft,
    type SigningImportField,
} from "./buildSigningImport";

/**
 * The build dialog's Signing section: one row per signable target the current
 * selection includes, each pointing that platform at a credential from the
 * machine's vault (or at nothing, which builds it unsigned).
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
function signingRowLabel(platform: SigningPlatform, t: ReturnType<typeof useTranslation>["t"]): string {
    return platform === "linux" ? t("build.signing.detached") : t(`build.platform.${platform}`);
}

export function SigningSection({
    platforms,
    signing,
    onChange,
    onRemove,
    children,
}: {
    /** Signable platforms the current target selection includes, in display order. */
    platforms: SigningPlatform[];
    signing: SigningConfiguration;
    onChange: (platform: SigningPlatform, credentialId: string | undefined) => void;
    /** Asks the author first, then deletes from the vault. True when it went through. */
    onRemove: (credential: SigningCredential) => Promise<boolean>;
    /** The section's preflight findings, rendered under the rows. */
    children?: React.ReactNode;
}) {
    const { t } = useTranslation();
    const selectedIds = useMemo(
        () => platforms.map(platform => signing[platform]).filter((id): id is string => Boolean(id)),
        [platforms, signing],
    );
    const { credentials, certificates, reload } = useSigningVault(selectedIds);
    const [importing, setImporting] = useState<SigningPlatform | null>(null);

    if (importing) {
        return (
            <SigningImportForm
                platform={importing}
                onCancel={() => setImporting(null)}
                onImported={async credential => {
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
            {platforms.map(platform => {
                const selectedId = signing[platform];
                const credential = credentials.find(candidate => candidate.id === selectedId) ?? null;
                return (
                    <SigningRow
                        key={platform}
                        platform={platform}
                        credentials={credentials}
                        selectedId={selectedId}
                        credential={credential}
                        certificate={selectedId ? certificates[selectedId] : undefined}
                        onSelect={id => onChange(platform, id)}
                        onImport={() => setImporting(platform)}
                        onRemove={async () => {
                            if (credential && await onRemove(credential)) {
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
    onSelect,
    onImport,
    onRemove,
}: {
    platform: SigningPlatform;
    credentials: SigningCredential[];
    selectedId: string | undefined;
    credential: SigningCredential | null;
    certificate: SigningInspectResult | undefined;
    onSelect: (credentialId: string | undefined) => void;
    onImport: () => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    const options = useMemo(() => {
        const mine = credentials.filter(candidate => SIGNING_CREDENTIAL_PLATFORM[candidate.kind] === platform);
        const list = [
            { value: "", label: t("build.signing.none") },
            ...mine.map(candidate => ({ value: candidate.id, label: candidate.label })),
        ];
        // A project opened on another machine points at an id that is not here.
        // Without a matching option the picker would silently read as "unsigned"
        // while preflight said otherwise; this keeps the two telling one story.
        if (selectedId && !mine.some(candidate => candidate.id === selectedId)) {
            list.push({ value: selectedId, label: t("build.signing.missing") });
        }
        return list;
    }, [credentials, platform, selectedId, t]);

    return (
        // min-w-0: a grid item's default `min-width: auto` refuses to shrink
        // below its content, and the fixed-width picker plus the Import button
        // put that floor above the dialog's width - which showed up as a
        // horizontal scrollbar across the whole section and a preflight message
        // clipped mid-word.
        <div className="group min-w-0 rounded-md border border-edge-subtle px-3 py-2.5">
            <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="text-fg">{signingRowLabel(platform, t)}</span>
                <div className="flex items-center gap-1.5">
                    {/* Fixed width so the rows line up and the menu matches the
                        trigger; a credential name longer than this truncates. */}
                    <div className="w-44">
                        <Select
                            size="sm"
                            fullWidth
                            value={selectedId ?? ""}
                            onChange={value => onSelect(String(value) || undefined)}
                            options={options}
                        />
                    </div>
                    {credential && (
                        <IconButton
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={t("build.signing.remove")}
                            title={t("build.signing.remove")}
                            onClick={onRemove}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                    )}
                    <Button variant="secondary" size="sm" onClick={onImport}>
                        {t("build.signing.import")}
                    </Button>
                </div>
            </div>
            {credential && <CredentialSummary credential={credential} certificate={certificate} />}
        </div>
    );
}

/**
 * What the chosen credential actually is, in one line. A credential with a
 * certificate is described by that certificate; the others are described by the
 * fact that identifies them, because there is nothing to read.
 */
function CredentialSummary({
    credential,
    certificate,
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
                    profile: credential.certificateProfileName,
                })}
            />
        );
    }
    if (credential.kind === "windows-store") {
        return <SummaryLine text={credential.subjectName || credential.sha1 || ""} />;
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
                text={certificate.reason === "unsupported-format"
                    ? t("build.signing.certUnsupported")
                    : t("build.signing.certUnreadable")}
            />
        );
    }

    const { subject, notAfter } = certificate.certificate;
    const expiry = expiryOf(notAfter);
    const date = formatDate(notAfter);
    return (
        <div className="mt-1.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted" title={subject}>
                {credential.kind === "android-keystore"
                    ? `${t("build.signing.alias", { alias: credential.alias })} · ${subject}`
                    : subject}
            </span>
            <span
                className={cn(
                    "shrink-0 text-2xs",
                    expiry === "expired" ? "text-danger" : expiry === "expiring" ? "text-warning" : "text-fg-subtle",
                )}
            >
                {expiry === "expired" ? t("build.signing.expired", { date }) : t("build.signing.expires", { date })}
            </span>
        </div>
    );
}

function SummaryLine({ text, tone }: { text: string; tone?: "warning" }) {
    if (!text) {
        return null;
    }
    return (
        <p className={cn("mt-1.5 truncate text-2xs", tone === "warning" ? "text-warning" : "text-fg-muted")} title={text}>
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
    onImported,
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

    const set = (name: string, value: string) => setDraft(current => ({ ...current, [name]: value }));

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
                        onChange={value => {
                            setKind(value as SigningCredentialKind);
                            setDraft(current => ({ label: current.label }));
                        }}
                        options={kinds.map(candidate => ({
                            value: candidate,
                            label: t(`build.signing.kind.${candidate}`),
                        }))}
                        fullWidth
                    />
                </ImportRow>
            )}

            <ImportRow label={t("build.signing.field.label")}>
                <Input size="sm" fullWidth value={draft.label} onChange={event => set("label", event.target.value)} />
            </ImportRow>

            {fields.map(field => (
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
                    onClick={() => { void submit(); }}
                >
                    {t("build.signing.importAction")}
                </Button>
            </div>
        </div>
    );
}

function ImportRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-fg-muted">{label}</span>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

function ImportField({
    field,
    draft,
    onChange,
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
                    title={value || undefined}
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

    return (
        <Input
            size="sm"
            fullWidth
            type={field.type === "secret" ? "password" : "text"}
            value={value}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            onChange={event => onChange(field.name, event.target.value)}
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
    onChange,
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
                placeholder={aliases?.length === 0 ? t("build.signing.aliasEmpty") : t("build.signing.aliasLocked")}
                onChange={value => onChange(field.name, String(value))}
                options={(aliases ?? []).map(alias => ({ value: alias, label: alias }))}
            />
            {error && <p className="whitespace-pre-wrap text-2xs leading-relaxed text-danger">{error}</p>}
        </div>
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
    const inspected = useRef<Record<string, SigningInspectResult>>({});

    const reload = useCallback(async () => {
        // A fresh list invalidates the certificates: an id can be gone, or be
        // back under the same label with entirely different material.
        inspected.current = {};
        setCertificates({});
        const result = await getInterface().signing.list();
        setCredentials(result.success ? result.data.credentials : []);
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

    return { credentials, certificates, reload };
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
