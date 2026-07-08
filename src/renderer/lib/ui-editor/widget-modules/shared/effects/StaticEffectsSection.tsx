import type { ElementEffectValues, VisualEffectKind } from "@shared/types/ui-editor/effects";
import { EffectsStackEditor } from "./EffectsStackEditor";

export type StaticEffectsSectionProps = {
    effects: ElementEffectValues;
    onChange: (next: ElementEffectValues) => void;
    supportedKinds: readonly VisualEffectKind[];
    draftResetKey: string;
};

export function StaticEffectsSection({ effects, onChange, supportedKinds, draftResetKey }: StaticEffectsSectionProps) {
    return (
        <div className="rounded-lg border border-edge bg-black/20 p-2.5 space-y-2 min-w-0">
            <div className="text-xs font-medium text-fg-muted">Effects</div>
            <EffectsStackEditor
                values={effects}
                onChange={onChange}
                supportedKinds={supportedKinds}
                draftResetKey={draftResetKey}
            />
        </div>
    );
}
