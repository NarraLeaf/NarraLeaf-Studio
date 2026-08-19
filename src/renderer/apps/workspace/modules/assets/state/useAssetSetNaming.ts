import { useEffect, useMemo, useState } from "react";
import type { AssetSetAxisNaming } from "@shared/types/assetSetLabels";
import type { ProjectAppTag } from "@shared/types/appTag";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { useTranslation } from "@/lib/i18n";

/**
 * What the library needs to print a coordinate in words rather than in tags.
 *
 * Two readings, and both are readings of something else the project declares - the language list and
 * each edition's own art position. They are subscribed rather than read once: adding a language or
 * changing which art an edition ships is exactly when a row's right-hand side stops being true.
 */
export function useAssetSetNaming({
    context,
    isInitialized,
}: {
    context: WorkspaceContext | null;
    isInitialized: boolean;
}): AssetSetAxisNaming {
    const { t } = useTranslation();
    const [locales, setLocales] = useState<ReadonlyMap<string, string>>(new Map());
    const [tags, setTags] = useState<ProjectAppTag[]>([]);
    const [revision, setRevision] = useState(0);

    const services = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        try {
            return {
                localization: context.services.get<LocalizationService>(Services.Localization),
                appTags: context.services.get<AppTagService>(Services.AppTags),
            };
        } catch {
            return null;
        }
    }, [context, isInitialized]);

    useEffect(() => {
        if (!services) {
            setLocales(new Map());
            return;
        }
        const read = () => setLocales(new Map(
            services.localization.getConfiguration().locales.map(locale => [locale.code, locale.displayName]),
        ));
        read();
        return services.localization.onConfigChanged(read);
    }, [services]);

    useEffect(() => {
        if (!services) {
            setTags([]);
            return;
        }
        setTags(services.appTags.listTags());
        // The axis positions live on the same document as the tags, so one subscription covers both;
        // the revision is what makes a position change rebuild the map even when the tag list has not
        // changed identity.
        return services.appTags.onTagsChanged(next => {
            setTags(next);
            setRevision(current => current + 1);
        });
    }, [services]);

    return useMemo(() => {
        const editionsByAxis = new Map<string, Map<string, string[]>>();
        if (services) {
            for (const tag of tags) {
                const axes = services.appTags.resolveAssetAxes(tag.id);
                for (const [key, value] of Object.entries(axes)) {
                    if (!value) {
                        continue;
                    }
                    const byValue = editionsByAxis.get(key) ?? new Map<string, string[]>();
                    byValue.set(value, [...(byValue.get(value) ?? []), tag.name]);
                    editionsByAxis.set(key, byValue);
                }
            }
        }
        return {
            locales,
            editionsByAxis,
            words: { language: t("assets.sets.axisWord.language"), edition: t("assets.sets.axisWord.variant") },
        };
    }, [locales, revision, services, t, tags]);
}
