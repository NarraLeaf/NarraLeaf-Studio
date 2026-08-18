import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { Button, CONTROL_HEIGHT_CLASS } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ServerTrustPromptProps } from "@shared/types/serverTrust";
import {
  WindowAppType,
  WindowControlPolicy,
  type WindowControlAbility
} from "@shared/types/window";

const SERVER_TRUST_WINDOW_CONTROL_ABILITY: WindowControlAbility = {
  minimizable: false,
  maximizable: false,
  closable: true,
  resizable: false,
  movable: true,
  fullscreenable: false
};

/**
 * One question, in a window of its own: is this server trusted?
 *
 * The window holds the address the answer is about, who the certificate was issued by,
 * the fingerprint behind a disclosure for anyone comparing it against what they were
 * told, and the cost of agreeing. Nothing else, deliberately: an author reading this is
 * deciding, not learning how certificates work.
 *
 * Cancel takes the focus. The reachable mistake here is agreeing without meaning to, so
 * the key that is already down when the window appears must not be the one that agrees.
 */
export function ServerTrustApp() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<ServerTrustPromptProps | null>(null);
  const [fingerprintOpen, setFingerprintOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getInterface()
      .getWindowProps<WindowAppType.ServerTrustPrompt>()
      .then((result) => {
        if (!mounted) {
          return;
        }
        if (!result.success) {
          setError(result.error ?? t("serverTrust.error.load"));
          return;
        }
        setPrompt(result.data);
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        // Announced either way: the host holds the window hidden until this
        // arrives, and one that never appears because it could not read its own
        // props leaves the caller waiting on an answer nobody can give.
        if (mounted) {
          getInterface().window.ready();
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const answer = useCallback((trusted: boolean) => {
    getInterface().window.closeWith<WindowAppType.ServerTrustPrompt>({ trusted });
  }, []);

  useEffect(() => {
    // Escape is a refusal, and only while there is nothing running: an answer sent
    // while the install is still going would say something this machine has not
    // decided yet.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        answer(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, busy]);

  const handleTrust = async () => {
    if (!prompt || busy) {
      return;
    }
    setBusy(true);
    setError(null);

    // The install runs in the host, which checks the certificate against Studio's own
    // directory before running anything - a renderer names a file here, and a renderer
    // is where untrusted content ends up. The project path is empty because this
    // question has no project: an authority is trusted for the account, and the host
    // reads only the certificate.
    const result = await getInterface().vcs.trustAuthority("", prompt.authority.path);
    setBusy(false);

    if (!result.success || !result.data.installed) {
      // What the command printed, where it printed anything: the interesting
      // refusals name a policy or a keychain, and the sentence alone would leave
      // the author with "it did not work".
      const detail = (result.success ? result.data.output : (result.error ?? "")).trim();
      setError(
        detail ? `${t("serverTrust.error.trust")}\n${detail}` : t("serverTrust.error.trust")
      );
      return;
    }

    answer(true);
  };

  return (
    <AppLayout
      title={t("serverTrust.window")}
      iconSrc="/favicon.ico"
      initialControlAbility={SERVER_TRUST_WINDOW_CONTROL_ABILITY}
      windowControlPolicy={WindowControlPolicy.None}
    >
      <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
        {!prompt && !error ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin text-fg-subtle"
              aria-label={t("common.loading")}
            />
          </div>
        ) : null}

        {prompt ? (
          <>
            <div className="border-b border-edge bg-surface-sunken px-4 py-2">
              <div className="text-sm font-medium text-fg">{t("serverTrust.title")}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <div className="break-all text-base font-medium text-fg">{prompt.address}</div>
              <div className="mt-1 truncate text-xs text-fg-muted">
                {t("serverTrust.issuedBy", { subject: prompt.authority.subject })}
              </div>

              <button
                type="button"
                onClick={() => setFingerprintOpen((open) => !open)}
                aria-expanded={fingerprintOpen}
                className={cn(
                  "mt-3 flex w-full items-center gap-1 rounded-md px-2 text-xs text-fg-muted",
                  "hover:bg-edge-subtle hover:text-fg",
                  CONTROL_HEIGHT_CLASS.sm
                )}
              >
                <ChevronRight
                  size={14}
                  className={cn(
                    "shrink-0 transition-transform duration-150",
                    fingerprintOpen && "rotate-90"
                  )}
                />
                <span>{t("serverTrust.fingerprint")}</span>
              </button>

              {fingerprintOpen ? (
                <div className="mt-1 break-all rounded-md border border-edge bg-fill-subtle px-3 py-2 font-mono text-2xs text-fg">
                  {prompt.authority.fingerprint}
                </div>
              ) : null}

              <p className="mt-3 text-xs leading-5 text-fg-muted">{t("serverTrust.meaning")}</p>

              {error ? (
                <div className="mt-3 whitespace-pre-wrap break-words rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </div>
              ) : null}
            </div>
          </>
        ) : error ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          </div>
        ) : null}

        {/*
         * Both answers stay reachable even where the props could not be read: this
         * window carries no title-bar controls, so a state without these buttons is
         * a window that cannot be dismissed.
         */}
        {prompt || error ? (
          <div className="grid grid-cols-2 gap-2 border-t border-edge bg-surface-sunken p-3">
            <Button
              variant="secondary"
              size="md"
              autoFocus
              disabled={busy}
              onClick={() => answer(false)}
            >
              {t("serverTrust.cancel")}
            </Button>
            <Button variant="primary" size="md" disabled={busy || !prompt} onClick={handleTrust}>
              {busy ? t("serverTrust.working") : t("serverTrust.confirm")}
            </Button>
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}

export default ServerTrustApp;
