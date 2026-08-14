import type { LocaleNamespace } from "../types";

/**
 * `workspace` 日本語。ワークスペースのウィンドウの枠組みと、ゲームのローカライズのパネル。
 * `shell` はウィンドウの枠（ツールバー、タブ、パネル、共通のダイアログ）を受け持つ。
 */
export const workspace = {
    localization: {
        panel: {
            languagesTitle: "言語",
            languagesHint: "ゲーム自身の言語。原文の言語はストーリーを書いている言語で、ほかはそれを元に翻訳する",
            addLanguage: "言語を追加",
            codePlaceholder: "コード（en、ja、zh-CN…）",
            namePlaceholder: "表示名",
            invalidCode: "言語コードに使えるのは英数字とハイフンだけ",
            sourceBadge: "原文",
            more: "その他",
            confirm: "確定",
            setSource: "原文の言語にする",
            removeLanguage: "言語を取り除く",
            removeConfirm: "{name} を取り除くか",
            removeConfirmDetail: "翻訳はディスクに残り、この言語を足し直すと戻ってくる",
            openTable: "翻訳の表を開く",
            progress: "{total} 件中 {completed} 件が翻訳済み",
            staleCount: "確認が要るもの {count} 件",
            importSummary: "翻訳 {applied} 件を読み込んだ（変更なし {unchanged}、対応不明 {unknown}、空のため飛ばした {skippedEmpty}）",
        },
        settings: {
            menu: "言語の設定…",
            title: "{name} の言語の設定",
            displayNameLabel: "表示名",
            fallbackLabel: "代わりに使う言語",
            fallbackHint: "この言語に翻訳の無い項目は、まずこの言語を使い、次に原文の言語を使う",
            fallbackLoops: "ここに戻ってくる",
        },
        exchange: {
            exportMenu: "翻訳を書き出す…",
            importMenu: "翻訳を読み込む…",
            importDialogTitle: "翻訳ファイルを選ぶ",
            exportTitle: "{name} の翻訳を書き出す",
            formatLabel: "形式",
            formatCsv: "CSV",
            formatCsvHint: "Excel、Google スプレッドシート",
            formatXliff: "XLIFF 1.2",
            formatXliffHint: "Trados、memoQ、OmegaT",
            formatPo: "gettext PO",
            formatPoHint: "Poedit、Weblate、Crowdin",
            formatJson: "JSON",
            formatJsonHint: "スクリプトや独自の処理",
            scopeLabel: "含めるもの",
            scopeAll: "すべて",
            scopePending: "未翻訳と要確認",
            exportAction: "書き出す",
            exportDone: "{count} 行を {path} に書き出した",
            exportEmpty: "書き出すものがない",
            importFailed: "ファイルを読めなかった",
            importUnsupported: "Studio が読めるのは CSV、XLIFF、PO、JSON",
            importNoRows: "このファイルに翻訳の単位がない",
            importWarnings: "{count} 件を飛ばした。最初のもの：{first}",
            localeMismatch: "このファイルは {declared} 向け。{name} に読み込むか",
            localeMismatchDetail: "ファイルが何と宣言していても、翻訳は選んだ言語に読み込まれる",
        },
        table: {
            storyLabel: "原文",
            sourceUi: "画面のテキスト",
            sourceKeys: "名前付きのキー",
            modeTranslate: "翻訳",
            modeReview: "確認",
            filterAll: "すべて",
            filterUntranslated: "未翻訳",
            filterStale: "要確認",
            filterCompleted: "翻訳済み",
            reviewFilterReviewed: "確認済み",
            reviewFilterUnreviewed: "未確認",
            charactersGroup: "キャラクター",
            characterSpeaker: "キャラクター",
            addKey: "追加",
            keyNamePlaceholder: "キー（menu.start…）",
            keySourcePlaceholder: "原文",
            invalidKeyName: "キー名に使えるのは英数字と、その間に置くドット、アンダースコア、ハイフン",
            removeKey: "キーを取り除く",
            removeKeyConfirm: "{name} を取り除くか",
            removeKeyConfirmDetail: "このキーの既存の翻訳は言語ファイルに残る",
            sourceColumn: "原文",
            targetColumn: "翻訳",
            targetPlaceholder: "翻訳する…",
            narrationSpeaker: "地の文",
            choiceSpeaker: "選択",
            markReviewed: "確認済みにする",
            unmarkReviewed: "翻訳済みに戻す",
            reviewApprove: "承認",
            reviewReturn: "差し戻す",
            reviewPendingCount: "残り {count} 件",
            reviewAllClear: "確認するものはもうない",
            staleHint: "この翻訳の後に原文が変わっている。保存し直すと最新として扱う",
            placeholderHint: "{n} のプレースホルダはそのまま残す。行の中の値になる",
            emptyStory: "このストーリーにはまだ翻訳できる行がない",
            emptyFilter: "この絞り込みに一致するものがない",
            noStories: "先にストーリーを作る。その行がここに翻訳対象として並ぶ",
            statusUntranslated: "未翻訳",
            statusMachine: "機械翻訳",
            statusTranslated: "翻訳済み",
            statusReviewed: "確認済み",
            statusStale: "要確認",
        },
    },
    voice: {
        panel: {
            languagesTitle: "ボイスの言語",
            languagesHint: "ボイスを収録する言語。テキストの言語とは独立している",
            addLanguage: "ボイスの言語を追加",
            codePlaceholder: "コード（ja、en、zh-CN…）",
            namePlaceholder: "表示名",
            invalidCode: "言語コードに使えるのは英数字とハイフンだけ",
            more: "その他",
            confirm: "確定",
            removeLanguage: "ボイスの言語を取り除く",
            removeConfirm: "{name} を取り除くか",
            removeConfirmDetail: "ボイスの割り当てはディスクに残り、この言語を足し直すと戻ってくる",
            openTable: "ボイスの表を開く",
            progress: "{total} 行中 {covered} 行に収録済み",
            staleCount: "古いもの {count} 件",
            exportScript: "収録台本を書き出す",
            exportPickup: "追加収録の台本を書き出す（古いものだけ）",
            importAudio: "音声を読み込む…",
            exportDone: "{path} に書き出した",
            pickupEmpty: "録り直しが要る行はない",
            importSummary: "テイク {linked} 件を結びつけた（対応不明 {unmatched}、失敗 {failed}）",
            importFailed: "音声ファイルを読み込めなかった",
            importScript: "収録台本を読み込む…",
            importScriptSummary: "{applied} 行を反映した（変更なし {unchanged}、ボイス対象外 {unknown}）",
            importScriptFailed: "その収録台本を読めなかった",
            namingTitle: "収録ファイル名のパターン",
            namingHint: "使える語：{tokens}。読み込んだ音声はこの名前で行と対応づける",
            namingReset: "既定に戻す",
        },
        table: {
            storyLabel: "ストーリー",
            groupByScene: "シーン別",
            groupByCharacter: "キャラクター別",
            modeAssign: "割り当て",
            modeAudition: "試聴",
            filterAll: "すべて",
            filterMissing: "未収録",
            filterOutdated: "古い",
            filterVoiced: "収録済み",
            filterApproved: "承認済み",
            auditionFilterAll: "すべて",
            auditionFilterApproved: "承認済み",
            auditionFilterPending: "未処理",
            narrationSpeaker: "地の文",
            narrationGroup: "地の文",
            castPlaceholder: "声の担当…",
            assign: "音声を割り当てる",
            replace: "音声を差し替える",
            remove: "ボイスを外す",
            play: "再生",
            stop: "停止",
            approve: "承認",
            reject: "差し戻す",
            clipMissing: "クリップが見つからない",
            outdatedHint: "このテイクを読み込んだ後に行が変わっている。クリップを読み込み直すと最新として扱う",
            noStories: "先にストーリーを作る。その台詞がここにボイス対象として並ぶ",
            emptyStory: "このストーリーにはまだ台詞がない",
            emptyFilter: "この絞り込みに一致するものがない",
            auditionAllClear: "試聴するものはもうない",
            auditionPendingCount: "残り {count} 件",
            statusMissing: "未収録",
            statusVoiced: "収録済み",
            statusApproved: "承認済み",
            statusOutdated: "古い",
            notePlaceholder: "メモ…",
            dropHint: "音声を落とすと割り当てる",
        },
    },
    // 復旧モード。プロジェクトが読み込めない、あるいは正しく読み込めないワークスペースを、
    // 読み取り専用かつプラグイン無しで開き直す道。
    recovery: {
        enter: "復旧モードで開く",
        enterFailed: "復旧モードを開けなかった：{error}",
        panelTitle: "復旧",
        // ウィンドウ上端の帯。事実 2 つと出口だけ。このモードについての残りは、場所のあるパネルに置く。
        banner: {
            state: "復旧モード：読み取り専用、プラグインは読み込んでいない",
            exit: "復旧モードを出る",
        },
        intro: "検査を走らせると、その部分だけを読み込んで結果を報告する。読めたものは普段どおり見て回れる",
        problems: {
            title: "見つかった問題",
            count: "{count}",
            empty: "このウィンドウを開く間に報告されたものはない",
            showRaw: "元のエラー",
            copy: "このエラーをコピー",
            copied: "コピーした",
        },
        probes: {
            title: "読み込みの検査",
            run: "実行",
            rerun: "もう一度実行",
            runAll: "すべて実行",
            project: "プロジェクトのマニフェスト",
            assets: "アセットの索引",
            story: "ストーリーのアウトライン",
            storyDocuments: "ストーリーの台本",
            interface: "インターフェースのドキュメント",
            characters: "キャラクター",
            localization: "ローカライズ",
            voice: "ボイス",
            variables: "永続変数",
            audioTracks: "オーディオトラック",
        },
        details: {
            noStories: "このプロジェクトにストーリーがない",
            storiesRead: "ストーリーのドキュメント {count} 件を読んだ",
        },
        tools: {
            title: "道具",
            openFolder: "プロジェクトのフォルダを開く",
            copyAll: "すべてコピー",
            copiedAll: "診断内容をコピーした",
            openFolderFailed: "プロジェクトのフォルダを開けなかった：{error}",
        },
        lore: {
            title: "バージョン履歴",
            loading: "バージョン管理を確認している",
            unavailable: "バージョン管理を使えない：{reason}",
            notARepository: "このプロジェクトは一度もバージョン管理下に置かれていない",
            noService: "このウィンドウではバージョン管理が起動しなかった",
            disabledHint: "このプロジェクトには復元できるバージョン履歴がない",
            head: "現在はバージョン {version}、ブランチ {branch}",
            emptyHistory: "記録されたバージョンがまだない",
            noMessage: "（メッセージなし）",
            checkpoint: "復旧用の地点を記録",
            checkpointDone: "{revision} として記録した",
            checkpointNothing: "記録するものがない。現在のバージョンがすでにこれらのファイルと一致している",
            checkpointFailed: "バージョンを記録できなかった：{error}",
            restore: "このバージョンを復元",
            restoreConfirm: "{version} を復元するか",
            restoreExplain: "プロジェクトのすべてのファイルが、そのバージョンの中身に置き換わる。先に現在の状態をバージョンとして記録し、復元もさらに 1 つのバージョンとして足される。消えるバージョンはない",
            cancel: "キャンセル",
            restoreDone: "{version} を復元した。通常のワークスペースとして開き直す",
            restoreUnrecorded: "ファイルは復元したが、新しいバージョンを記録できなかった：{error}",
            restoreFailed: "復元できなかった：{error}",
        },
        // 読み込みに失敗したまま通常のワークスペースが動き出したときに出る。何が原因になりやすいか、
        // なぜいま編集するのが危ないかを言う。復旧モードが *何であるか* は、入ってから読めばよい。
        offer: {
            message: "このプロジェクトは正しく読み込めなかった",
            // 「ファイル（複数可）」とは書かず 2 通り用意する。件数は最初に読まれるもので、
            // データ喪失の警告の中の括弧つきの複数形は、書きかけの穴埋めに読める。
            detailOne: "ファイルを 1 つ読めなかったので、このウィンドウにはプロジェクトの一部が欠けている。よくある原因は、保存の中断、同期やバックアップの道具による同時書き込み、プラグイン。いま編集すると、この欠けた状態を無事なファイルの上に書いてしまうことがある",
            detailMany: "{count} 個のファイルを読めなかったので、このウィンドウにはプロジェクトの一部が欠けている。よくある原因は、保存の中断、同期やバックアップの道具による同時書き込み、プラグイン。いま編集すると、この欠けた状態を無事なファイルの上に書いてしまうことがある",
            enter: "復旧モードで開く",
        },
        // 各キーは、何がおかしかったかではなく、ワークスペースが何をしていたかを言う。
        // エラーそのものはこの下にそのまま出る。
        operations: {
            enteredBecause: "ここへ至った失敗",
            shellService: "復旧モードのサービスを開始している",
            preflight: "プロジェクトのフォルダを確認している",
            assetsShardCreate: "アセットの索引を作成している",
            assetsShardRead: "アセットの索引を読んでいる",
            storyIndexRead: "ストーリーのアウトラインを読んでいる",
            storyIndexParse: "ストーリーのアウトラインを解析している",
            storyDocumentRead: "ストーリーの台本を読んでいる",
            storyDocumentParse: "ストーリーの台本を解析している",
            interfaceDocumentRead: "インターフェースのドキュメントを読んでいる",
            charactersRead: "キャラクターを読んでいる",
            pluginLoad: "プラグインを読み込んでいる",
            pluginHostLoad: "プラグインを読み込んでいる",
        },
    },
    // 元に戻すとやり直す。`scope` は積み重ねの名前（「<ここ> で元に戻す」）、
    // `entry` はその 1 段の名前で、メニューやトーストが何を取り消すかを言うときに使う。
    history: {
        scope: {
            storyScene: "シーン",
            storyMotion: "モーション",
            audioLoop: "音声のマーカー",
            uiSurface: "インターフェース",
            blueprint: "ブループリント",
            project: "プロジェクト",
        },
        menu: {
            undoNamed: "{step}を元に戻す",
            redoNamed: "{step}をやり直す",
        },
        entry: {
            edit: "編集",
            storyEdit: "ストーリーの編集",
            storyMotionEdit: "モーションの編集",
            audioMarkers: "マーカーの変更",
            surfaceEdit: "インターフェースの編集",
            blueprintEdit: "ブループリントの編集",
            replaceText: "テキストの置換",
        },
    },
    shell: {
        errorTitle: "ワークスペースを初期化できなかった",
        showStackTrace: "スタックトレースを表示",
        retry: "再試行",
        openOtherProject: "別のプロジェクトを開く",
        errorCopyDetails: "詳細をコピー",
        errorCopied: "エラーの詳細をクリップボードにコピーした",
        errorCopyFailed: "コピーできなかった：{error}",
        errorExportLogs: "ログを書き出す",
        errorExported: "ログを {path} に保存した",
        errorExportFailed: "ログを書き出せなかった：{error}",
        errorOpenFailed: "そのフォルダを開けなかった：{error}",
        notAProjectTitle: "このフォルダは NarraLeaf のプロジェクトではない",
        notAProjectDetail: ".nlproj ファイルが見つからない",
        openLauncher: "ランチャーを開く",
        panelRenderError: "このパネルで描画のエラーが起きた",
        mainEditorRegion: "メインのエディタ",
        resizeSplit: "分割の幅を変える",
        noActiveEditor: "エディタが開いていない",
        closePanel: "パネルを閉じる",
        closeTab: "{name} を閉じる",
        newTab: "新しいタブ",
        // タブ列の「+」で開く、ブラウザ風の空のタブ。
        newTabPage: {
            title: "新しいタブ",
        },
        tabMenu: {
            close: "閉じる",
            closeOthers: "ほかを閉じる",
            closeToRight: "右側のタブを閉じる",
            closeAll: "すべて閉じる",
            splitRight: "右に分割",
            splitDown: "下に分割",
            closeSplit: "分割を閉じる",
            reopenClosed: "閉じたタブを開き直す",
        },
        toggleLeftSidebar: "左のサイドバーを切り替え",
        toggleRightSidebar: "右のサイドバーを切り替え",
        toggleBottomPanel: "下のパネルを切り替え",
        // サイドバーのレールを右クリックしたときのメニュー。各パネルのアイコンの表示を切り替える
        // チェックリストと、右クリックしたパネルへの操作。
        panelMenu: {
            removeItem: "この項目を取り除く",
            collapseItem: "グループにまとめる",
        },
        // 左のレールのまとめ役。畳んだパネルを 1 つのアイコンで代表し、押すと一覧が開く。
        panelGroup: {
            title: "畳んだパネル",
        },
        openSettings: "設定を開く",
        stopDevMode: "開発モードを停止",
        stopPreview: "プレビューを停止",
        logoAlt: "NarraLeaf Studio のロゴ",
        editorTabsLabel: "エディタのタブ",
        // 検索できるコマンドパレット（Cmd/Ctrl+Shift+P）。すべての操作、メニューのコマンド、
        // 説明のあるショートカットを 1 つの一覧にし、打つそばから絞り込む。
        commandPalette: {
            title: "コマンドパレット",
            placeholder: "コマンドを入力…",
            empty: "一致するコマンドがない",
            // 空のときに出る、パレットをコマンドモードにする行（">" を入れる）。
            goToCommands: "コマンドを表示して実行",
            // 「<パネル>を開く」の移動系の項目に付く分類。
            categoryView: "表示",
            // エディタのタブに効くコマンドの分類と名前。
            categoryEditor: "エディタ",
            // 分類を宣言していないコマンドの見出し。
            categoryOther: "その他",
            categoryGo: "移動",
            categoryStory: "ストーリー",
            categoryRun: "実行",
            categoryProject: "プロジェクト",
            categoryPreferences: "環境設定",
            // バージョン管理のコマンドの分類。
            categoryVersionControl: "バージョン管理",
            editor: {
                closeTab: "タブを閉じる",
                closeSelectedTabs: "選択中のタブを閉じる",
                closeOthers: "ほかのタブを閉じる",
                closeToRight: "右側のタブを閉じる",
                closeAll: "すべてのタブを閉じる",
                splitRight: "エディタを右に分割",
                splitDown: "エディタを下に分割",
                closeOtherGroups: "ほかのエディタの組を閉じる",
            },
        },
        // 通知センター（操作バーのベル。すべてのトーストを一定数まで残す）。
        notifications: {
            title: "通知",
            clearAll: "消去",
            empty: "まだ何もない",
        },
        // 背景画像のダイアログ（設定またはコマンドパレットから開く）。
        background: {
            command: "背景画像を設定…",
            title: "背景画像",
            image: "画像",
            imagePlaceholder: "画像未選択",
            browse: "選ぶ…",
            opacity: "不透明度",
            blur: "ぼかし",
            // 0 のときはピクセル数の代わりにこれを出す。効果そのものが切れている状態。
            blurOff: "オフ",
            fillMode: "埋め方",
            anchor: "位置",
            fill: {
                cover: "拡大して埋める",
                contain: "収める",
                tile: "タイル",
                center: "中央",
            },
            cancel: "キャンセル",
            clear: "消して閉じる",
            apply: "完了",
        },
        // クイックオープン（mod+p）。開けるものを曖昧検索で選ぶ。
        quickOpen: {
            title: "クイックオープン",
            placeholder: "シーン、キャラクター、サーフェス、アセット、ブループリント…",
            empty: "一致するものがない",
            kinds: {
                scene: "シーン",
                character: "キャラクター",
                uiSurface: "UI",
                asset: "アセット",
                blueprint: "ブループリント",
            },
        },
        // 下端のステータスの帯。意味のあるときだけ出る。
        statusBar: {
            // 実行状態のセルのモード名。「<モード> | <段階>」と読ませ、いずれかが動いている間は
            // 帯全体にテーマ色が乗る。
            devMode: "開発モード",
            preview: "プレビュー",
            production: "製品ビルド",
            // 区切りの後ろの段階。すべての段階がすべてのモードにあるわけではない。
            phase: {
                starting: "開始している…",
                preparing: "準備している…",
                compiling: "コンパイルしている…",
                launching: "起動している…",
                packaging: "パッケージしている…",
                running: "実行中",
                reloading: "読み込み直している…",
                stopping: "停止している…",
            },
            openConsole: "コンソールを開く",
            unsavedChanges: "未保存の変更",
            saveNow: "いま保存",
            saving: "保存している…",
            saveFailed: "保存に失敗",
            retrySave: "いますぐ保存し直す",
            resetZoom: "拡大率を 100% に戻す",
            shortcuts: "キーボードショートカット",
            words: "{count} 語",
            lines: "{count} 行",
            noStoryOpen: "ストーリーを開いていない",
            openDashboard: "プロジェクトのダッシュボードを開く",
            openCurrentScene: "現在のシーンを開く",
            // 登録された各セルの名前。帯の右クリックの表示切り替えメニューにだけ出る。
            // セル自身はアイコンが主で、自分の状態を自分で示す。
            entries: {
                runStatus: "実行状態",
                unsavedChanges: "未保存の変更",
                wordCount: "ストーリーの統計",
                shortcuts: "キーボードショートカット",
                notifications: "通知",
                theme: "テーマの切り替え",
                zoom: "拡大率",
                version: "バージョン",
                // テキストドキュメントのセル。どのエディタから来たかではなく、何を報告するかで名付ける。
                // 作者が隠すかどうかを決めるのはそちらだから。
                textFileName: "テキストファイル名",
                textEncoding: "文字コード",
                textLineEnding: "改行コード",
                textSelection: "カーソル位置",
            },
        },
        // 保存の報告。ファイルを書けなかったときに出す居座るトーストと、「ストレージ」チャンネルに
        // 流れる行。書き込みの失敗は間隔を空けて諦めずに再試行するので、「失われた」ではなく
        // 「まだ試している」と書く。
        save: {
            failedTitle: "{file} を保存できなかった",
            failedDetailTransient: "裏で再試行を続けている。{error}",
            failedDetailPermanent: "これが直るまで、再試行しても変わらない。{error}",
            retry: "いますぐ再試行",
            consoleFailed: "書き込み失敗（{code}、{attempt} 回目）：{path} · {error}",
            consoleRecovered: "書き込み成功：{path}",
            flushFailed: "{label} を書き出せなかった：{error}",
            // 読む側。ディスクにはあるが解釈できないドキュメント。「Studio が作業を食べたのか」という
            // 不安に対して、まず起きなかったことを言う。
            unreadableTitle: "{file} を読めなかった",
            unreadableDetail: "{reason} ファイルは変わっていない。上書きもしていない",
            unreadableDetailQuarantined: "{reason} ファイルは変わっていない。その複製が {path} にある",
            consoleUnreadable: "読み込み失敗（{kind}）：{path} · {reason}",
            consoleQuarantined: "読めなかったファイルの複製を {path} に残した",
            // ワークスペースが凍結しているため断られた書き込み。失敗ではない。何も壊れておらず、
            // 再試行もしない。理由を言わないとバグに読める。
            frozenTitle: "変更は保存されていない",
            frozenDetailRevision: "バージョン {version} を開いている。バージョンを開いている間は何も保存されない",
            frozenDetailManual: "ワークスペースが凍結している。解除すると保存が再開する",
            // マージには「解除」が無い。マージが終わるまで作業ツリーは両側を抱えるので、
            // それを名指しすることだけが役に立つ。
            frozenDetailMerge: "マージが終わっていない。バージョンのパネルで終わらせると保存が再開する",
            consoleFrozen: "書き込みを拒否、ワークスペースが凍結中（{reason}）：{path}",
            // プロジェクトのデータを持つものの名前。書き出しに失敗したとき、および作業ツリーの
            // 読み直しでどれかに届かなかったときに使う。
            stores: {
                uiDocument: "インターフェースのドキュメント",
                uiGraph: "インターフェースのブループリント",
                story: "ストーリー",
                localization: "ローカライズ",
                voice: "ボイスのライブラリ",
                variables: "変数の登録",
                audioTracks: "オーディオトラック",
                appTags: "ビルドバリアント",
                brand: "ブランドの配色",
                saveSchema: "セーブ項目",
                characters: "キャラクター",
                project: "プロジェクトの設定",
                assets: "アセットのライブラリ",
            },
        },
        // 作業ツリーの読み直し。ディスク上のバイト列が、エディタの表示と一致しなくなったとき
        // （凍結を解いた、バージョンを復元した）。普通は何も見えないのが正しく、
        // 一部を読み戻せなかったときだけ口を開く。そのときパネルが古いままになるから。
        reload: {
            failedTitle: "プロジェクトを完全には読み直せなかった",
            failedDetail: "次のものは前の中身のまま：{stores}。もう一度読むにはプロジェクトを開き直す",
            console: "ディスクからプロジェクトを読み直した（{cause}）：{count} 件",
            consoleFailed: "{label} を読み直せなかった：{error}",
        },
        // ワークスペースの凍結。プロジェクトのデータは書かれなくなり、エディタの状態はそのまま。
        // 仕組みではなく、作者に何が起きるかで名付ける。
        freeze: {
            command: "プロジェクトを凍結（保存を止める）",
            release: "凍結を解除（保存を再開）",
            enteredTitle: "プロジェクトを凍結した",
            enteredDetail: "凍結を解除するまで、プロジェクトのファイルは書かれない",
            leftTitle: "凍結を解除した",
            leftDetail: "変更はまた保存される",
            // 凍結が無効にする上部バーのすべてのコントロールに出る説明。全部で 1 つの文にしてある。
            // 作者は「凍結したプロジェクトはこう見える」を一度覚えればよく、ボタンごとに違う言い訳を
            // 読まされる必要はない。隠さず無効にしてあるのは、まさにここに出す先を残すため。
            unavailable: "プロジェクトが凍結している間は使えない。凍結を解除すると使える",
        },
        // 実際のエディタで履歴を見る。バージョンのレールができるまでの道。
        revisionView: {
            showPrevious: "前のリビジョンを表示（読み取り専用）",
            // 着く場所ではなく、出るモードで名付ける。docs/help-system.md §4 を参照。
            leave: "履歴の閲覧をやめる",
            loadingTitle: "前のリビジョンを読んでいる…",
            loadingDetail: "リビジョンを初めて読むときは、リモートから取ってくることがある",
            shownTitle: "リビジョン {revision} を表示している",
            shownDetail: "エディタは読み取り専用。ディスク上のファイルは変わらない",
            noneTitle: "これより前のリビジョンはない",
            noneDetail: "このプロジェクトにはリビジョンが 1 つしかない",
            failedTitle: "そのリビジョンを表示できなかった",
        },
        // バージョン管理の各画面。左端のレール、プロジェクト切り替えのメニューの中のバージョンの節、
        // そしてステータスバーのセル。3 つとも *バージョン* を名指しし、変更の件数は決して言わない。
        // 数えるには走査が要り、走査は純粋な読み取りではない（docs/version-control.md §4.17）。
        versionControl: {
            title: "バージョン",
            open: "バージョンのレールを開く",
            // 1 つのボタンに 2 つのラベル。することが 2 つあるから。ワークスペースが凍結している間は
            // 48px の帯まで縮む。その帯は出口なので必ず残る。HEAD ではその帯が無いので、閉じると
            // 何も残らない。そこで「畳む」と書くと、作者が探しても見つからない列を約束することになる。
            collapse: "バージョンのレールを畳む",
            close: "バージョンのレールを閉じる",
            // 過去のリビジョンを表示している間、畳んだレール、ウィジェット、ステータスのセルに出る説明。
            // `{version}` はそのリビジョン自身のラベル、たとえば `#4`。
            viewingVersion: "バージョン {version} を表示中",
            currentVersion: "現在のバージョン",
            // 抜け道。レールがどちらの状態でも出るのは、出られない凍結したワークスペースこそ、
            // この機能が作者にしうる最悪のことだから。
            //
            // 出る *モード* で名付けている（docs/help-system.md §4）。
            returnToCurrent: "履歴の閲覧をやめる",
            returning: "履歴の表示から戻っている…",
            // この画面で唯一、作者のファイルを書き換える操作。下の 3 行だけが、それが起きるのを
            // 隔てている。
            //
            // 「復元」とだけ言わず、操作そのものを名乗る。確認ダイアログはこの文字列をボタンに載せる。
            // ファイルの上書きを説明する文の隣で「OK」とだけ書いてあるボタンは、押し間違いの温床。
            restore: "このバージョンを復元",
            // どのバージョンの話かを名指しする。作者はバージョンの一覧からここへ来ている。
            restoreConfirm: "バージョン {version} を復元するか",
            // 2 つの文があり、どちらも省けない。前半は作者が同意する内容、後半はなぜ同意しても
            // 安全かで、これを落とすと取り返しのつく操作が取り返しのつかない操作に見え、
            // その後は誰も使わなくなる。「先に記録する」は文字どおりで、1 バイトも書く前に
            // チェックポイントを確定し、それが取れなければ操作ごと取りやめる。
            restoreConfirmDetail:
                "プロジェクトのファイルが、このバージョンの中身に置き換わる。"
                + "先に現在の状態をチェックポイントとして記録し、消えるバージョンはない",
            // 長い。チェックポイント、バージョン管理下の全ファイルの書き換え、2 つ目のバージョン、
            // そして現在のバージョンへ戻るときと同じ全体の読み直し。
            restoring: "このバージョンを復元している…",
            // 復元の失敗のうち、作者のファイルが **すでに** 置き換わった後に起きるもの。書き換えは
            // 終わり、それを記録するコミットだけができなかった。エラーより先にプロジェクトの事実を言う。
            // そうしないと「失敗したから何も起きていない」という、真実と正反対の思い込みのまま
            // 1 週間前に戻ったプロジェクトで作業を続けることになる。`{action}` はバージョンを
            // 記録するボタンで、その文字列から取っている。
            restoreNotRecordedTitle: "ファイルは復元したが、バージョンは記録していない",
            restoreNotRecordedDetail:
                "プロジェクトのファイルはいまバージョン {version} の中身になっている。それを新しい"
                + "バージョンとして記録するのに失敗した（{error}）。「{action}」を押すと記録できる",
            // リポジトリの無いプロジェクト。仕組みではなく、何が無いかで名付ける。
            //
            // 短いのは、3 つの置き場所のうち 2 つが狭いから。ステータスバーのセルと上部バーの
            // ウィジェットはどちらも省略が起きる。3 つ目はレールで、そこには有効化のボタンと
            // `enableHint` がすぐ下に付いて説明を担うので、見出しは状態を名乗るだけでよい。
            //
            // 下の `noHistory` とは意図して別物。こちらはこのプロジェクトでバージョン管理が
            // 切れていること、あちらは入っていて何も記録していないこと。
            notVersioned: "バージョン管理なし",
            enable: "バージョン管理を有効にする",
            // 1 行。有効にすると作者のプロジェクトフォルダに書き込み、そこに排他ロックを取るので、
            // 押す前に何をするかを言う。
            enableHint: "このプロジェクトのフォルダの中にバージョン履歴を持つ",
            enabling: "バージョン管理を用意している…",
            // 存在するが何も入っていないリポジトリ。上の `notVersioned` とは別物で、書き分けている。
            noHistory: "履歴が空",
            history: "履歴",
            loadingHistory: "バージョン履歴を読んでいる…",
            // 一覧の末尾。プロジェクトの先頭ではなく上限で読み取りが止まったとき。取り方ではなく、
            // 作者が何を得るかを言う。
            loadMoreHistory: "古いバージョンを表示",
            // リモートのあるプロジェクトでリビジョンを初めて読むときはネットワークを通るので、
            // これは体裁のスピナーではなく本当の待ち時間。
            loadingRevision: "そのバージョンを開いている…",
            showVersion: "このバージョンをエディタで表示",
            // 親が 2 つ以上あるリビジョン。展開せず印を付ける。レールは 1 本の並びで、
            // 印の無いマージはその並びを嘘にする。
            merge: "マージ",
            changes: "変更",
            refreshChanges: "変更を調べる",
            // バージョンを記録するボタン。「コミット」ではなく「記録」に寄せる。ここのほかの行は
            // すべてバージョンの語で話しており、バージョン管理を使ったことのない作者に
            // その語を知る理由はない。
            commit: "バージョンを記録",
            // 命令ではなく問いで、「任意」と書いてある。実際そのとおりで、メッセージが空でも
            // 正当なリビジョンになり、メッセージの無いものは上の一覧で自分の名を名乗る。
            commitPlaceholder: "何が変わったか（任意）",
            commitMessage: "バージョンのメッセージ",
            authorLabel: "これらのバージョンを誰の名前で記録するか",
            authorPlaceholder: "あなたの名前",
            authorSave: "この名前を保存",
            // 一瞬では終わらない。このウィンドウの未保存の作業を落ち着かせ、プロジェクト全体を
            // 対象に取り、バックエンドが自分のストアをディスクに置くのを待つ。
            committing: "このバージョンを記録している…",
            // 「まだ誰も見ていない」であって「変更なし」ではない。その違いは重要で、見ることは
            // 走査であり、この画面は自分から走査しない。
            nothingToCommit: "前のバージョンから変更はありません",
            closingWithApp: "Studio を終了しています。再起動後にもう一度お試しください",
            changesUnknown: "未確認",
            noChanges: "変更なし",
            changesCount: "{count} 件が変化",
            // ファイルごとの一覧。どの行も表示だけ。
            //
            // 各行の印が意味するもの。バックエンドには「変更」という動作が無く、編集されたファイルは
            // KEEP として報告される（docs §4.18）ので、この 5 つは Studio の語彙で、
            // 作者がバックエンドの語彙を見ることはない。
            changeKind: {
                added: "追加",
                modified: "変更",
                deleted: "削除",
                moved: "移動",
                copied: "複製",
            },
            // 移動や複製の元。`{path}` は行そのものと同じくリポジトリからの相対パス。
            changeFromPath: "{path} から",
            // バージョンの記録を止める唯一の変更。だから名指しし、パスの順ではなく一覧の先頭に並べる。
            changeConflict: "未解決の衝突",
            // 一覧には上限がある。黙って 50 件で止まった一覧は「これで全部」と読まれ、作者は
            // 記録しようとしているものをすべて見たつもりでバージョンを記録してしまう。
            changesMore: "ほかに {count} 件（未表示）",
            // チェックポイントは Studio が時間で記録したもの。書いている日には何十件も並ぶ。
            command: {
                openRail: "バージョン管理を開く",
                commit: "バージョンを提出",
                refreshChanges: "変更を確認",
                compareChanges: "前のバージョンと変更を比較",
            },
            filterPlaceholder: "名前または番号でバージョンを探す",
            filterNoMatch: "読み込んだ {count} 件のバージョンに一致はありません",
            today: "今日",
            yesterday: "昨日",
            compareBase: {
                set: "他のバージョンをこのバージョンと比較する",
                clear: "このバージョンとの比較をやめる",
                current: "{version} と比較中",
                compare: "{version} と比較",
            },
            showCheckpoints: "チェックポイント {count} 件を表示",
            hideCheckpoints: "チェックポイントを隠す",
            systemMessage: {
                unnamed: "名前のないバージョン",
                enabled: "バージョン管理を有効にしました",
                created: "プロジェクトを作成しました",
                merge: "マージ",
                checkpoint: "チェックポイント",
                checkpointClose: "プロジェクトを閉じる前のチェックポイント",
                checkpointBuild: "ビルド前のチェックポイント",
                checkpointRestore: "復元前のチェックポイント",
                restored: "{version} に戻しました",
            },
            // バージョン管理は必須ではない。macOS Intel と Windows ARM64 向けのネイティブの実装が
            // 無いので、この 2 つは別のことを言う。作者が手を打てるのは一方だけだから。
            // どちらも無効化されたコントロールとしては描かない。それらの端末では最初から
            // 同梱していないので、灰色のレールは壊れていないものを壊れていると報告することになる。
            unavailable: {
                platform: "この端末ではバージョン管理を使えない",
                installation: "この Studio ではバージョン管理を使えない",
            },
            // レールのサーバーの節。「リモート」ではなく「サーバー」。バージョン管理を使ったことの
            // ない作者もサーバーなら分かるが、「リモート」はその仕組みを知っていて初めて意味を持つ。
            server: {
                title: "サーバー",
                // サーバーにつながっていないプロジェクト。誰かがそうしない限り、どのプロジェクトもこれ。
                // 1 行と 1 つのボタン。つなぐのは既定ではなく判断だから。
                none: "サーバーにつながっていない",
                connect: "サーバーにつなぐ",
                picker: {
                    title: "サーバーに接続",
                    nameLabel: "サーバー上での名前",
                    namePlaceholder: "my-game",
                    empty: "サーバーはまだ追加されていない。設定で追加するか、下にアドレスを入力する",
                    manual: "別のアドレス",
                    manage: "サーバーを管理",
                },
                // 入力欄は 1 つだけ。バックエンドは渡された URL の **オリジン** だけを保ち、
                // リポジトリは自身の id で見分けるので、ほかに打つものが本当に無い。
                addressLabel: "サーバーのアドレス",
                addressPlaceholder: "lore://studio.example.lan:41337",
                save: "つなぐ",
                cancel: "キャンセル",
                disconnect: "切断",
                // サーバーに届くまで最大 2 秒かかるので、自動では行わない。パネルは「未確認」で開き、
                // これがその確認を頼む。
                check: "サーバーを確認",
                checking: "サーバーを確認している…",
                notChecked: "未確認",
                // サーバーが応答し、このブランチと一致している。
                upToDate: "最新",
                // ファイルではなくバージョンの数で数える。作者が記録するのはバージョンで、
                // 送るべきかどうかを教えるのは、そのうち何本がこの端末を出ていないかの数。
                localAhead: "手元のバージョンがサーバーに無い",
                remoteAhead: "サーバーに、この端末に無いバージョンがある",
                // 両方が進んだ状態。送信はこの状態では断り、そう言う。取得はまずマージする。
                diverged: "手元とサーバーの両方でバージョンが進んでいる",
                unreachable: "このサーバーに届かない",
                // サーバーは応答したが、こちらを受け入れなかった。資格情報の入力欄が出る唯一の状態。
                unauthorized: "このサーバーはアクセスを拒否した",
                push: "サーバーへ送る",
                pushing: "サーバーへ送っている…",
                // 「すでにある」は成功。これを 2 回押すのはごく普通のこと。
                pushedAlready: "サーバーはすでにこれらのバージョンを持っている",
                sync: "サーバーから取得",
                syncing: "サーバーからバージョンを取得している…",
                syncedNothing: "すでに最新",
                signIn: {
                    required: "このサーバーはプロジェクトを接続する前にログインを求める。",
                    open: "このサーバーにサインイン",
                    signedInAs: "{name} としてサインイン中",
                    signOut: "サインアウト",
                    addressLabel: "サインインアドレス",
                    addressPlaceholder: "https://studio.example.lan:41402",
                    tokenLabel: "アクセストークン",
                    tokenPlaceholder: "受け取ったトークンを貼り付けてください",
                    hint: "トークンはサーバーの管理者が発行して渡します。",
                    trust: {
                        open: "このコンピューターでこのサーバーを信頼する",
                        title: "このサーバーを信頼しますか",
                        vouched: "貼り付けたトークンはこの認証局を指しており、そのアドレスで応答しているのもこの認証局です。",
                        compare: "この接続とは別の手段で、サーバーの管理者から伝えられた指紋と照合してください。",
                        authorityLabel: "発行元",
                        fingerprintLabel: "指紋",
                        meaning: "この認証局の鍵を持つものは、どのアドレスに対しても証明書を発行でき、このアカウントはそれを信じます。影響を受けるのはこのコンピューターのこのアカウントだけです。",
                        manual: "このシステムにはアカウントごとの信頼ストアがないため、Studio では実行できません。次を実行してから、もう一度サインインしてください。",
                        copy: "コマンドをコピー",
                        confirm: "信頼する",
                        cancel: "キャンセル",
                    },
                    submit: "サインイン",
                    cancel: "キャンセル",
                    reach: {
                        ready: "このサーバーとこの Studio は一緒に動作できます。",
                        notPermitted: "サインインしましたが、このアカウントにはこのプロジェクトが割り当てられていません。サーバーの管理者に権限を依頼してください。",
                        dataPortSilent: "サインインしましたが、サーバー本体が応答しませんでした。",
                    },
                    problem: {
                        scheme: "サインインアドレスは https:// または ucs-auth:// で始まる必要があります。",
                        token: "これはこのサーバーが発行したトークンではありません。受け取ったトークン全体を貼り付けてください。",
                        address: "このトークンにはサインイン先が書かれていないため、アドレスも必要です。",
                        certificate:
                            "このコンピューターは、このサーバーが署名に使う認証局を信頼するよう設定されていません。"
                            + "その指紋は {fingerprint} です。",
                        mismatch:
                            "そのアドレスのサーバーは、このトークンの相手ではありません。トークンは {expected} を指していますが、"
                            + "応答したのは {found} です。信頼せず、サーバーの管理者に確認してください。",
                        unreachable: "そのアドレスからは応答がありませんでした（{detail}）。",
                        refused: "サーバーはそのトークンを受け付けませんでした（{detail}）。",
                        unknown: "サインインを完了できませんでした（{detail}）。",
                    },
                },
            },
            // マージが片付かなかった取得。居座る形にしてあるのは、取得が抜けるときにバージョンの
            // 表示から離れ、その変化でレールが読み直され、誰かが読む前に行内のエラーが消えるから。
            //
            // 何が起きたかより、作者が次にどこへ行くかを名指しする。取得はわざとそこへ連れて行かない。
            // 報告して止まるという姿勢は、勝手にリポジトリを作らないのと同じ規律。
            syncConflictTitle: "マージできなかったファイルがある",
            // 「ファイル（複数可）」とはせず 2 通り用意する。docs/help-system.md §3 に従う。
            syncConflictDetailOne:
                "1 つのファイルが、こちらとサーバーの両方で変わっている：\n"
                + "{files}\n"
                + "残りの変更はマージした。どちらを残すかはバージョンのパネルで選ぶ",
            syncConflictDetailMany:
                "{count} 個のファイルが、こちらとサーバーの両方で変わっている：\n"
                + "{files}\n"
                + "残りの変更はマージした。どちらを残すかはバージョンのパネルで選ぶ",
            // 進行中のマージ。レールに出る。あることはめったに無いが、あるときはパネルで最も重要。
            mergeOpen: "マージが進行中",
            mergeConflicts: {
                other: "{count} 個のファイルでどちらを残すか決める必要がある",
            },
            // 自動マージがすべて片付けた。あとは記録するだけ。
            mergeNoConflicts: "すべて自動でマージできた。バージョンを記録すると終わる",
            mergeResolve: "マージを完了する",
        },
        // キーボードショートカットの変更（設定ウィンドウ → エディタ）と「?」の一覧。
        keybindings: {
            searchPlaceholder: "ショートカットを検索…",
            hint: "ショートカットをクリックすると新しいキーを記録する。Esc で取り消し",
            record: "ショートカットを記録",
            recording: "新しいショートカットを押す…",
            reset: "既定に戻す",
            resetAll: "すべて既定に戻す",
            customized: "変更済み",
            conflict: "{name} にも割り当て済み",
            empty: "一致するショートカットがない",
            openSettings: "キーボードショートカットを変更",
            cheatSheetTitle: "キーボードショートカット",
            cheatSheetCustomize: "変更…",
            // 設定の表と一覧の見出し（静的なカタログから来る）。
            categories: {
                general: "一般",
                story: "ストーリーエディタ",
                uiEditor: "UI エディタ",
                blueprint: "ブループリントエディタ",
                storyMotion: "ストーリーモーション",
                assets: "アセット",
                other: "その他",
            },
            // 自分の i18n キーを持たなかったカタログの項目の名前。
            catalog: {
                commandPalette: "コマンドを表示して実行",
                quickOpen: "クイックオープン",
                cheatSheet: "キーボードショートカットを表示",
                contextHelp: "フォーカスされているもののヘルプ",
                reopenClosedTab: "閉じたタブを開き直す",
                undo: "元に戻す",
                redo: "やり直す",
                quickSwitchNext: "次のエディタのタブへ",
                quickSwitchPrevious: "前のエディタのタブへ",
                uiEditor: {
                    undo: "元に戻す",
                    redo: "やり直す",
                    copy: "コピー",
                    cut: "切り取り",
                    paste: "貼り付け",
                    duplicate: "複製",
                    group: "グループにする",
                    ungroup: "グループを解除",
                    selectAll: "すべて選択",
                    delete: "選択を削除",
                    rename: "名前を変更",
                    escape: "メニューを閉じる／編集を抜ける",
                    alignLeft: "左揃え",
                    alignHorizontalCenter: "左右中央",
                    alignRight: "右揃え",
                    alignTop: "上揃え",
                    alignVerticalCenter: "上下中央",
                    alignBottom: "下揃え",
                    distributeHorizontal: "左右に均等配置",
                    distributeVertical: "上下に均等配置",
                },
                blueprint: {
                    undo: "元に戻す",
                    redo: "やり直す",
                    copy: "ノードをコピー",
                    cut: "ノードを切り取り",
                    paste: "ノードを貼り付け",
                },
                storyMotion: {
                    undo: "元に戻す",
                    redo: "やり直す",
                    delete: "キーフレームを削除",
                    prevFrame: "再生位置を 1 フレーム戻す",
                    nextFrame: "再生位置を 1 フレーム進める",
                    prevFrames: "再生位置を 10 フレーム戻す",
                    nextFrames: "再生位置を 10 フレーム進める",
                    playheadStart: "再生位置を先頭へ",
                    playheadEnd: "再生位置を末尾へ",
                },
            },
        },
        // プロジェクト全体の検索。ドックのパネルとパレットの検索モードで共通。
        search: {
            placeholder: "プロジェクトを検索…",
            // タイトルバーの検索ピルのラベル（押すとパレットが検索モードで開く）。
            titleBarPlaceholder: "{name} 内を検索",
            building: "検索の索引を作っている…",
            // 何も打つ前に出る。
            idle: "シーン、キャラクター、ストーリーの文、アセット、ブループリントを検索する",
            empty: "結果なし",
            more: "ほか {count} 件",
            // 絞り込みの条件。シーン内の検索バーと共通で、同じ問いが同じ意味になる。
            caseSensitive: "大文字小文字を区別",
            wholeWord: "単語全体に一致",
            regex: "正規表現を使う",
            invalidPattern: "パターンが不正",
            // プロジェクト全体のストーリー文の置換。ボタンの末尾の数は出現数で、
            // 行数でも、表示できている件数でもない。
            toggleReplace: "置換",
            replacePlaceholder: "置換後",
            replaceAll: "すべて置換",
            replaceRow: "この行を置換",
            // 計画がプロジェクトに合わなくなった。書き換えるはずだったものが、その後に削除されたか
            // 変わっている。置換は全部通すか何もしないかなので、残りを書かずに断る。
            replaceStale: "プロジェクトが変わった。検索し直す",
            // 実体の群を先に出す。この欄はまず「X というものを開く」に答え、
            // 次に「X と書かれた行を探す」に答える。
            groups: {
                scene: "シーン",
                story: "ストーリー",
                character: "キャラクター",
                uiSurface: "UI サーフェス",
                blueprint: "ブループリント",
                asset: "アセット",
                storyText: "ストーリーの文",
                variable: "変数",
                uiTextKey: "UI のテキストキー",
                blueprintNode: "ブループリントのノード",
            },
            // 同じ結果をまとめている行の末尾に付くバッジ。
            occurrences: "×{count}",
        },
        // タイトルバーのプロジェクト切り替え。現在のプロジェクト名と、最近のワークスペースの一覧。
        // ここで選んだプロジェクトはこのウィンドウでも新しいウィンドウでも開ける。
        // だからラベルは「切り替え」ではなく「開く」と言い、どちらかは `openTarget` で決める。
        projectSwitcher: {
            openAnother: "別のプロジェクトを開く",
            recentProjects: "最近のプロジェクト",
            current: "現在",
            openProject: "プロジェクトを開く…",
            newProject: "新規プロジェクト…",
            noRecent: "最近のワークスペースがない",
            untitled: "無題のプロジェクト",
            // プロジェクトを選んだあと、開く前に聞く。選んだプロジェクトの名前は本文が出すので、
            // この行は画面にあるプロジェクトがどうなるかを言う。ボタンには書けない部分。
            openTarget: {
                title: "プロジェクトを開く",
                detail: "このウィンドウで開くと「{current}」は閉じる。未保存の変更は自動で保存される",
                thisWindow: "このウィンドウで開く",
                newWindow: "新規ウィンドウで開く",
            },
        },
        // `workspace.confirmBeforeClose` が有効なとき、ワークスペースを閉じる前に出るアプリ内の確認。
        closeConfirm: {
            message: "このワークスペースを閉じるか",
            detail: "未保存の変更は自動で保存される",
        },
        // 閉じている間にワークスペースが言うこと。メインプロセスが走らせる各段階に 1 行ずつ。
        closing: {
            title: "ワークスペースを閉じている",
            saving: "変更を保存している…",
            checkpoint: "プロジェクトのバージョンを記録している…",
            launcher: "ランチャーに戻っている…",
        },
        // 開くときの同じもの。描画側が走らせる各段階に 1 行ずつ。内部で何をしているかではなく、
        // ウィンドウが何を待っているかを言う。
        opening: {
            title: "ワークスペースを開いている",
            preparing: "プロジェクトを開いている…",
            services: "プロジェクトの中身を読み込んでいる…",
            interface: "エディタを用意している…",
        },
    },
} satisfies LocaleNamespace<"workspace">;
