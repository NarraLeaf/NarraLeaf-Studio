import type { LocaleNamespace } from "../types";

/**
 * `test` 日本語。テストの一式。実行メニューのテスト選択、レポートタブ、ステータスバーの段階、
 * コンソールのチャンネル、そして Studio に組み込みのテスト。
 *
 * ここでいう「テスト」は作者が *自分のゲーム* に対して走らせる検査。エンディングに到達するか、
 * ネットワーク無しでも動くか、といったもの。リポジトリのユニットテストとは無関係。
 */
export const test = {
    action: {
        // 製品ビルドの隣に並ぶ実行メニューの行。何かを始めるのではなく選択画面を開くので三点リーダ付き。
        open: "テスト…",
        run: "テストを実行",
        stop: "テストを停止",
    },
    // ステータスバーの実行セルに出るモード名。「<モード> | <段階>」の左側で、
    // 段階のほうは他の実行と共通の `workspace.shell.statusBar.phase.*` から来る。
    statusBar: {
        label: "テスト",
    },
    category: {
        integrity: "整合性",
        runtime: "ランタイム",
        compatibility: "互換性",
        custom: "カスタム",
    },
    // 選択画面の各行に付く。ゲームのウィンドウが出るかどうか。
    presentation: {
        headless: "ヘッドレス",
        windowed: "ウィンドウ表示",
    },
    picker: {
        title: "テストを実行",
        start: "開始",
        empty: "登録されているテストはない",
    },
    status: {
        running: "実行中",
        passed: "合格",
        failed: "不合格",
        skipped: "スキップ",
        cancelled: "中止",
        errored: "エラー",
    },
    severity: {
        error: "エラー",
        warning: "警告",
        info: "情報",
    },
    report: {
        title: "テストレポート",
        // 二種類の「何も無い」。走り終えて何も見つからなかった場合と、まだ何も走っていない場合。
        empty: "指摘なし",
        none: "まだ実行していない",
        rerun: "もう一度実行",
        severityFilter: "重大度",
        filterAll: "すべて",
        findings: "エラー {errors} 件、警告 {warnings} 件、情報 {infos} 件",
        durationSeconds: "{seconds} 秒",
        durationMinutes: "{minutes} 分 {seconds} 秒",
    },
    // 選択画面の行が灰色になっている理由。実行できないのは異常ではなく普通の状態。
    reason: {
        frozen: "ワークスペースの凍結中は実行できない",
        alreadyRunning: "別の実行が進行中",
    },
    console: {
        channel: "テスト",
        started: "{title} を開始",
        finished: "{title} {status}（{duration}）",
        finding: "{severity} {message}",
    },
    toast: {
        passed: "{title} 合格",
        failed: "{title} 不合格",
        skipped: "{title} スキップ",
        cancelled: "{title} 中止",
        errored: "{title} を実行できなかった",
    },
    builtin: {
        projectDiagnostics: {
            title: "プロジェクト診断",
            description: "プロジェクトの検査ルールすべてを 1 つのテストとして実行",
            summary: {
                passed: "問題なし",
                failed: "エラー {errors} 件、警告 {warnings} 件",
            },
        },
        reachableEndings: {
            title: "エンディングへの到達",
            description: "物語のどの道もエンディング（/ending）に届くかどうか",
            // 実行できないのは異常ではなく普通の状態。作者の落ち度ではなくプロジェクトの現状を述べ、
            // 走らせるために足りていない一点だけを名指しする。
            skipped: {
                noEndings: "開始地点のあるストーリーに /ending が一つも無い",
                noEntryPoint: "どのストーリーにも開始地点が設定されていない",
                undecidableEntry: "Start Story ノードが実行時にシーンを決めるので、開始地点を読み取れない",
                storiesUnread: "読み込めないストーリーがある",
            },
            finding: {
                pathRunsOut: "ここで進行が止まり、エンディングに届かない",
                optionRunsOut: "「{option}」はエンディングに届かないまま止まる",
                endingUnreached: "「{name}」に届く道が無い",
                endingUnreachedUnnamed: "このエンディングに届く道が無い",
            },
            // 数を先に置かず件数として読ませる。合格した実行でも、届かないエンディングは伝える価値がある。
            summary: {
                passed: "どの道もエンディングに届く。届かないエンディング {unreached} / {endings}",
                failed: "止まってしまう道 {errors} 件。届かないエンディング {unreached} / {endings}",
            },
        },
    },
} satisfies LocaleNamespace<"test">;
