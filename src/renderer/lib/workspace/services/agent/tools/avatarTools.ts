/**
 * `character_avatars_autoframe`: dialog avatars framed on the head Studio's detector model finds.
 *
 * The same run as the Characters panel's "Auto-frame all dialog avatars" (`avatarAutoFrame.ts`),
 * without bringing the console up - its bar and summary still land on the console's avatars channel
 * for the author watching. The guide asks for it once per character right after the character gets
 * sprites: the bake that runs on its own cuts avatars with a silhouette heuristic, which frames a
 * hair ornament or a whole figure as often as a face.
 *
 * Comments in English per project convention.
 */

import { Services } from "../../services";
import type { CharacterService } from "../../core/CharacterService";
import { AutoFrameBusyError, runAutoFrame, type AutoFrameReport, type HeadFrameDetector } from "../../character/avatarAutoFrame";
import { AgentRefusal, answerJson, readOptionalBoolean, readOptionalString, refuse, type AgentToolHandler } from "../agentCall";
import { assertAgentMayStillWrite } from "../agentCommitGate";
import { findCharacter } from "./castTools";

/**
 * The detector, loaded on the first call: it pulls in onnxruntime-web, which nothing else in the tool
 * table needs and which only resolves in a browser.
 */
const detect: HeadFrameDetector = async layers => (await import("../../character/headDetector")).detectHeadFrame(layers);

/** The report in the words the other cast tools use: looks by name, crops as the model stores them. */
export function describeAutoFrame(report: AutoFrameReport) {
    return report.characters.map(character => {
        const by = (result: string) => character.outcomes.filter(outcome => outcome.result === result).map(outcome => outcome.label);
        const skipped = (reason: string) => character.outcomes
            .filter(outcome => outcome.result === "skipped" && outcome.reason === reason)
            .map(outcome => outcome.label);
        return {
            character: character.name,
            framed: by("framed"),
            noHeadFound: by("noHead"),
            unreadable: by("unreadable"),
            keptOwnFraming: skipped("framed"),
            handDrawnAvatar: skipped("override"),
            nothingDrawn: skipped("empty"),
        };
    });
}

export const characterAvatarsAutoframe: AgentToolHandler = async (args, tool) => {
    const { ctx, request, follow } = tool;
    const ref = readOptionalString(args, "character");
    const overwrite = readOptionalBoolean(args, "overwrite") ?? false;
    const cast = ctx.services.get<CharacterService>(Services.Character);

    let characterIds: string[] | undefined;
    if (ref) {
        const character = findCharacter(cast, ref);
        if (!character) {
            throw refuse("not_found", `No character "${ref}".`, "Call characters_list for the names and ids.");
        }
        const kind = character.profile.appearance.getKind();
        if (kind !== "preset" && kind !== "layered") {
            throw refuse(
                "unavailable",
                `"${character.profile.getName()}" is drawn by a ${kind} runtime and has no sprites to frame.`,
                "Give it a picture with character_upsert { defaultAvatar }.",
            );
        }
        characterIds = [character.profile.getId()];
        follow.describeCall(request.callId, character.profile.getName());
    }

    assertAgentMayStillWrite(tool);
    let report: AutoFrameReport;
    try {
        report = await runAutoFrame(ctx, {
            characterIds,
            overwrite,
            detect,
            // Detection takes seconds; the author may pause the agent or freeze the project meanwhile.
            beforeCommit: () => assertAgentMayStillWrite(tool, "Characters framed before this point keep their framing."),
        });
    } catch (error) {
        if (error instanceof AutoFrameBusyError) {
            throw refuse("unavailable", "Dialog avatars are already being auto-framed.", "Call again once that run has finished.");
        }
        if (error instanceof AgentRefusal) {
            throw error;
        }
        throw refuse("internal", `The head detector failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const characters = describeAutoFrame(report);
    const lead = report.framed + report.noHead + report.kept === 0
        ? "Nothing to frame: no differential with sprites and without a hand-drawn avatar."
        : `Framed ${report.framed} dialog avatar(s) on the detected head; no head found in ${report.noHead}; kept ${report.kept} existing framing(s).`
            + (report.noHead > 0 ? " Where no head was found the avatar keeps the automatic crop; set `avatars` on character_upsert if it frames the wrong place." : "")
            + " The avatars are cut from these framings at the next bake (the Characters panel, or before a playtest).";
    return answerJson({ framed: report.framed, noHeadFound: report.noHead, keptOwnFraming: report.kept, characters }, lead);
};
