/**
 * Dialogue split by who speaks it: one row per speaker, lines and words side by side.
 * Comments in English per project convention.
 */

import { useMemo, useState } from "react";
import type { CastStats, SpeakerStat } from "@/lib/workspace/stats/projectStatsSnapshot";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import { DashboardSection } from "./DashboardPrimitives";

/**
 * How many speakers the section shows before it has to be asked for the rest.
 *
 * The snapshot is already capped, so this is about reading rather than cost: the dashboard is a
 * glance at the project, and a cast of forty would push everything below it off the first screen.
 * The tail is never dropped silently - it stays visible as one summed row.
 */
const PREVIEW_ROWS = 8;

/** The name to print for a speaker. Only a project-authored name comes from the data. */
function speakerLabel(t: Translator["t"], speaker: SpeakerStat): string {
  switch (speaker.kind) {
    case "character":
    case "named":
      return speaker.name ?? "";
    case "unknown":
      return t("story.characterName.unknown");
    case "unassigned":
      return t("story.characterName.unassigned");
  }
}

/**
 * One speaker line. The two figures share fixed columns so they stay in line down the list, and the
 * name takes whatever width is left rather than pushing them around.
 */
function SpeakerRow({
  label,
  lines,
  words,
  muted
}: {
  label: string;
  lines: string;
  words: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={cn("min-w-0 truncate text-xs", muted ? "text-fg-subtle" : "text-fg-muted")}>
        {label}
      </span>
      <span
        className={cn(
          "flex shrink-0 gap-4 text-sm font-medium tabular-nums",
          muted ? "text-fg-subtle" : "text-fg"
        )}
      >
        <span className="w-16 text-right">{lines}</span>
        <span className="w-20 text-right">{words}</span>
      </span>
    </div>
  );
}

export function CastSection({ cast }: { cast: CastStats }) {
  const { t, tn, formatNumber } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const shown = expanded ? cast.speakers.length : Math.min(PREVIEW_ROWS, cast.speakers.length);

  // Whatever is not on screen, as one row: the speakers this list is hiding plus the tail the
  // snapshot itself folded away. Without it the columns would stop adding up to the project total.
  const rest = useMemo(() => {
    const total = {
      speakers: cast.overflow?.speakers ?? 0,
      lines: cast.overflow?.lines ?? 0,
      words: cast.overflow?.words ?? 0
    };
    for (let index = shown; index < cast.speakers.length; index += 1) {
      total.speakers += 1;
      total.lines += cast.speakers[index].lines;
      total.words += cast.speakers[index].words;
    }
    return total.speakers > 0 ? total : null;
  }, [cast, shown]);

  if (cast.speakers.length === 0) {
    return null;
  }

  const canExpand = cast.speakers.length > PREVIEW_ROWS;

  return (
    <DashboardSection
      title={t("dashboard.cast.title")}
      actions={
        canExpand ? (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? t("dashboard.cast.showFewer") : t("dashboard.cast.showAll")}
          </Button>
        ) : undefined
      }
    >
      <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2">
        <div className="flex items-baseline justify-between gap-3 border-b border-edge-subtle pb-1.5 text-2xs text-fg-subtle">
          <span className="min-w-0 truncate">{t("dashboard.cast.speaker")}</span>
          <span className="flex shrink-0 gap-4">
            <span className="w-16 text-right">{t("dashboard.cast.lines")}</span>
            <span className="w-20 text-right">{t("dashboard.cast.words")}</span>
          </span>
        </div>
        <div className="pt-0.5">
          {cast.speakers.slice(0, shown).map((speaker) => (
            <SpeakerRow
              key={speaker.key}
              label={speakerLabel(t, speaker)}
              lines={formatNumber(speaker.lines)}
              words={formatNumber(speaker.words)}
            />
          ))}
          {rest && (
            <SpeakerRow
              muted
              label={tn("dashboard.cast.others", rest.speakers, {
                count: formatNumber(rest.speakers)
              })}
              lines={formatNumber(rest.lines)}
              words={formatNumber(rest.words)}
            />
          )}
        </div>
      </div>
    </DashboardSection>
  );
}
