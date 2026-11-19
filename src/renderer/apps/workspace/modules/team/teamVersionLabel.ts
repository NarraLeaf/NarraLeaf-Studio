import { elideGeneratedIdentifiers } from "@/lib/vcs/identifierDisplay";
import type { Translator } from "@shared/i18n";

/** The machine-written trailer every Team snapshot carries. */
const SNAPSHOT_TRAILER = /(?:^|\n\n)Team snapshot at seq \d+\s*$/;

/** Name a saved version without exposing its generated identity. */
export function teamVersionLabel(message: string | undefined, index: number, t: Translator["t"]): string {
    const name = (message ?? "").replace(SNAPSHOT_TRAILER, "").trim().split("\n")[0];
    return name
        ? elideGeneratedIdentifiers(name)
        : t("documentDiff.name.numbered", { name: t("workspace.shell.team.docs.automatic"), index: String(index + 1) });
}
