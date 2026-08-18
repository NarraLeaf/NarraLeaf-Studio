import { useCallback, useEffect, useMemo, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * What the story field needs to know to check a line, and nothing else.
 *
 * The two answers come from opposite ends of the app - the language is worked out in the main
 * process, the words are a document this project owns - and the field should have to reach for
 * neither. It gets a language to check in, a way to ask whether the project already spells a word,
 * and a number that changes when either of those changes.
 */
export type StorySpellcheckBinding = {
  /** The language to check in, or `null` when nothing is being checked. */
  language: string | null;
  /** Whether the project dictionary already holds this word. */
  isKnownWord: (word: string) => boolean;
  /**
   * Bumped whenever the language or the project's words change.
   *
   * A field that is open when the author adds a word has already been checked, and the answer it
   * is showing was true a moment ago and is not now. Watching one number is how it finds out
   * without subscribing to two services of its own.
   */
  revision: number;
};

const NOT_CHECKING: StorySpellcheckBinding = {
  language: null,
  isKnownWord: () => false,
  revision: 0
};

/**
 * Bind the open story row to the project's spellchecking.
 *
 * Answers "nothing is checked" outside a workspace and before the dictionary service has published,
 * which is not an error state: a project whose language has no dictionary lives here permanently and
 * has to read as ordinary.
 */
export function useStorySpellcheck(): StorySpellcheckBinding {
  const { context, isInitialized } = useWorkspace();
  const service = useMemo<DictionaryService | null>(() => {
    if (!context || !isInitialized) {
      return null;
    }
    return context.services.get<DictionaryService>(Services.Dictionary);
  }, [context, isInitialized]);

  const [language, setLanguage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!service) {
      setLanguage(null);
      return;
    }
    const sync = () => {
      setLanguage(service.getSpellcheckStatus()?.language ?? null);
      setRevision((current) => current + 1);
    };
    sync();
    const offStatus = service.onStatusChanged(sync);
    const offWords = service.onWordsChanged(sync);
    return () => {
      offStatus();
      offWords();
    };
  }, [service]);

  const isKnownWord = useCallback(
    (word: string) => {
      try {
        return service?.hasWord(word) ?? false;
      } catch {
        // A recovery-mode workspace never loaded the document. Nothing is in it, so nothing is
        // known - which is the same answer an empty dictionary gives.
        return false;
      }
    },
    [service]
  );

  return useMemo(
    () => (service ? { language, isKnownWord, revision } : NOT_CHECKING),
    [isKnownWord, language, revision, service]
  );
}
