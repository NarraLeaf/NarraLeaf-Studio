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
        parameters: "パラメーター",
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
        distrusted: "設定でこのプロジェクトを信頼するまで実行できない",
        frozen: "ワークスペースの凍結中は実行できない",
        alreadyRunning: "別の実行が進行中",
        parameterEmpty: "このプロジェクトに{parameter}の選択肢がない",
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
        walkthrough: {
            title: "エンディング踏破",
            description: "ストーリー自身の開始シーンからゲームを実際に動かし、指定のエンディングまで進める",
            parameter: {
                ending: {
                    label: "エンディング",
                    description: "たどり着く先のエンディング",
                    option: "{story} / {scene} / {ending}",
                    unnamed: "名称未設定のエンディング",
                },
            },
            log: {
                planned: "経路を決定: シーン {scenes} 件、選択 {decisions} 件",
                choosing: "{scene}: 「{option}」を選択",
                improvised: "経路にない選択肢を「{option}」で通過",
            },
            finding: {
                endingMissing: "そのエンディングはストーリーに存在しない",
                noEntryPoint: "{story} の開始シーンが指定されていない",
                unreachable: "{story} の開始地点から {ending} に至る経路がない",
                optionMissing: "{scene} で「{option}」が提示されず、この経路は通れない",
                otherEnding: "{ending} ではなく {reached} に到達",
                endedWithoutEnding: "{ending} に到達しないままストーリーが終了",
                stalled: "{steps} ステップ進んだところで停止し、{ending} に到達しなかった",
                cancelled: "{steps} ステップ進んだところで中止",
                exit: {
                    closed: "{ending} に到達する前にゲームが閉じられた",
                    stopped: "{ending} に到達する前にゲームが停止された",
                    crashed: "{ending} に到達する前にゲームがクラッシュした",
                    failedToStart: "ゲームを開始できなかった",
                },
            },
            summary: {
                passed: "{ending} に到達",
            },
        },
        routeCoverage: {
            title: "ルート網羅",
            description: "条件を評価したうえで、各シーン・選択肢・エンディングに到達できるか",
            skipped: {
                noEntryPoint: "開始位置を示すストーリーがない",
                undecidableEntry: "Start Story ノードは実行時にシーンを決めるため、開始位置を読み取れない",
                storiesUnread: "読み込めないストーリーがある",
            },
            finding: {
                sceneUnreachable: "「{scene}」へ至る条件を満たせる経路がない",
                optionUnreachable: "「{option}」を提示する条件を満たせる経路がない",
                branchUnreachable: "この分岐に入る条件を満たせる経路がない",
                endingUnreachable: "「{name}」は書かれているが、到達条件を満たせる経路がない",
                endingUnreachableUnnamed: "このエンディングは書かれているが、到達条件を満たせる経路がない",
            },
            summary: {
                passed: "スクリプトが導く先にはすべて到達できる",
                failed: "到達不能: シーン {scenes} 件、選択肢 {options} 件、エンディング {endings} 件",
            },
        },
        reachableEndings: {
            title: "エンディングへの到達",
            description: "物語のどの経路もエンディング（/ending）に到達するか",
            // 実行できないのは異常ではなく普通の状態。作者の落ち度ではなくプロジェクトの現状を述べ、
            // 走らせるために足りていない一点だけを名指しする。
            skipped: {
                noEndings: "開始地点のあるストーリーに /ending が一つもない",
                noEntryPoint: "どのストーリーにも開始地点が設定されていない",
                undecidableEntry: "Start Story ノードが実行時にシーンを決めるので、開始地点を読み取れない",
                storiesUnread: "読み込めないストーリーがある",
            },
            finding: {
                pathRunsOut: "ここで進行が止まり、エンディングに到達しない",
                optionRunsOut: "「{option}」はエンディングに到達しないまま停止する",
                endingUnreached: "「{name}」に到達する経路がない",
                endingUnreachedUnnamed: "このエンディングに到達する経路がない",
            },
            // 数を先に置かず件数として読ませる。合格した実行でも、届かないエンディングは伝える価値がある。
            summary: {
                passed: "どの経路もエンディングに到達する。未到達のエンディング {unreached} / {endings}",
                failed: "途中で止まる経路 {errors} 件。未到達のエンディング {unreached} / {endings}",
            },
        },
    },
} satisfies LocaleNamespace<"test">;
