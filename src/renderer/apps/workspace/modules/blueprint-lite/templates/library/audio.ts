/**
 * Audio: music and sounds for a page.
 *
 * A widget's own hover and click sounds are not here: those are the element's Sound section in the
 * inspector.
 *
 * Comments in English per project convention.
 */

import { BellRing, Music, Waves } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines } from "./templateText";

export const AUDIO_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "pageMusic",
        category: "audio",
        owners: ["surfaceMain"],
        icon: Music,
        featured: 3,
        text: {
            en: {
                title: "Page music",
                description: "Plays music while this page is shown and fades it out when the page closes.",
            },
            zh: { title: "页面音乐", description: "页面显示时播放音乐，页面关闭时淡出" },
            ja: { title: "ページの音楽", description: "ページの表示中に音楽を再生し、ページを閉じるときにフェードアウトする" },
        },
        // The handle is kept in a Memo so that closing the page stops this music and nothing else:
        // Stop Sound with no handle stops every sound any blueprint started, the music of the page
        // beneath an overlay included. A Memo rather than a wire from Play Sound, because a node's
        // outputs last only as long as the run that produced them.
        graph: () => lines(
            "    enter: blueprint.event.head.afterSurfaceEnter @0,0",
            "    play: blueprint.sound.play @260,0",
            "        audioTrackId = bgm",
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
        id: "ambientSound",
        category: "audio",
        owners: ["surfaceMain"],
        icon: Waves,
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
        icon: BellRing,
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
