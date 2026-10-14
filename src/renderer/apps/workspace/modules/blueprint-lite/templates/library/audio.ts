/**
 * Audio: sounds for a page.
 *
 * A widget's own hover and click sounds are not here: those are the element's Sound section in the
 * inspector. Nor is a page's music: that is the page's Page Music in the inspector, which also hands
 * over to the next page's music and to the game's.
 *
 * Comments in English per project convention.
 */

import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines } from "./templateText";

export const AUDIO_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "ambientSound",
        category: "audio",
        owners: ["surfaceMain"],
        text: {
            en: {
                title: "Ambient sound",
                description: "Loops a sound while this page is shown and fades it out when the page closes.",
            },
            zh: { title: "环境音", description: "页面显示时循环播放音效，页面关闭时淡出" },
            ja: { title: "環境音", description: "ページの表示中に効果音をループ再生し、ページを閉じるときにフェードアウトする" },
        },
        // The handle is kept in a Memo so that closing the page stops this sound and nothing else:
        // Stop Sound with no handle stops every sound any blueprint started, which would silence the
        // music of the page beneath an overlay as well. A Memo rather than a wire from Play Sound,
        // because a node's outputs last only as long as the run that produced them.
        graph: () => lines(
            "    enter: blueprint.event.head.afterSurfaceEnter @0,0",
            "    play: blueprint.sound.play @260,0",
            "        audioTrackId = sound",
            "        loop = true",
            "        fadeIn = 1",
            "    keep: blueprint.data.memo @520,0",
            "    exit: blueprint.event.head.beforeSurfaceExit @0,220",
            "    stop: blueprint.sound.stop @520,220",
            "        fade = 1",
            "    enter -> play -> keep",
            "    play.handle -> keep.value",
            "    exit -> stop",
            "    keep.result -> stop.handle",
        ),
        choices: { play: ["soundAssetId"] },
    },
    {
        id: "pageOpenSound",
        category: "audio",
        owners: ["surfaceMain"],
        text: {
            en: { title: "Opening sound", description: "Plays a sound effect as this page opens." },
            zh: { title: "页面打开音效", description: "页面打开时播放音效" },
            ja: { title: "ページを開く音", description: "ページを開くときに効果音を鳴らす" },
        },
        // Surface Init runs as the page is about to appear, so the sound starts with the page rather
        // than once its enter animation has finished.
        graph: () => lines(
            "    init: blueprint.event.head.surfaceInit @0,0",
            "    play: blueprint.sound.play @260,0",
            "        audioTrackId = sound",
            "    init -> play",
        ),
        choices: { play: ["soundAssetId"] },
    },
];
