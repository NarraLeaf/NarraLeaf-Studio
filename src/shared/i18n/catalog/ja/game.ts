import type { LocaleNamespace } from "../types";

/**
 * `game` 日本語。走っているゲーム自身が出す文言。開発モードでも配布ビルドでも同じ。
 *
 * `saveLoad.refused*` はゲームの中でプレイヤーに見せる。残りは走りを見ている側、
 * すなわち開発モードの問題パネル、なければログに書く。
 */
export const game = {
    saveLoad: {
        refused: "このセーブは読み込めなかった。ゲームは現在の位置から続く",
        refusedOtherStory: "このセーブは別のバージョンのストーリーで書かれている。ゲームは現在の位置から続く",
        notApplied: "セーブの読み込み：「{id}」は適用されず、走っているゲームは変わっていない。{detail}",
        putBack: "セーブの読み込み：「{id}」は適用されず、走っているゲームは元に戻した。{detail}",
        notRestored: "セーブの読み込み：「{id}」は適用されず、走っているゲームを元に戻せなかった。{detail}",
        otherStory: "セーブの読み込み：「{id}」は別のバージョンのストーリーで書かれている",
        detail: {
            unreadable: "このセーブは読めなかった。{error}",
            missing: "その id のセーブはない",
            malformed: "保存されている内容がセーブデータの形式ではない",
            unresolvedScene: "このセーブがいたシーンは走っているストーリーにない",
            unresolvedElement: "このセーブが舞台に出すものが、走っているストーリーに揃っていない",
            unresolvedAction: "このセーブが止まっていた行は走っているストーリーにない",
            savedAt: "{detail} セーブの最後の行：{line}",
            engine: "{error}",
        },
    },
    /**
     * 描き続けられなくなったときにゲームが画面に出すもの。ゲーム自身の描画で起きた失敗と、
     * そもそも読めなかったパックの両方。
     *
     * 読み手は作者ではなくプレイヤー。セーブは無事か、どう戻れるかにその場で答える。
     * 何が壊れたかは 1 クリック先に置く。
     */
    crash: {
        title: "ゲームが停止した",
        detail: "セーブデータに影響はない。再起動するとタイトル画面から始まる",
        restart: "再起動",
        showDetails: "詳細",
        copyDetails: "詳細をコピー",
        copied: "クリップボードにコピーした",
        copyFailed: "コピーできなかった：{error}",
    },
} satisfies LocaleNamespace<"game">;
