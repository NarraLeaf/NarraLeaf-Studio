import type { LocaleNamespace } from "../types";

/**
 * `assets` 日本語。アセットのブラウザと管理。検索、絞り込み、一覧とグリッド、
 * コンテキストメニュー、読み込み、画像と音声のプレビュー、各種ダイアログ。
 */
export const assets = {
    loading: "アセットを読み込んでいる…",
    loadError: "アセットを読み込めなかった",
    searchPlaceholder: "アセットを検索…",
    searchTooltip: "アセットを検索",
    closeSearch: "検索を閉じる",
    clearSearch: "検索を消去",
    backToParent: "親のグループに戻る",
    importRemote: "リモートから読み込む",
    noTags: "タグなし",
    preview: "プレビュー",
    unknownError: "原因不明のエラー",
    // これらの削除が履歴に残す名前（「bg_room.png の削除を元に戻す」）。
    history: {
        deleteAsset: "{name} の削除",
        deleteGroup: "フォルダ {name} の削除",
    },
    delete: {
        inUseTitle: "これらのアセットはまだ使われている",
        inUseMessage: "削除すると、次の場所が参照先を失う：",
        moreReferences: "…ほか {count} 件",
        unverifiedTitle: "これらのアセットの使用状況を調べられない",
        unverifiedMessage:
            "参照の索引を読めなかったので、どこで使われているか分からない。それでも削除するか",
        confirmTitle: {
            other: "{count} 件を削除するか",
        },
        confirmMessage: "選んだグループの中身もすべて削除される",
        /** 参照の警告に出る削除ボタン。危険色にし、キーボードの既定にはしない。 */
        action: "削除",
        /** 作者が確認した後にサービスが拒んだ削除。 */
        failedTitle: "削除できなかった",
        /**
         * 行ごとではなく全体として倒れた削除。読むべき一覧が無く、この 1 行が答えのすべて。
         * 行ごとの拒否は上の `failedTitle` に出る。
         */
        failed: "削除できなかった：{error}",
    },
    /**
     * 1 行の名前を変える。行の名前を言って終える。理由を書かないのは下の `createGroup.failed` と
     * 同じで、名前の変更が拒まれるのは書き込みに失敗したときだけ。そのときはワークスペース自身の
     * 保存失敗が、ファイル名と再試行を添えてすでに画面に出ている。
     *
     * 言うべきは古い名前のほう。書き込みに失敗すると記録は元に戻るので、行に出ているのはその名前で、
     * 作者が探せるのもその名前。
     */
    rename: {
        failed: "{name} の名前を変えられなかった",
    },
    /**
     * 残らなかった新しいグループ。名前どうしの重複は見ていないので、ここに来る道は
     * グループの一覧がディスクに届かなかった場合だけ。
     *
     * 理由をわざと書かない。その書き込みはワークスペース自身の保存失敗も起こし、そちらが
     * ファイル名と再試行を添えてすでに出ている。同じ文を 2 つ目のトーストで繰り返しても
     * 同じことを二度言うだけ。そちらが言えないのは、どの操作が失われたか。行はどちらにせよ
     * 描かれるので、目の前のグループが本物ではないと作者に伝えられるのはここだけ。
     */
    createGroup: {
        failed: "グループを作成できなかった",
    },
    /**
     * すべてを運びきれなかった貼り付け。トーストで件数を数えず、アラートで行ごとに名指しする。
     * 作者が必要としているのは、どの行が欠けたかそのものだから。
     */
    paste: {
        failedTitle: "何も貼り付けられなかった",
        someFailedTitle: "貼り付けられなかった項目がある",
    },
    /**
     * アセットの記録の背後にあるファイルを差し替える。記録は id を保つのですべての参照はついてくる。
     * ここのどの文も、作者が繋ぎ直す必要があるかのように読ませてはならない。
     */
    replace: {
        confirmTitle: "{name} の中身を差し替えるか",
        confirmAction: "差し替える",
        failedTitle: "アセットの中身を差し替えられなかった",
        remoteUnsupported: "リモートアセットには差し替える手元のファイルがない",
    },
    /** 種類ごとのラベル。`AssetType` の値をキーにする。1 つの種類を名指しする場所で使う。 */
    types: {
        image: "画像",
        audio: "音声",
        video: "動画",
        json: "JSON ファイル",
        blueprint: "ブループリント",
        font: "フォント",
        model: "モデル",
        other: "その他",
    },
    /** サイドバーの区分名。`AssetCategory` の値をキーにする。 */
    categories: {
        image: "画像",
        media: "メディア",
        data: "データ",
        font: "フォント",
        model: "モデル",
        other: "その他",
    },
    itemCount: {
        other: "{count} 件",
    },
    /**
     * 読み取り専用のアセット概要ページ。「実際」と「切り詰めた場合」は要となる語。ビルドは
     * いまも assets ディレクトリ全体をパッケージしていて、このページは何も変えない。だから
     * ここのどの文も、参照に基づく切り詰めが効いているかのように、あるいは 2 つ目の数字が
     * 次のビルドの予告であるかのように読めてはならない。
     */
    overview: {
        loading: "アセットライブラリを読んでいる…",
        failed: "アセットライブラリを読めなかった",
        retry: "再試行",
        section: {
            library: "ライブラリ",
            packaging: "パッケージ",
            // サイドバーが描くのと同じ 6 区分にし、パネルの左右で数が合うようにする。
            byCategory: "区分ごと",
            largest: "大きいもの",
            unreferenced: "参照なし",
        },
        stat: {
            total: "合計",
            referenced: "参照あり",
            unreferenced: "参照なし",
            actual: "実際",
            ifTrimmed: "切り詰めた場合",
            difference: "差",
        },
        files: {
            other: "{count} ファイル",
        },
        uses: {
            other: "{count} 箇所で使用",
        },
        detail: {
            // このエディタが自分の保管のために作った 2 つのアドレスの見出し。文ではなく名詞にする。
            // その下の行はハッシュとパスで、見出し以外に説明は付かない。
            storage: "保管",
            path: "パス",
        },
    },
    view: {
        list: "リスト表示",
        icons: "アイコン表示",
        overview: "概要",
    },
    filter: {
        label: "絞り込み",
        // 絞り込みの群の見出し。「区分」はアセットの種類（画像、音声）、「形式」はファイルの拡張子。
        // 別の問いなのに、どちらも以前は「種類」と読めていた。
        category: "区分",
        usage: "使用状況",
        size: "大きさ",
        tags: "タグ",
        format: "形式",
    },
    actions: {
        copyTooltip: "選んだアセットまたはグループをコピー",
        cutTooltip: "選んだアセットまたはグループを切り取り",
        pasteTooltip: "アセットまたはグループを貼り付け",
        deleteTooltip: "選んだアセットまたはグループを削除",
    },
    list: {
        emptyFiltered: "現在の絞り込みに一致するアセットがない",
    },
    iconView: {
        updating: "更新している…",
        assetCount: {
            other: "アセット {count} 件",
        },
        tagCount: {
            other: "+タグ {count} 件",
        },
    },
    import: {
        unableTitle: "読み込めない",
        failedTitle: "アセットを読み込めなかった",
        someFailedTitle: "読み込めなかったアセットがある",
        moveFailedTitle: "読み込んだアセットを移動できなかった",
        fileAccessFailed: "ファイルへのアクセス許可を取れなかった",
        filePathParsingFailed: "ファイルパスを解釈できなかった",
        noMatchingFiles: "ドロップされたフォルダに該当するファイルがなかった",
        moreFailures: "…ほか {count} 件",
        /** 読み込みの帯に出る失敗の一覧。読めなかったファイルを再試行のために残す。 */
        failedCount: {
            other: "{count} ファイルが失敗",
        },
        retry: "再試行",
        remoteTitle: "リモートのアセットを読み込む",
        // 「リンクする」ではなく「いまダウンロードする」。手に入るアセットはオフラインでも動き、
        // プロジェクトと一緒に配布される。そう書かないと、どこか別の場所への参照に読める。
        remoteDescription: "直接のリンクを貼る。ファイルはいまダウンロードされ、プロジェクトと一緒に保たれる",
        remoteInvalidUrl: "有効な URL を入力してください",
        remoteUnsupportedScheme: "読み込めるのは http と https のリンクだけ",
        remoteFailedTitle: "リモートのアセットを読み込めなかった",
    },
    /**
     * 再生できないファイルをプロジェクトへ複製する前に、作者に尋ねる内容。
     *
     * ここの語彙の決まりは他より厳しい。このダイアログが知っていることはすべて内部の事情だから。
     * コンテナ、コーデック、デマルチプレクサ、ストリームの表。**そのどれも出してはならない。**
     * 作者は再生側のデコーダの構成を選んでおらず、変えることもできないので、その一部でも名指しすると、
     * 手の打てる文がただの豆知識になる。以下の文はすべて、作者が何を得るかを言う。
     *
     * 要となる語が 2 つあり、翻訳しても残さなければならない。「変換」は *新しい* ファイルを作ることだと
     * 読ませる必要があり、`intro` の 1 文だけが「手元のファイルを書き換える」という読みを止めている。
     * そして品質が落ちるという 1 行は、脚注ではなく群の見出しに置く。ボタンより先に読まれる場所だから。
     */
    mediaConvert: {
        title: "変換が要るファイルがある",
        /** 一覧のどれも変換できないとき、変換を持ちかけるのは嘘になる。 */
        titleRefusedOnly: "読み込めないファイルがある",
        intro: "変換すると、新しいファイルがプロジェクトに書き込まれる。元のファイルは変わらない",
        convertingTitle: "変換している",
        convertingIntro: "終わったものから読み込まれる",
        group: {
            lossless: "変換できる",
            losslessHint: "映像と音はそのまま",
            lossy: "変換できるが、品質が少し落ちる",
            lossyHint: "映像と音を再エンコードする。時間がかかり、品質が少し落ちる",
            refused: "読み込めない",
        },
        /** 行の副題。作者の手元に最終的に残るもの。 */
        becomes: ".{ext} になる",
        refusal: {
            notMedia: "音声でも動画でもないファイル",
            noStreams: "音も映像も入っていない",
        },
        state: {
            waiting: "待機中",
            done: "完了",
            failed: "変換できなかった",
            stopped: "中止",
            unavailable: "この端末に変換器がない",
        },
        convertAction: "変換して読み込む",
        skipAction: "これらを読み込まない",
        importAnywayAction: "変換せずに読み込む",
        stopAction: "変換を中止",
        /** 後からパネルの失敗一覧に名前が出るので、ファイルが黙って消えることはない。 */
        failedError: "このファイルは変換できなかった",
    },
    /**
     * **すでにライブラリにある** アセットが再生できないという印と、その変換。
     *
     * 上の `mediaConvert` とは別で、あちらは読み込み時のやり取り。違いは見た目の問題ではない。
     * 読み込みは「そのファイルを入れない」と持ちかけられるが、こちらはできない。ファイルは
     * すでにプロジェクトにあり、何かがそれを指しているかもしれない。だからここの文はすべて、
     * 何を持ち込むかではなく、そこにあるものをどう変えるかの話になる。
     *
     * 2 つの状態で言い回しを共有しない。`needsConverting` には打てる手があるので指示として読ませ、
     * `notPlayable` には何も無いので、そちらの作者に変換を勧めれば従えない助言になる。
     */
    support: {
        needsConverting: "変換が必要",
        needsConvertingHint: "このファイルはゲームで再生されない。変換すると再生できるようになる",
        /**
         * 同じ印を、URL に紐づいたアセットに付けた場合。こちらの裏にボタンは無い。
         *
         * 変換を持ちかけないのは、機能が足りないからではない。リモートアセットのバイト列は
         * その URL が返すものの写しで、書き換えると、来ていない場所から来たと記録が言うことになる。
         * だから通る指示は 1 つしかない。ファイルとして持ち込むこと。新しい読み込みはここへ来る前に
         * 断られるので、この文はすでにプロジェクトの中にあるもの向け。
         */
        needsConvertingRemoteHint:
            "このファイルはゲームで再生されず、リンクとして保っているファイルは変換できない。"
            + "Studio の外で変換し、その結果をファイルとして追加する",
        notPlayable: "再生されない",
        notPlayableHint: "このファイルには音声も映像も入っていないので、変換するものがない",
        menuConvert: "ファイルを変換…",
        convertTitle: "ファイルを変換",
        /** 何が変わるかを言う。入れ替えてもアセットとそれを指すものは残るから。 */
        convertIntro: "変換したファイルがこれを置き換え、これを指す参照はすべて更新される",
        convertAction: "変換",
        /** 変換が終わってから、ライブラリが新しいバイト列を持つまでの間。 */
        replacing: "ファイルを置き換えている",
    },
    /**
     * モデルバンドルの案内つき読み込み。作者がファイルではなく *フォルダ* を持っている唯一の
     * アセット種別で、複製する前に Studio が中身を確かめられる唯一の種別でもある。
     *
     * ここの文が取り違えてはならないことが 2 つ。最初の段階で選ぶ種類が決めるのは、どのマニフェストを
     * 探すかだけ。このダイアログのどの動作もランタイムを入れず、呼び出さず、必要ともしない。
     * そして検査は **ファイルがそろっているか** の話で、モデルの出来の話ではない。ここのどの文も、
     * Studio がモデルを検証したかのように読めてはならない。
     */
    modelImport: {
        title: "モデルを読み込む",
        familyStep: "どの種類のモデルか",
        /** 作者が引っかかると身構えるのがランタイムの導入なので、先に言っておく。 */
        familyNoRuntime: "ここではランタイムを入れない。描画ランタイムはキャラクター側で指定する",
        family: {
            live2d: "Live2D Cubism",
            live2dHint: ".model3.json、または Cubism 2 の model.json を含むフォルダ",
            spine: "Spine",
            spineHint: ".skel か .json のスケルトンを .atlas と並べて含むフォルダ",
        },
        folderStep: "フォルダを選ぶ",
        folderHint: "モデル 1 体分のフォルダでも、複数をまとめたフォルダでもよい。フォルダ全体を探す",
        chooseFolder: "フォルダを選ぶ…",
        changeFolder: "変更…",
        rescan: "もう一度調べる",
        scanning: "調べている…",
        foundCount: {
            other: "モデル {count} 体が見つかった",
        },
        noneFound: "このフォルダに {family} のモデルがない",
        noneFoundHint: "上で選んだ種類を確かめ、次にフォルダを確かめる。書き出し側が作ったフォルダである必要がある",
        entry: "エントリ",
        /** 行の副題。複製する前に、そのフォルダが何を持っているか。 */
        fileSummary: "{count} ファイル · {size}",
        selectAll: "すべて選択",
        selectNone: "選択を解除",
        importAction: "読み込む",
        importCount: {
            other: "モデル {count} 体を読み込む",
        },
        /** 行が最初から外れている理由と、それでもチェックしてよいこと。 */
        blockedHint: "ファイルの欠けたモデルは最初から外してある。チェックすればそのまま読み込む",
        problemCount: {
            other: "問題 {count} 件",
        },
        problem: {
            missing: "{role}がない：{path}",
            unusableReference: "{role}の「{raw}」はこのフォルダの外にあり、一緒には複製されない",
            manifestUnreadable: "{path} を読めなかった",
            atlasMissing: "スケルトンの隣にアトラスがない。{path} を想定していた",
            atlasEmpty: "{path} が画像を 1 つも指していない",
            nestedModel: "別のモデル {path} を含んでおり、このフォルダはそれも連れてくる",
        },
        /** 欠けているファイルの呼び方。文の途中で読まれる。 */
        role: {
            moc: "モデルファイル",
            texture: "テクスチャ",
            physics: "物理演算のファイル",
            pose: "ポーズのファイル",
            displayInfo: "表示情報のファイル",
            userData: "ユーザーデータのファイル",
            expression: "表情",
            motion: "モーション",
            sound: "音声",
            skeleton: "スケルトン",
            atlas: "アトラス",
            page: "ページ画像",
        },
        failedTitle: "そのフォルダを調べられなかった",
        unreadable: "そのフォルダを読めなかった",
        /** 途中で打ち切らず断る。中途半端な一覧は、あるファイルを「無い」と報告してしまう。 */
        tooManyFiles: "そのフォルダには {count} 個のファイルがあり、多すぎて調べられない。モデルが入っているフォルダを選ぶ",
    },
    /**
     * アセットセット：軸で索引される一群のファイルを表す、ライブラリ上の 1 つの項目。
     *
     * 「グループ」ではなく「セット」と呼ぶ。このパネルのグループはすでにフォルダーを指すため。
     * ここの語は作者がこれに対して行うこと（軸の宣言、どのバリアントが解決するかの確認）を言い、
     * ビルドがどう読むかは言わない。
     */
    sets: {
        itemType: "セット",
        variantCount: {
            one: "バリアント {count} 件",
            other: "バリアント {count} 件",
        },
        variantsResolved: "バリアント {total} 件中 {resolved} 件",
        unfinished: "バリアント未宣言",
        menu: {
            create: "選択したファイルからセットを作成",
        },
        create: {
            title: "アセットセットの新規作成",
            nameRequired: "名前を入力",
            failed: "1 つのセットが持つのは 1 種類のアセット。同じ種類のファイルを選択。",
        },
        inspector: {
            axes: "軸",
            filter: "メンバー共通のタグ",
            addAxis: "軸を追加",
            removeAxis: "軸を削除",
            moveOut: "外側へ",
            moveIn: "内側へ",
            axisKey: "タグ分類",
            axisValues: "値",
            residency: {
                label: "解決の時点",
                build: "ビルド時",
                runtime: "実行時",
            },
            residencyBlocked: "ビルド時に解決する軸は、実行時に解決する軸の内側に置けない。",
            variants: "バリアント",
            variantMissing: "ファイルなし",
            variantAmbiguous: "ファイル {count} 件",
            noVariants: "軸を宣言するとバリアントが解決される。",
        },
        history: {
            edit: "アセットセットの編集",
            add: "セット {name} を追加",
            rename: "セット {name} の名前を変更",
            delete: "セット {name} を削除",
        },
    },
    menu: {
        newGroup: "新規グループ",
        newSubGroup: "新規サブグループ",
        /** その他だけ。作者が読み込むのではなく作れる唯一のアセット。 */
        newTextFile: "新規テキストファイル",
        importAssets: "アセットを読み込む…",
        replaceContent: "ファイルを差し替え…",
        copyCount: {
            other: "{count} 件をコピー",
        },
        cutCount: {
            other: "{count} 件を切り取り",
        },
        deleteCount: {
            other: "{count} 件を削除",
        },
        export: "書き出す…",
        exportCount: {
            other: "{count} 件を書き出す…",
        },
    },
    export: {
        /** 中身の無いフォルダ。コマンドは働き、複製するものが無かっただけ。 */
        empty: "書き出すファイルがない",
        success: {
            other: "{count} ファイルを書き出した",
        },
        partial: "{exported} ファイルを書き出し、{failed} ファイルは書き出せなかった",
        partialTitle: "書き出せなかったファイルがある",
        failed: "書き出しに失敗：{error}",
    },
    selector: {
        selectType: "{type} を選択",
        importFromDisk: "ディスクから読み込む",
        noAssets: "現在の絞り込みに一致するアセットがない",
        selectedCount: "{count} 件を選択中",
        choose: "決定",
    },
    cropper: {
        title: "画像を切り抜く",
        reload: "読み込み直す",
        loadError: "画像を読み込めない",
        selection: "選択範囲：{width}x{height}",
        waiting: "選択を待っている…",
    },
    magicTag: {
        title: "タグを作る",
        detectedDelimiters: "見つかった区切り",
        regexPattern: "正規表現のパターン",
        captureGroups: "キャプチャグループ：{groups}",
        categoryMapping: "タグの区分の割り当て",
        exampleFilename: "ファイル名の例：{filename}",
        categoryPlaceholder: "タグの区分（例：char、emo）",
        moreFiles: "…ほか {count} ファイル",
        summary: "{files} ファイルに合計 {tags} 個のタグを付ける",
        applying: "適用している…",
        applyTags: "タグを適用",
        parseFailedTitle: "マジックタグの解析に失敗",
        applyFailedTitle: "タグの適用に失敗",
    },
    audio: {
        play: "再生",
        pause: "一時停止",
        mute: "消音",
        unmute: "消音を解除",
        analyzing: "波形を解析している…",
        seek: "シーク",
        volume: "音量",
        playback: "再生",
        loading: "音声を読み込んでいる…",
        loadError: "音声を読み込めなかった",
        channelCount: {
            other: "{count} チャンネル",
        },
        // プレビューの再生と表示の操作。ここのどれも音声ファイルに触れない。書き戻されるのは
        // マーカーだけで、それもアセットの記録に入る。
        editor: {
            toStart: "先頭へ",
            loop: "ループ",
            zoomIn: "拡大",
            zoomOut: "縮小",
            zoomFit: "クリップ全体を表示",
            zoomSelection: "選択範囲に合わせる",
            markIn: "再生位置をイン点にする",
            markLoop: "再生位置をループ点にする",
            markOut: "再生位置をアウト点にする",
            channels: "{count} ch",
        },
        // キーボードショートカットの設定表と「?」の一覧に出る。
        keybindings: {
            playPause: "再生と一時停止",
            toStart: "先頭へ",
            toEnd: "末尾へ",
            nudgeBack: "再生位置を少し戻す",
            nudgeForward: "再生位置を少し進める",
            nudgeBackCoarse: "再生位置を 1 秒戻す",
            nudgeForwardCoarse: "再生位置を 1 秒進める",
            loop: "ループを切り替え",
            markIn: "イン点を決める",
            markLoop: "ループ点を決める",
            markOut: "アウト点を決める",
            goToIn: "イン点へ移動",
            goToLoop: "ループ点へ移動",
            goToOut: "アウト点へ移動",
            clearIn: "イン点を消す",
            clearLoop: "ループ点を消す",
            clearOut: "アウト点を消す",
            undo: "マーカーの変更を元に戻す",
            redo: "マーカーの変更をやり直す",
            selectAll: "クリップ全体を選択",
            clearSelection: "選択を解除",
            zoomIn: "拡大",
            zoomOut: "縮小",
            zoomFit: "クリップ全体を表示",
        },
    },
    image: {
        loading: "画像を読み込んでいる…",
        loadError: "画像を読み込めなかった",
        zoomIn: "拡大",
        zoomOut: "縮小",
        resetView: "表示をリセット",
    },
    shortcuts: {
        copy: "選んだアセットをコピー",
        cut: "選んだアセットを切り取り",
        paste: "アセットを貼り付け",
        rename: "選んだアセットまたはグループの名前を変更",
    },
    // アセットが削除できない理由（AssetLockReason をキーにする）。
    lockReason: {
        character: "キャラクターが使っているアセット",
        scene: "シーンが使っているアセット",
        editor: "エディタが使っているアセット",
    },
    previewEditor: {
        loadFailed: "このアセットを読み込めなかった",
    },
    fontPreview: {
        sampleText: "いろはにほへと ちりぬるを 永東国鷹 The quick brown fox jumps over the lazy dog 0123456789",
        typePlaceholder: "入力すると自分の文でプレビューできる…",
    },
    jsonPreview: {
        invalid: "このファイルは正しい JSON ではない。そのままの中身を表示している",
        truncated: "このファイルは大きすぎて整形できない。先頭だけを表示している",
    },
    // 組み込みの Monaco テキストエディタ。専用のステータスバーは持たない。ファイル名、文字コード、
    // 改行コード、選択は **ワークスペースの** ステータスバーのセルなので、以下の多くは
    // タブではなく `modules/status-bar/textDocumentEntries` が読む。
    //
    // 値の文字列を `workspace.shell.statusBar` に移さず `assets.textEditor` に置くのは、
    // これらがバーではなくテキストドキュメントを説明しているから。ほかの場所に出るとしても
    // 同じ語が要る。
    textEditor: {
        loadFailed: "このファイルを読めなかった",
        saveFailed: "このファイルを保存できなかった",
        caret: "{line} 行、{column} 列",
        // 何かを選択している間、カーソル位置の表示に続けて出す。VS Code と同じ言い方。
        // 範囲が複数の形が別にあるのは、カーソルが 3 つあるときの文字数だけを出しても、
        // 作者は目に見えるどれとも結びつけられないから。
        selected: "（{count} 文字を選択）",
        selectedInRanges: "（{ranges} か所で {count} 文字を選択）",
        selectionLabel: "カーソル位置と選択",
        reopenWithEncoding: "文字コードを指定して開き直す",
        saveWithEncoding: "文字コードを指定して保存",
        selectEncoding: "ファイルの文字コードを選ぶ",
        selectLineEnding: "ファイルの改行コードを選ぶ",
        /** ステータスバーの改行コードのセルの読み上げ名。見えている文字は `LF` / `CRLF`。 */
        lineEndingLabel: "改行コード：{ending}",
        /** ステータスバーの文字コードの読み上げ名。見えている文字は値そのもの。 */
        encodingLabel: "文字コード：{encoding}",
        /**
         * プラグインのテキストエディタ向けの操作が、本文の無いものを投げたときの最後の受け皿。
         * プラグイン自身のエラー文があるならそちらを優先する。どの操作がなぜ失敗したかを
         * 言えるのはそれだけ。
         */
        actionFailed: "この操作は失敗した",
    },
    /**
     * テキストファイルの作成。既定の名前は文ではなく名前。入力欄には後ろに `.txt` が付いた形で
     * 入り、作者はたいてい丸ごと打ち替える。
     */
    newTextFile: {
        title: "新規テキストファイル",
        prompt: "ファイル名を決める。拡張子を打てばそれを使い、無ければ .txt になる",
        placeholder: "notes.txt",
        defaultName: "新規テキストファイル",
        empty: "ファイル名を入力してください",
        illegalChars: "ファイル名に \\ / : * ? \" < > | は使えない",
        failedTitle: "ファイルを作成できなかった",
    },
} satisfies LocaleNamespace<"assets">;
