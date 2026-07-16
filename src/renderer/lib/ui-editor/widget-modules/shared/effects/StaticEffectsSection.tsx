import type { ElementEffectValues, VisualEffectKind } from "@shared/types/ui-editor/effects";
import { EffectsStackEditor } from "./EffectsStackEditor";
import { useTranslation } from "@/lib/i18n";

export type StaticEffectsSectionProps = {
    effects: ElementEffectValues;
    onChange: (next: ElementEffectValues) => void;
    supportedKinds: readonly VisualEffectKind[];
    draftResetKey: string;
};

export function StaticEffectsSection({ effects, onChange, supportedKinds, draftResetKey }: StaticEffectsSectionProps) {
    const { t } = useTranslation();
    return (
        <div className="rounded-lg border border-edge bg-fill-subtle p-2.5 space-y-2 min-w-0">
            <div className="text-xs font-medium text-fg-muted">{t("widgetChrome.effects.title")}</div>
            <EffectsStackEditor
                values={effects}
                onChange={onChange}
                supportedKinds={supportedKinds}
                draftResetKey={draftResetKey}
            />
        </div>
    );
}
