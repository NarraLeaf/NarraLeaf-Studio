import { useEffect, useMemo, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import {
    projectTemplateStageSizes,
    resolveProjectTemplateText,
    type ProjectTemplateDescriptor,
} from "@shared/types/projectTemplate";
import { blankTemplate } from "./constants";
import type { ProjectTemplate } from "./types";

/**
 * The templates this build offers, as the first page's right-hand list.
 *
 * All but the blank one are read from `resources/templates` rather than declared in
 * `constants.ts` because they are *content*: adding one is dropping a directory into
 * resources, not editing the wizard. Their wording travels in their own manifest for
 * the same reason — a template added after a release cannot add keys to the app's catalogs.
 *
 * Fetched once per window and cached: the list renders before, during and after the
 * fetch, and one that reshuffles under the pointer is worse than one that arrives a
 * beat late.
 */

let cache: Promise<ProjectTemplateDescriptor[]> | null = null;

function loadDescriptors(): Promise<ProjectTemplateDescriptor[]> {
    if (!cache) {
        cache = getInterface().projectTemplates.list()
            .then(result => (result.success && result.data ? result.data : []))
            .catch(error => {
                // A build with no templates directory is legitimate, and a failure to
                // read one must still leave the author able to make an empty project.
                console.warn("[Wizard] bundled project templates unavailable", error);
                return [];
            });
    }
    return cache;
}

function toEntry(descriptor: ProjectTemplateDescriptor, locale: string): ProjectTemplate {
    const text = resolveProjectTemplateText(descriptor, locale);
    return {
        id: descriptor.id,
        name: text.name,
        description: text.description,
        // The manifest already carries the localized strings, so no i18n keys here:
        // `nameKey`/`descriptionKey` would have to name keys that do not exist.
        contentTemplateId: descriptor.id,
        stageSizes: projectTemplateStageSizes(descriptor),
    };
}

/**
 * Blank first, then whatever this build ships.
 *
 * Blank leads because it is the answer that constrains nothing, and because a list whose first
 * row is content would read as though a template were required.
 */
export function useProjectTemplates(): ProjectTemplate[] {
    const [descriptors, setDescriptors] = useState<ProjectTemplateDescriptor[]>([]);
    // From the hook, so switching language re-labels the entries in place.
    const { locale } = useTranslation();

    useEffect(() => {
        let active = true;
        void loadDescriptors().then(loaded => {
            if (active) {
                setDescriptors(loaded);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    return useMemo(
        () => [blankTemplate, ...descriptors.map(descriptor => toEntry(descriptor, locale))],
        [descriptors, locale],
    );
}
