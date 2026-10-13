import { useEffect, useMemo, useState } from "react";
import type { StoryActionPayload } from "@shared/types/story";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import {
    editableStoryPluginActionParams,
    storyPluginParamSelectOptions,
    withStoryPluginParam,
} from "@/lib/story/pluginActionParams";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import { Services, type StoryPluginActionRegistration } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { FieldGrid, NumberField, SelectField, TextField } from "./inspectorFieldKit";

type PluginActionPayload = Extract<StoryActionPayload, { action: "plugin" }>;

/**
 * The inspector for a row a plugin story action inserted: one field per entry of the action's
 * `params`, each editing that key of the row's params.
 *
 * Read from the live registration, so the fields follow the installed plugin's version and language
 * the way the row's label does. A row whose plugin is missing or disabled, or whose action declares
 * no fields, shows nothing here - the same as before actions could declare any.
 */
export function StoryPluginActionEditor(props: {
    payload: PluginActionPayload;
    onChange: (payload: PluginActionPayload) => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(
        () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
        [context, isInitialized],
    );
    const nodeCatalog = useMemo(
        () => (context && isInitialized ? context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog) : null),
        [context, isInitialized],
    );
    const registration = useStoryPluginActionRegistration(storyService, props.payload.actionId);
    const dynamicOptions = useDynamicSelectOptions(nodeCatalog);

    const fields = editableStoryPluginActionParams(registration?.params);
    if (fields.length === 0) {
        return null;
    }
    const { payload } = props;
    const setParam = (key: string, value: string | number | undefined) =>
        props.onChange({ ...payload, params: withStoryPluginParam(payload.params, key, value) });

    return (
        <FieldGrid>
            {fields.map(param => {
                const current = payload.params[param.key];
                if (param.kind === "select") {
                    return (
                        <SelectField
                            key={param.key}
                            label={param.label}
                            options={storyPluginParamSelectOptions(param, dynamicOptions, current, value =>
                                t("storyInspector.plugin.missingOption", { value }))}
                            value={typeof current === "string" ? current : ""}
                            onChange={value => setParam(param.key, String(value))}
                        />
                    );
                }
                if (param.kind === "number") {
                    return (
                        <NumberField
                            key={param.key}
                            label={param.label}
                            value={typeof current === "number" ? current : undefined}
                            onChange={value => setParam(param.key, value)}
                        />
                    );
                }
                return (
                    <TextField
                        key={param.key}
                        label={param.label}
                        value={typeof current === "string" ? current : ""}
                        onChange={value => setParam(param.key, value)}
                    />
                );
            })}
        </FieldGrid>
    );
}

/** The live registration behind an action id, following installs, reloads and uninstalls. */
function useStoryPluginActionRegistration(
    storyService: StoryService | null,
    actionId: string,
): StoryPluginActionRegistration | undefined {
    const [registration, setRegistration] = useState(() => storyService?.getPluginAction(actionId));
    useEffect(() => {
        if (!storyService) {
            setRegistration(undefined);
            return;
        }
        setRegistration(storyService.getPluginAction(actionId));
        return storyService.onPluginActionsChanged(() => setRegistration(storyService.getPluginAction(actionId)));
    }, [actionId, storyService]);
    return registration;
}

/**
 * Every dynamic option list a plugin registered, refreshed when a plugin says its lists changed - the
 * same lists, and the same signal, a plugin node's picker reads.
 */
function useDynamicSelectOptions(
    nodeCatalog: BlueprintNodeCatalogService | null,
): Record<string, BlueprintInspectorParamSelectOption[]> {
    const [options, setOptions] = useState<Record<string, BlueprintInspectorParamSelectOption[]>>(
        () => nodeCatalog?.getDynamicSelectOptions() ?? {},
    );
    useEffect(() => {
        if (!nodeCatalog) {
            setOptions({});
            return;
        }
        setOptions(nodeCatalog.getDynamicSelectOptions());
        return nodeCatalog.onDynamicSelectOptionsChanged(() => setOptions(nodeCatalog.getDynamicSelectOptions()));
    }, [nodeCatalog]);
    return options;
}
