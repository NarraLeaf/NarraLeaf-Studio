import type { LocaleNamespace } from "../types";

/** `devMode` 日本語。開発モードのウィンドウとオーバーレイ。実行面、セッションの状態、実況デバッグの道具。 */
export const devMode = {
    title: "開発モード",
    dismiss: "閉じる",
    surfaceUnavailable: "サーフェスが使えない",
    waitingPayload: "開発モードのペイロードを待っている…",
    surfaceNotFound: "サーフェスが見つからない：{surfaceId}",
    issues: {
        // ドロワーの他のパネルと同じく一語。
        title: "問題",
        empty: "失敗したものはない",
        // 起動や再読み込みの失敗に付く見出し。指し示すストーリーがまだ無い時点で起きたもので、
        // 他の項目と違って場所を持たないので、何についての知らせかをここで言う。
        sessionFailure: "セッションを開始できなかった",
        atLine: "{line} 行目 · {scene}",
        inScene: "{scene} 内",
        noLocation: "どの行かをたどれなかった",
        viaPlayHead: "再生位置",
        openInStudio: "Studio で開く",
        openFailed: "このプロジェクトのワークスペースウィンドウが開いていない",
        stack: "スタック",
        dismissAll: "すべて閉じる（{count}）",
        summary: "エラー {errors} 件 · 警告 {warnings} 件",
    },
    // ドロワーのパネル名は主題そのままの一語にする。ストーリー、インターフェース、デバッガー。
    // 並びをそろえるのは意図的で、「ストーリーランタイム」と「ブループリント DevTools」が並ぶと、
    // 動いている 1 本のゲームの 2 つの見方ではなく 2 つの製品に読める。
    devtools: {
        title: "インターフェース",
        menuAria: "プレビューのデバッグ道具",
        openMenu: "プレビューのデバッグ道具のメニューを開く",
        closeMenu: "プレビューのデバッグ道具のメニューを閉じる",
        panelsAria: "インターフェースのパネル",
        skipToNextChoice: "次の選択肢まで飛ばす",
        skipToNextChoiceBusy: "飛ばしている…",
        // このウィンドウのゲームからデバッグボタンを外す。戻す手段はこのキーだけなので、
        // 項目そのものが自分のキーを表示する。
        hide: "このボタンを隠す",
    },
    tabs: {
        blueprints: "ブループリント",
        output: "出力",
        // 「スコープ」とは呼ばない。その名前のタブはデバッガー側にあって、止まったフレームの変数を持つ。
        // こちらはどのフレームにも属さないホスト自身の実行時の状態。
        uiState: "UI の状態",
        variables: "変数",
        context: "コンテキスト",
        timeline: "タイムライン",
        scene: "シーン",
    },
    runtime: {
        title: "ストーリー",
        panelsAria: "ストーリーのパネル",
        snapshot: "スナップショット",
        snapshotDefault: "既定値",
        noStory: "ストーリーが動いていない",
        noVariables: "宣言された変数がない",
        noRows: "このシーンに行がない",
        // 実行の文脈。動いているシーン、再生位置が入っている入れ物、並列の各枝。
        // いずれも見出しで、すぐ後ろに答えが続く。
        contextScene: "シーン",
        contextInside: "この中",
        contextRunning: "実行中",
        currentScene: "現在",
        // シーンマップ。マップの目盛りに使う番号と、動いているゲームがいま持っている値。
        // ランタイムが答えられるときだけ出る。既定値は現在の値ではない。
        focusNone: "フォーカスなし",
        focusLive: "現在の値",
    },
    /**
     * ブループリントのデバッガー。ブレークポイント、停止、ステップ実行。ここのラベルは
     * どれも DevTools と同じ語にしてある。JavaScript をデバッグしたことのある作者は
     * 「ステップオーバー」で何が起きるかをすでに知っていて、別の語を作るとその知識を捨てさせる。
     */
    debugger: {
        title: "デバッガー",
        openGraph: "グラフを表示",
        graphPicker: "グラフ",
        pickGraph: "表示するグラフを選ぶ",
        statusRunning: "実行中",
        statusPausePending: "次のノードで一時停止する…",
        statusBreakpoint: "ブレークポイントで停止中",
        statusStepped: "停止中",
        resume: "再開",
        pause: "一時停止",
        stepOver: "ステップオーバー",
        stepInto: "ステップイン",
        stepOut: "ステップアウト",
        callStack: "コールスタック",
        scope: "スコープ",
        scopeEmpty: "スコープに変数がない",
        eventPayload: "イベント",
        nodeOutputs: "ノードの出力",
        breakpoints: "ブレークポイント",
        breakpointsEmpty: "ブレークポイントがない。グラフ上のノードを右クリックして追加する",
        removeAllBreakpoints: "ブレークポイントをすべて取り除く",
        missingNode: "ノードがない",
        syncGraphNotice: "このグラフは同期的に評価されるので、ここに置いたブレークポイントでは止まらない",
    },
    /**
     * セーブのパネル。ディスク上のスロット、選んだスロットの中身、そしてどのスロットにも属さない
     * プロジェクト全体の永続ストア。
     *
     * 失敗の文言はわざと淡々と書いてある。書き換えたストーリーに古いセーブを読ませるのは
     * セーブの行き着く先であって事故ではない。だから作者が手を打てる事実、すなわちその
     * セーブがまだ立たせようとしている要素の名前と、実行がどうなったかだけを言って終える。
     */
    saves: {
        title: "セーブ",
        refresh: "更新",
        slots: "スロット",
        noSaves: "セーブがない",
        load: "セーブを読み込む",
        delete: "セーブを削除",
        selectSlot: "中身を見るにはセーブを選ぶ",
        unreadable: "このセーブは読めなかった",
        contents: "中身",
        noStory: "ストーリーが動いていないので、名前空間の名前が分からない",
        savedScope: "変数",
        unclaimed: "引き取り手のないキー",
        visited: "訪問済み",
        visitedScenes: "シーン",
        visitedOptions: "選択肢",
        loaded: "読み込んだ",
        loadedWithLosses: "読み込んだが、失われたものがある",
        droppedBacklog: "落としたバックログの行：{total} 件中 {count} 件。対応する行がもう存在しない",
        unclaimedOnLoad: "宣言された変数のないキー：{count}",
        missingElement: "このセーブは、ストーリーにもう無い要素を立たせようとしている：{id}",
        sessionRestored: "直前の実行を開始し直した",
        sessionLost: "実行を開始し直せなかった",
        persistent: "永続",
        noPersistent: "宣言された永続変数がない",
        otherKeys: "その他のキー",
    },
    panel: {
        float: "パネルを切り離す",
        dock: "パネルを収める",
    },
    blueprints: {
        empty: "ブループリントがない",
        openWorkspace: "ワークスペース",
        cannotOpen: "このブループリントはプレビューからは開けない",
        openFailed: "ブループリントを開けなかった",
    },
    output: {
        logLevel: "ログレベル",
        empty: "出力がない",
        level: {
            log: "ログ",
            verbose: "詳細",
        },
    },
    // インターフェース ▸ UI の状態。呼び出しフレームのスコープではなく、ホストの実行時の状態。
    // ドロワーに 2 つある「スコープ」がソース上でも別語のままになるよう、タブ名を群の名前にしてある。
    uiState: {
        surface: "サーフェス",
        global: "グローバル",
        widget: "ウィジェット",
        hover: "hover",
        active: "active",
        focus: "focus",
        variants: "バリアント",
    },
} satisfies LocaleNamespace<"devMode">;
