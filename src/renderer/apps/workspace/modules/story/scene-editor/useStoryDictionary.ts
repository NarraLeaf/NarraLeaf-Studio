import { useEffect, useMemo, useState } from "react";
import { dictionaryNeedles, type DictionaryNeedle } from "@shared/dictionary/dictionaryMatch";
import { DEFAULT_DICTIONARY_OPTIONS } from "@shared/types/dictionary";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * What the story field needs to read a row against the project dictionary, and nothing else.
 *
 * The needles rather than the entries, because building them walks the whole dictionary and the
 * field would otherwise do it per keystroke. They are rebuilt when the dictionary changes and at no
 * other time - which is also what `revision` announces, so a row that is already open re-checks
 * itself the moment a term is added from another row.
 */
export type StoryDictionaryBinding = {
    needles: readonly DictionaryNeedle[];
    /** Bumped whenever the dictionary changes. Watched by the open row. */
    revision: number;
};

const NOT_CHECKING: StoryDictionaryBinding = { needles: [], revision: 0 };

export function useStoryDictionary(): StoryDictionaryBinding {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo<DictionaryService | null>(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<DictionaryService>(Services.Dictionary);
    }, [context, isInitialized]);

    const [binding, setBinding] = useState<StoryDictionaryBinding>(NOT_CHECKING);

    useEffect(() => {
        if (!service) {
            setBinding(NOT_CHECKING);
            return;
        }
        const sync = () => {
            let needles: DictionaryNeedle[] = [];
            try {
                needles = dictionaryNeedles(service.listEntries(), service.getOptions());
            } catch {
                // A recovery-mode workspace never loaded the document. Nothing to look for, which is
                // the same answer an empty dictionary gives.
                needles = dictionaryNeedles([], DEFAULT_DICTIONARY_OPTIONS);
            }
            setBinding(current => ({ needles, revision: current.revision + 1 }));
        };
        sync();
        return service.onEntriesChanged(sync);
    }, [service]);

    return binding;
}
