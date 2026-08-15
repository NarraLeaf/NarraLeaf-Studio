import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, Input, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { DOWNLOAD_REWRITES_KEY, type DownloadRewriteRule } from "@shared/types/downloadSource";
import { normalizeRewriteRules } from "@shared/utils/downloadSource";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";

/** What a Test button last found out about one row. */
type ProbeState =
    | { phase: "idle" }
    | { phase: "running" }
    | { phase: "done"; reachable: boolean; status?: number; error?: string };

/**
 * The address-rewrite half of the Network settings: an ordered list of prefix substitutions
 * applied to downloads Studio did not choose the address of.
 *
 * A panel rather than a settings row because a list is not a value the generic control layer can
 * edit, and it owns its own storage exactly as the keybindings panel does.
 *
 * No preset mirrors are shipped. A third-party proxy Studio blessed would eventually stop
 * answering, and a dead entry that came with the product reads as the product being broken - so
 * the author supplies the address and the Test button is what tells them it works.
 */
export function DownloadSourcesPanel() {
    const { t } = useTranslation();
    const [rules, setRules] = useState<DownloadRewriteRule[]>([]);
    const [probes, setProbes] = useState<Record<number, ProbeState>>({});
    // What this panel last handed the store, normalized. A write is broadcast back to the window
    // that made it, so without this the echo of our own write is indistinguishable from another
    // window's - and adopting it would wipe the half-typed row the author is standing in.
    const storedSignature = useRef<string>("[]");

    // Seed, then follow cross-window writes: a second Settings window may be open, and an import
    // (Data settings) writes this key from elsewhere.
    useEffect(() => {
        let mounted = true;
        void getInterface()
            .app.state.getGlobalState(DOWNLOAD_REWRITES_KEY)
            .then(result => {
                if (mounted && result.success) {
                    const seeded = normalizeRewriteRules(result.data.value);
                    storedSignature.current = JSON.stringify(seeded);
                    setRules(seeded);
                }
            })
            .catch(() => undefined);
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key !== DOWNLOAD_REWRITES_KEY) {
                return;
            }
            const incoming = normalizeRewriteRules(change.value);
            const signature = JSON.stringify(incoming);
            if (signature === storedSignature.current) {
                return;
            }
            storedSignature.current = signature;
            setRules(incoming);
        });
        return () => {
            mounted = false;
            token?.cancel();
        };
    }, []);

    const persist = useCallback(async (next: DownloadRewriteRule[]) => {
        // The list on screen and the list in the store are deliberately not the same list. A rule
        // being written needs a row before it has an address to write, but a rule with a blank half
        // is not a rule - `normalizeRewriteRules` drops it on read, so storing it verbatim would
        // make the new row vanish the moment the broadcast came back. Rows live here; only finished
        // rules go to the store.
        setRules(next);

        const storable = normalizeRewriteRules(next);
        const signature = JSON.stringify(storable);
        if (signature === storedSignature.current) {
            // Typing inside a draft row changes nothing the store can hold. Skipping the write also
            // spares every reader of this key a side effect per keystroke.
            return;
        }
        storedSignature.current = signature;
        await getInterface().app.state.setGlobalState(
            DOWNLOAD_REWRITES_KEY as GlobalStateKeys,
            storable as unknown as GlobalStateValue<GlobalStateKeys>,
        );
    }, []);

    const updateRule = useCallback(
        (index: number, patch: Partial<DownloadRewriteRule>) => {
            void persist(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
        },
        [persist, rules],
    );

    const removeRule = useCallback(
        (index: number) => {
            setProbes({});
            void persist(rules.filter((_, position) => position !== index));
        },
        [persist, rules],
    );

    const addRule = useCallback(() => {
        void persist([...rules, { from: "", to: "", enabled: true }]);
    }, [persist, rules]);

    const probe = useCallback(async (index: number, url: string) => {
        setProbes(prev => ({ ...prev, [index]: { phase: "running" } }));
        const result = await getInterface().app.probeDownloadSource(url).catch(() => null);
        setProbes(prev => ({
            ...prev,
            [index]: result?.success
                ? { phase: "done", ...result.data }
                : { phase: "done", reachable: false, error: result?.error ?? t("settings.network.probeFailed") },
        }));
    }, [t]);

    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs text-fg-muted">{t("settings.network.rewrites.hint")}</p>

            {rules.length === 0 ? (
                <p className="py-2 text-xs text-fg-subtle">{t("settings.network.rewrites.empty")}</p>
            ) : (
                <div className="flex flex-col gap-1">
                    {rules.map((rule, index) => {
                        const probeState = probes[index] ?? { phase: "idle" };
                        return (
                            <div key={index} className="flex items-center gap-2">
                                <Switch
                                    size="sm"
                                    checked={rule.enabled}
                                    onCheckedChange={enabled => updateRule(index, { enabled })}
                                    aria-label={t("settings.network.rewrites.enabled")}
                                />
                                <Input
                                    size="sm"
                                    className="h-7 min-w-0 flex-1"
                                    value={rule.from}
                                    placeholder={t("settings.network.rewrites.fromPlaceholder")}
                                    onChange={event => updateRule(index, { from: event.target.value })}
                                />
                                <span className="shrink-0 text-xs text-fg-subtle">{"→"}</span>
                                <Input
                                    size="sm"
                                    className="h-7 min-w-0 flex-1"
                                    value={rule.to}
                                    placeholder={t("settings.network.rewrites.toPlaceholder")}
                                    onChange={event => updateRule(index, { to: event.target.value })}
                                />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 shrink-0"
                                    disabled={!rule.to.trim() || probeState.phase === "running"}
                                    onClick={() => void probe(index, rule.to.trim())}
                                >
                                    {t("settings.network.test")}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 shrink-0 px-0"
                                    aria-label={t("settings.network.rewrites.remove")}
                                    onClick={() => removeRule(index)}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" className="h-7" onClick={addRule}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("settings.network.rewrites.add")}
                </Button>
                <ProbeSummary probes={probes} />
            </div>
        </div>
    );
}

/**
 * The last probe result, as one line under the list rather than a badge per row.
 *
 * One line because a result is transient - it answers a question the author asked a second ago,
 * and a row of permanent status chips would imply Studio is monitoring the mirrors, which it is
 * not.
 */
function ProbeSummary({ probes }: { probes: Record<number, ProbeState> }) {
    const { t } = useTranslation();
    const entries = Object.entries(probes);
    const latest = entries.length > 0 ? entries[entries.length - 1]?.[1] : undefined;
    if (!latest || latest.phase === "idle") {
        return null;
    }
    if (latest.phase === "running") {
        return <span className="text-xs text-fg-subtle">{t("settings.network.probing")}</span>;
    }
    return (
        <span className={cn("min-w-0 truncate text-xs", latest.reachable ? "text-success" : "text-danger")}>
            {latest.reachable
                ? t("settings.network.probeAnswered", { status: String(latest.status ?? "") })
                : t("settings.network.probeNoAnswer", { error: latest.error ?? "" })}
        </span>
    );
}
