import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, Input, useEscapeToClose } from "@/lib/components/elements";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import type {
  VcsServerAuthority,
  VcsServerDiscovery,
  VcsServerSession,
  VcsSignInProblem
} from "@shared/types/vcs";
import type { TranslationKey } from "@shared/i18n";

/**
 * The sentence for each way a token can be refused.
 *
 * The backend reports four unrelated transport failures with one string, so the reason
 * arrives as a code and becomes a sentence here. Two of the codes name an address the
 * sign-in was missing; neither can be answered on this path, because both addresses come
 * from the discovery document rather than from anybody's memory.
 */
const PROBLEM_KEYS: Record<VcsSignInProblem["kind"], TranslationKey> = {
  scheme: "settings.servers.problems.scheme",
  token: "settings.servers.problems.token",
  address: "settings.servers.problems.address",
  server: "settings.servers.problems.server",
  certificate: "settings.servers.problems.certificate",
  unreachable: "settings.servers.problems.unreachable",
  refused: "settings.servers.problems.refused",
  unknown: "settings.servers.problems.unknown"
};

/**
 * Whether to trust the authority a machine presented, answered somewhere else.
 *
 * Trusting one changes what this installation believes about every connection it makes
 * afterwards, so it is decided in front of the certificate rather than beside an address
 * field. This reads `getInterface().app.promptServerTrust` once the window that asks it
 * is on the interface; the lookup stays a lookup so that an address whose authority is
 * unknown is refused, rather than quietly accepted, wherever that window is absent.
 */
async function askToTrust(address: string, authority: VcsServerAuthority): Promise<boolean> {
  const answer = await getInterface()
    .app.promptServerTrust({ address, authority })
    .catch(() => null);
  // Anything other than a window that came back saying yes is a no. A call that failed,
  // a window that was closed, a refusal: none of them is permission, and the difference
  // between them is not something the author is waiting to be told.
  return answer?.success === true && answer.data.trusted;
}

/**
 * How far adding a server has got.
 *
 * The address is held outside this, because a failed probe leaves the field holding what
 * was typed: an address that did not answer is usually one character away from one that
 * does.
 */
type WizardStage =
  /** Nothing has been reached yet. */
  | { kind: "address" }
  /** Reached, and it wants to know who this is. */
  | { kind: "token"; address: string; discovery: VcsServerDiscovery }
  /** Reached, and it does not. There is no account to store, so this is the end. */
  | { kind: "no-account"; discovery: VcsServerDiscovery };

export interface ServerWizardProps {
  /** The list as it stands once a server was added, so nothing has to be read again. */
  onAdded: (servers: VcsServerSession[]) => void;
  onLeave: () => void;
}

/**
 * Adding a server, as a sequence rather than a form.
 *
 * An author is handed one address and nothing else. Everything a sign-in needs - where a
 * token is presented, which remote the repositories live on, whether a token is wanted at
 * all - is behind that address, so the address is asked first and answers the rest. The
 * `lore://` remote among those answers is stored and never shown: it is a fact about the
 * storage that deployment happens to run, and nobody chose it.
 *
 * Nothing is written until the last step succeeds. The probe only reads, and `addServer`
 * is the one call that stores, so leaving at any point leaves this installation as it was.
 */
export function ServerWizard({ onAdded, onLeave }: ServerWizardProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<WizardStage>({ kind: "address" });
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  useEscapeToClose(true, onLeave);

  const reachAddress = useCallback(async () => {
    const target = address.trim();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    // Two passes at most, and the second only after the authority was accepted:
    // trusting it changes what this machine believes, and the probe is what reads
    // that belief. A second `untrusted` is an answer rather than a reason to ask again.
    for (let pass = 0; pass < 2; pass += 1) {
      const result = await getInterface()
        .vcs.probeServer(target)
        .catch(() => null);
      if (!result?.success) {
        setError("settings.servers.probe.failed");
        break;
      }
      const probe = result.data;
      if (probe.kind === "unreachable") {
        setError("settings.servers.probe.unreachable");
        break;
      }
      if (probe.kind === "not-a-server") {
        setError("settings.servers.probe.notAServer");
        break;
      }
      if (probe.kind === "untrusted") {
        // Asked once. A second refusal on the same address is an answer, not a
        // question to put again.
        const trusted = pass === 0 && (await askToTrust(probe.address, probe.authority));
        if (!trusted) {
          setError("settings.servers.probe.untrusted");
          break;
        }
        continue;
      }
      setStage(
        probe.discovery.auth.required
          ? { kind: "token", address: probe.address, discovery: probe.discovery }
          : { kind: "no-account", discovery: probe.discovery }
      );
      break;
    }
    setBusy(false);
  }, [address, busy]);

  const addServer = useCallback(async () => {
    if (stage.kind !== "token" || !token.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await getInterface()
      .vcs.addServer(stage.discovery.auth.url, stage.discovery.data.url, token.trim())
      .catch(() => null);
    setBusy(false);
    if (!result?.success) {
      setError("settings.servers.problems.unknown");
      return;
    }
    if (!result.data.ok) {
      setError(PROBLEM_KEYS[result.data.problem.kind]);
      return;
    }
    // The token is not kept for a moment longer than the call that used it. A box still
    // holding a credential is one a screenshot or the next person at this desk can read.
    setToken("");
    onAdded(result.data.servers);
  }, [busy, onAdded, stage, token]);

  const sentence = error && (
    <p data-servers-seam="problem" className="break-words text-xs text-danger">
      {t(error)}
    </p>
  );

  if (stage.kind === "no-account") {
    return (
      <div data-servers-seam="wizard-done" className="flex flex-col gap-2">
        <SectionCard>
          <p className="text-xs text-fg-muted">
            {t("settings.servers.noAccount", { name: stage.discovery.name })}
          </p>
        </SectionCard>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={onLeave}>
            {t("settings.servers.done")}
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "token") {
    return (
      <div data-servers-seam="wizard-step-2" className="flex flex-col gap-2">
        <SectionCard title={t("settings.servers.tokenLabel")}>
          <p className="mb-2 text-xs text-fg-muted">
            {t("settings.servers.reached", {
              name: stage.discovery.name,
              address: stage.address
            })}
          </p>
          <Input
            size="sm"
            autoFocus
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addServer();
              }
            }}
            disabled={busy}
            placeholder={t("settings.servers.tokenPlaceholder")}
          />
          <p className="mt-2 text-xs text-fg-subtle">{t("settings.servers.hint")}</p>
        </SectionCard>
        {sentence}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !token.trim()}
            onClick={() => void addServer()}
          >
            {t(busy ? "settings.servers.adding" : "settings.servers.add")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onLeave}>
            {t("settings.servers.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-servers-seam="wizard-step-1" className="flex flex-col gap-2">
      <SectionCard title={t("settings.servers.addressLabel")}>
        <Input
          size="sm"
          autoFocus
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void reachAddress();
            }
          }}
          disabled={busy}
          placeholder={t("settings.servers.addressPlaceholder")}
        />
      </SectionCard>
      {sentence}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !address.trim()}
          onClick={() => void reachAddress()}
        >
          {t(busy ? "settings.servers.checking" : "settings.servers.continue")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onLeave}>
          {t("settings.servers.cancel")}
        </Button>
      </div>
    </div>
  );
}
