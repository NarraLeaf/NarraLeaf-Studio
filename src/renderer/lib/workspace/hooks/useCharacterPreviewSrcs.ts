import { useMemo } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { Services } from "@/lib/workspace/services/services";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";

/**
 * What an `nl.character` widget draws while there is no story running.
 *
 * On the editor canvas a frame is being *designed*: nothing has put a character on the stage, so the
 * engine has nothing to hand over, and a frame that drew a blank rectangle would be impossible to
 * lay out. This composites the named character's default look from the project instead, purely so
 * the author can see what they are framing.
 *
 * It is deliberately the only place Studio resolves a character's appearance for this feature. Once
 * a story is running, the sources come from the engine through `FramedCharacterContext` and this
 * hook is not consulted — which is what keeps "what does this character look like right now" a
 * question with one answer.
 *
 * The packaged game replaces this file with a shim that answers nothing, because there a character
 * is always live.
 */
export function useCharacterPreviewSrcs(characterId: string | null): { srcs: (string | null)[] } {
    const workspace = useOptionalWorkspace();
    const characterService = workspace?.isInitialized
        ? workspace.context?.services.get<CharacterService>(Services.Character) ?? null
        : null;
    // `null` is "any of them will do", not "draw nothing": a frame worn by the whole cast names no
    // character, and an author laying one out still has to see somebody in it. The first character
    // in the project is the stand-in, and it is the same choice the crop box makes — one rule, so
    // the canvas and the inspector cannot frame against two different faces.
    const character = useMemo(
        () => (characterId
            ? characterService?.getCharacter(characterId) ?? null
            : characterService?.listCharacter()[0] ?? null),
        [characterService, characterId],
    );
    // The character's own defaults: the default pose for `preset`, each axis's default tag for
    // `layered`. Passing nothing is what asks the appearance for them.
    const { url } = useCompositedSprite(character, {}, 1024);
    return useMemo(() => ({ srcs: url ? [url] : [] }), [url]);
}
