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
        storyStarted: "セーブの読み込み：「{id}」はこのプロジェクトの別のストーリーで書かれている。受け取るためにそのストーリーを開始した",
        relaunchedRow: "セーブの読み込み：「{id}」は別のビルドのもの。このセーブが記録した行からストーリーを開始し直した",
        relaunchedScene: "セーブの読み込み：「{id}」は別のビルドのもので、記録した行は存在しない。その行のシーンの先頭から開始し直した",
        detail: {
            unreadable: "このセーブは読めなかった。{error}",
            missing: "その id のセーブはない",
            malformed: "保存されている内容がセーブデータの形式ではない",
            unsupported: "このセーブはこのビルドが読めない形式で書かれている",
            policy: "このプロジェクトは別のビルドの古いセーブを復元しない",
            unanchored: "このセーブは位置を記録していないため、そこからストーリーを開始し直せない",
            sceneGone: "このセーブが記録したシーンはこのビルドに存在しない",
            relaunch: "このセーブが記録した位置からストーリーを開始し直せなかった。{error}",
            storySwitch: "このセーブが属するストーリーを舞台に出せなかった。{error}",
            unresolvedScene: "このセーブがいたシーンは走っているストーリーにない",
            unresolvedElement: "このセーブが舞台に出すものが、走っているストーリーに揃っていない",
            unresolvedAction: "このセーブが止まっていた行は走っているストーリーにない",
            savedAt: "{detail} セーブの最後の行：{line}",
            engine: "{error}",
        },
    },
    // 英語カタログを参照。走っているゲームが、それを見ている側に伝える文言。{node} はキャンバスの
    // 表示名に訳されたもので、どの文も id を含まない。
    run: {
        voicePlayFailed: "この行のボイスを再生できなかった",
        choiceVoicePlayFailed: "この選択肢のボイスを再生できなかった",
        savedVariableUndeclared: "「{node}」：実行中のストーリーはこのセーブ変数を宣言していない",
        valueNotSerializable: "「{node}」：セーブ変数にはセーブファイルに書き込める値しか入れられない",
        variablesNotSerializable: "セーブ変数と永続変数にはセーブファイルに書き込める値しか入れられない",
        persistenceUnavailable: "ここでは永続変数を使えない",
        storyMissing: "「{node}」：指定したストーリーはもうこのプロジェクトにない",
        sceneMissing: "「{node}」：指定したシーンはもうこのプロジェクトにない",
        noChoiceMenu: "「{node}」：メニューが表示されていない",
        noChoiceAtIndex: "「{node}」：メニューに {index} 番目の選択肢がない",
        saveCaptureFailed: "「{node}」：このセーブの画面を撮れなかった。セーブはスクリーンショットなしで書き込んだ",
        relaunchUnavailable: "開始し直せる実行中のストーリーがない",
        storyNotRestartable: "実行中だったストーリーを開始し直せなかった",
        saveStoryMissing: "このセーブが属するストーリーはこのビルドにない",
        storyCannotStart: "ここではストーリーを開始できない",
        noGameToResume: "再開先のゲームが立ち上がらなかった",
        resume: {
            relaunchRowGone: "この実行を始めた行はもう存在しない。シーンの最初の行から始めた",
            sceneGone: "再生中のシーンはもう存在しない。ストーリーを最初から始めた",
            storyGone: "再生中のストーリーはもう存在しない。ゲームを最初から始めた",
            rowGoneBefore: "再生中の行はもう存在しない。その前の行から再開した",
            rowGoneSceneStart: "再生中の行はもう存在しない。シーンの先頭から再開した",
        },
        language: {
            noRestart: "プレイ中に言語が変わったが、ここではゲームを再起動できない。画面上のテキスト、バックログ、再生中のボイスは元の言語のまま",
            restartFresh: "言語が変わった。プレイの進行を残さずにゲームを再起動する",
            saveFailed: "言語は変わったが、プレイの進行を保存できなかったため、ゲームは再起動していない：{error}",
            parked: "言語の変更のためにプレイの進行を退避した。ゲームを再起動する",
            restoring: "言語の変更で退避したプレイの進行を復元している",
            resumeFailed: "言語の変更後、プレイの進行を再開できなかった：{error}",
            resumeRefused: "言語の変更で退避したプレイの進行は受け付けられなかった。保存されたまま残っている",
            restored: "言語の変更で退避したプレイの進行を復元した",
            returnFailed: "言語の変更後、ゲームを最初に戻せなかった：{error}",
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
        saveReport: "レポートを保存",
        reportSaved: "レポートは {path} にある",
        reportFailed: "レポートを保存できなかった：{error}",
        logAt: "ログは {path} にある",
        bridgeUnavailable: "ゲームのランタイムブリッジを読み込めなかった",
    },
    /**
     * すでに開いているゲームの二つ目にならないための画面。
     *
     * 同じ書き出しのタブが二つあれば保存先は一つなので、後から書いたほうが残る。
     * 伝えるのは今の状態と抜け方だけ。
     */
    session: {
        title: "ゲームはすでに開いている",
        detail: "別のブラウザタブで動作中。そのタブを閉じてから、このページを再読み込みする",
        reload: "再読み込み",
    },
} satisfies LocaleNamespace<"game">;
