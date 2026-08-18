import { useMemo, useState } from "react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { isElementMount } from "@shared/types/ui-editor/stageSlots";
import { Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { CustomFieldProps, SelectOption } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * The frame this character enters through when a story row does not name one.
 *
 * With identity rather than with the appearance, for the reason the voice bus is: how a character is
 * presented on stage survives a switch between poses and layers, which discards everything the two
 * kinds do not share.
 *
 * A `custom` field rather than the framework's `select` for the same reason as its neighbour: the
 * options come from the UI document, which the author may be editing in another tab, and the
 * property schema's context carries only the character. Frames are made in UI → Stage avatar, and
 * this deliberately does not offer to make one: a frame is a drawing, and the place to draw is the
 * canvas.
 */
export function CharacterStageFrameField({ data }: CustomFieldProps<CharacterEditorContext>) {
    const { t } = useTranslation();
    const profile = data.character.profile;
    const workspace = useOptionalWorkspace();
    // Local so the select answers the click immediately, but tagged with whose value it is: the panel
    // reuses one mounted field across characters.
    const characterId = profile.getId();
    const [draft, setDraft] = useState(() => ({ characterId, surfaceId: profile.getStageFrameSurfaceId() ?? "" }));
    const surfaceId = draft.characterId === characterId ? draft.surfaceId : profile.getStageFrameSurfaceId() ?? "";

    const frames = useMemo<UIStageSurface[]>(() => {
        const service = workspace?.isInitialized
            ? workspace.context?.services.get<UIDocumentService>(Services.UIDocument) ?? null
            : null;
        return (service?.getDocument().surfaces ?? []).filter((surface): surface is UIStageSurface =>
            surface.kind === "stageSurface" && isElementMount(surface.mount));
    }, [workspace]);

    const options = useMemo<SelectOption[]>(() => {
        const entries: SelectOption[] = [
            { value: "", label: t("characters.properties.stageFrameNone") },
            ...frames.map(frame => ({ value: frame.id, label: frame.name })),
        ];
        // A stored id no frame answers to — the author deleted it. Shown as itself rather than
        // dropped, for the reason the voice field gives: a select that quietly displayed "no frame"
        // would agree with what the character *does* and disagree with what the document says, so
        // nobody would think to fix it.
        if (surfaceId && !entries.some(entry => entry.value === surfaceId)) {
            entries.push({ value: surfaceId, label: t("characters.properties.stageFrameMissing") });
        }
        return entries;
    }, [frames, surfaceId, t]);

    const commit = (next: string): void => {
        setDraft({ characterId, surfaceId: next });
        profile.setStageFrameSurfaceId(next || null);
    };

    return (
        <div className="min-w-0">
            <Select fullWidth options={options} value={surfaceId} onChange={value => commit(String(value))} />
            {frames.length === 0 && (
                <p className="mt-1 text-xs text-fg-subtle">{t("characters.properties.stageFrameEmpty")}</p>
            )}
        </div>
    );
}
