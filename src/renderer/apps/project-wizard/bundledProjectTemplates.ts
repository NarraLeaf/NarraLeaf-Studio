import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { resolveProjectTemplateText, type ProjectTemplateDescriptor } from "@shared/types/projectTemplate";
import type { ProjectTemplate } from "./types";

/**
 * The project templates this build ships, as first-page cards.
 *
 * They are read from `resources/templates` rather than declared in `constants.ts`
 * because they are *content*: adding one is dropping a directory into resources,
 * not editing the wizard. Their wording travels in their own manifest for the same
 * reason — a template added after a release cannot add keys to the app's catalogs.
 *
 * Fetched once per window and cached: the first page renders before, during and
 * after the fetch, and a card list that reshuffles under the pointer is worse than
 * one that arrives a beat late.
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

function toCard(descriptor: ProjectTemplateDescriptor, locale: string): ProjectTemplate {
    const text = resolveProjectTemplateText(descriptor, locale);
    return {
        id: descriptor.id,
        flow: "create",
        name: text.name,
        description: text.description,
        icon: Sparkles,
        category: "Template",
        // The manifest already carries the localized strings, so no i18n keys here:
        // `nameKey`/`descriptionKey` would have to name keys that do not exist.
        contentTemplateId: descriptor.id,
        designSize: descriptor.designSize,
    };
}

export function useBundledProjectTemplates(): ProjectTemplate[] {
    const [descriptors, setDescriptors] = useState<ProjectTemplateDescriptor[]>([]);
    // From the hook, so switching language re-labels the cards in place.
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

    return descriptors.map(descriptor => toCard(descriptor, locale));
}
