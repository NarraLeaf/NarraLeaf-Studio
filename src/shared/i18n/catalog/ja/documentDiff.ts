import type { LocaleNamespace } from "../types";

/**
 * ドキュメントの 2 つのバージョンを比べた結果を言葉にしたもの。
 *
 * `document.` / `opaque.` / `summary.` / `structural.` の下のキーは、**メインプロセス** の
 * 生成側（`vcs/diff/documentDiff.ts` と `shared/documents/jsonStructuralDiff.ts`）が出す。
 * 生成側が返すのは翻訳キーとパラメータで、文そのものではない。ここでキー名を変えると
 * ラベルは黙って壊れ、キー名そのものが表示される。
 *
 * **値はこれらのテンプレートに入らない。** 変更の `from` / `to` は作者自身のデータで、
 * 画面は 2 つを矢印で挟んだ組として描く。文に織り込まないので、320px のレールでも
 * 文ごと切らずに値だけを省略できる。名前を指すパラメータ、すなわち `{name}`、`{index}`、
 * `{bytes}` だけがテンプレートに入る。
 */
export const documentDiff = {
    /** ドキュメントそのものが現れた、あるいは消えた。中身に関わらず 1 行。 */
    document: {
        added: "追加（{bytes}）",
        removed: "削除（{bytes}）",
    },
    /** 第 4 段階。バイト数として読む。ここでは他に読みようがない。 */
    opaque: {
        changed: "変更（{fromBytes} → {toBytes}）",
        unread: "変更あり。中身は見ていない",
    },
    /** 第 2 段階。それぞれの版が自分について言っていること。 */
    summary: {
        title: "名前",
        /** `{name}` 自体がキー。下の `count` を参照。このテンプレートに届く前に解決される。 */
        count: "{name}",
        other: "変更あり。要約には現れない部分",
    },
    /** 第 3 段階。JSON のパス。作りからして一般的で、一覧の上の見出しがそう断っている。 */
    structural: {
        property: "{name}",
        element: "{index} 番目の要素",
        root: "ドキュメントそのもの",
    },
    /**
     * スペックの要約が数えているもの。`DocumentSummaryCount.key` が持つ安定したキーで引く。
     *
     * ここに項目の無いキーは、キー不明の警告ではなく識別子そのものにフォールバックする。
     * スペックが誰かの翻訳より先に集計を足すことがあり、一覧に `audioTracks` と出るほうが
     * 空の行よりはるかにましだから。
     */
    count: {
        assets: "アセット",
        audioTracks: "オーディオトラック",
        characterGroups: "キャラクターグループ",
        characters: "キャラクター",
        localizationKeys: "ローカライズのキー",
        storyBlocks: "ストーリーの行",
        storyChapters: "チャプター",
        storyScenes: "シーン",
        translationUnits: "翻訳",
        variables: "変数",
        voiceUnits: "ボイスの行",
    },
    /**
     * 第 1 段階のストーリースペック。シーンと行、つまり作者が書いた単位。
     *
     * `subject` は作者自身の言葉（シーン名や行の文）を持ち、これらの *隣* に描かれるので、
     * ここではその対象を名乗り直さない。`{field}` を含むものが生のフィールド識別子を引くのは、
     * 生成側が持っているのがそれだけだから。`entrySceneId` に作者の言葉は無い。
     */
    story: {
        renamed: "ストーリー名を変更",
        /** チャプターの `meta` でも使う。その場合チャプター名は `subject` として届く。 */
        documentField: "{field} を変更",
        chapterAdded: "チャプターを追加",
        chapterRemoved: "チャプターを削除",
        chapterRenamed: "チャプター名を変更",
        /** 並べ替え、またはシーンの出入り。2 つの値はそれぞれの件数。 */
        chapterScenes: "シーンの一覧が変化",
        chapterOrder: "チャプターを並べ替え",
        sceneAdded: "シーンを追加（{blocks} 行）",
        sceneRemoved: "シーンを削除（{blocks} 行）",
        sceneChanged: "シーンを変更",
        sceneRenamed: "名前を変更",
        sceneField: "シーンの {field}",
        blockAdded: "行を追加",
        blockRemoved: "行を削除",
        blockChanged: "行を変更",
        /** 並べ替えではなく親の付け替え。一覧の並べ替えを言うのは `blockOrder`。 */
        blockMoved: "行を移動",
        blockKind: "行の種類を変更",
        blockDisabled: "行を無効化",
        blockEnabled: "行を有効化",
        blockField: "{field} を変更",
        blockOrder: "行を並べ替え",
    },
    /**
     * 第 1 段階のキャラクターストア。
     *
     * この段階がそもそも存在する理由の行が `poseAsset` / `layerOptionAsset`。
     * 「アリスの怒り差分が別の画像を指すようになった」で、`subject` はポーズかタグ。
     */
    characters: {
        castOrder: "キャストを並べ替え（{count}）",
        added: "キャラクターを追加",
        removed: "キャラクターを削除",
        changed: "キャラクターを変更",
        renamed: "名前を変更",
        profileField: "プロフィールの {field}",
        /** preset / layered / puppet。2 つの種別は値の組として描かれる。 */
        kindChanged: "見た目の種類を変更",
        poseAdded: "ポーズを追加",
        poseRemoved: "ポーズを削除",
        poseRenamed: "ポーズ名を変更",
        poseAsset: "別の画像を指すようになった",
        poseChanged: "ポーズを変更",
        poseOrder: "ポーズを並べ替え",
        defaultPose: "既定のポーズを変更",
        axisAdded: "軸を追加",
        axisRemoved: "軸を削除",
        axisChanged: "軸を変更",
        layerAdded: "レイヤーを追加",
        layerRemoved: "レイヤーを削除",
        layerChanged: "レイヤーを変更",
        layerAsset: "別の画像を指すようになった",
        /**
         * レイヤー内のあるタグの画像。増えたか、消えたか、入れ替わったかのいずれかなので、
         * 動詞ではなく名詞にしてある。どれなのかは行自身の印が言う。`{layer}` / `{tag}` の
         * パラメータをわざと持たない。生成側は作者の付けた名前が無いほうを省くので、
         * 埋まらないプレースホルダは作者の画面に `{layer}` のまま出てしまう。
         */
        layerOptionAsset: "レイヤーの画像",
        layerOrder: "レイヤーを並べ替え",
        appearanceField: "見た目の {field}",
        /** `{key}` はポーズ id かタグの組み合わせで、作者の言葉ではない。だから `subject` ではない。 */
        avatarChanged: "ダイアログのアバター {key}",
        groupAdded: "グループを追加",
        groupRemoved: "グループを削除",
        groupRenamed: "グループ名を変更",
    },
    /**
     * 翻訳の 1 単位を、3 方向マージの視点で読んだもの。
     *
     * 出すのは `merge3` だけで、この形式にはまだ意味的な差分がない。隣に `subject` も無い。
     * 単位 id はストーリーのテキスト id か `key:`／`char:` のハンドルで、作者が打った言葉ではない。
     * 行を見分けさせるのは、その下に描かれる 2 つの翻訳。
     */
    localization: {
        added: "翻訳を追加",
        removed: "翻訳を削除",
        changed: "翻訳を変更",
    },
    /** 第 1 段階、`assets.metadata.<type>.json` の 1 断片。アセットに付けた作者のメタデータ。 */
    assets: {
        added: "アセットを追加",
        removed: "アセットを削除",
        changed: "アセットを変更",
        renamed: "名前を変更",
        /** 内容のハッシュが動いた。記録の先にあるファイルのバイト列が別物になった。 */
        content: "ファイルの中身を差し替え",
        field: "{field} を変更",
    },
    /**
     * 4 つの段階のどれが答えたか。構造の一覧が意味的な一覧に見えてしまうのを止める見出し。
     * `semantic` にこれが無いのは、断り書きの要らない主張だから。
     */
    tier: {
        summary: "要約のみ",
        summaryHint: "中身は比べていない。ここに出るのは、それぞれの版が自分について報告している数",
        structural: "構造",
        structuralHint: "JSON の構造だけで比べているので、生成された id や並べ替えた一覧も変更として出る",
        opaque: "未読",
        opaqueHint: "大きすぎるか、テキストでないか、読めない。分かるのは大きさだけ",
    },
    rows: {
        loading: "比較結果を読んでいる…",
        empty: "このファイルの中に違いはない",
        // 「何も無い」に 3 通りある。「変更あり」と「違いはない」が並ぶと矛盾に読め、
        // 段階ごとに言えることも違う。documentDiffEmptyKey を参照。
        emptyFormatting: "書式だけが変わった",
        emptyUntracked: "エディタが見ている範囲に変化はない",
        emptyCounts: "合計は変わっていない",
        notInspected: "このファイルは中を見ていない",
        moreInGroup: "この中にあと {count} 件",
        viewAll: "{count} 件すべてを見る",
        showing: "{total} 件中 {shown} 件を表示",
    },
    rail: {
        expand: "中の変更を表示",
        collapse: "中の変更を隠す",
        compareWithPrevious: "前のバージョンと比べる",
    },
    tab: {
        workingTree: "変更",
        between: "{from} → {to}",
        comparingWorkingTree: "このプロジェクトと {version}",
        comparingWorkingTreeUnknown: "このプロジェクトと直前のバージョン",
        comparingRevisions: "{from} と {to}",
        refresh: "読み直す",
        empty: "この 2 つのバージョンに違いはない",
        emptyWorkingTree: "直前のバージョンから変わっていない",
        readFailure: "この比較に必要なバイト列を読めなかった：{error}",
        incomplete: "変化した {total} 個のパスのうち {shown} 個を比べた。残りは対象から外した",
        documentsOmitted: "ここに載っていないファイルがあと {count} 件ある",
        unavailable: "このプロジェクトではバージョン管理を使えない",
    },
    /**
     * ファイルごとにどちらかの側を採ってマージを終える画面。
     *
     * 語彙はバックエンドの `mine`／`theirs` ではなく「自分のものを残す／相手のものを残す」にし、
     * リビジョンのハッシュではなく「取ってきたバージョン」と呼ぶ。「サーバーから取得」を押した
     * 作者がしているのは、同僚の作業と自分の作業のすり合わせであって、3 方向マージの解決ではない。
     *
     * `notSaved` はこの画面が正直でいられる理由の一文。どの衝突を決めたかを残す読める記録は
     * どこにも無く、記録はこのウィンドウの中にしかない。それを言うほうが、タブを閉じれば
     * 黙って消える進捗をあるかのように見せるよりよい。
     */
    resolve: {
        tab: "マージ",
        merging: "このプロジェクトの 2 つのバージョンをマージしている",
        none: "このプロジェクトはマージの途中ではない",
        automerged: "すべて自動でマージできた。完了するとバージョンとして記録される",
        count: {
            other: "両側で変わったファイルが {count} 件ある。どちらを残すか選ぶ",
        },
        takeMine: "自分のものを残す",
        takeTheirs: "相手のものを残す",
        takeAllMine: "すべて自分のものを残す",
        takeAllTheirs: "すべて相手のものを残す",
        rowsOmitted: "ここに載っていないファイルがあと {count} 件ある。上の 2 つのリンクでまとめて選ぶ",
        finish: "マージを完了する",
        finishUndecided: {
            other: "どちらを残すか決まっていないファイルが {count} 件ある",
        },
        notSaved: "この選択はこのウィンドウを開いている間だけ保たれる。マージを完了するまで何も書き込まれない",
        abandon: "取りやめる",
        abandonConfirm: "このマージを取りやめるか",
        abandonConfirmDetail:
            "サーバーからこれらのバージョンを取ってくる前の状態に、すべてのファイルが戻る。自動でマージできたファイルも含む。失われるものはない。バージョンは取り直せる",
        /**
         * 第 2 段階。1 つのファイルの中を変更ごとに選ぶ。
         *
         * 2 つの語が違いのすべてを担っていて、どちらも落とせない。`auto` は作者ではなく
         * **マージが** すでに決めた行で、決着済みとして描き、ホバーすると反対側にも手が届く。
         * ほとんどの場合、何も押さないのが正しい答えだから。`conflict` の行にはその既定が無い。
         * `blocked` の下の理由は、変更ごとの一覧が空なのではなく、そもそも無いことの説明。
         */
        change: {
            expand: "中の変更を表示",
            collapse: "中の変更を隠す",
            loading: "両方のバージョンを読んでいる…",
            /** 一覧の上に一度だけ出す。どの行も繰り返さなくて済むように。 */
            heading: "印の無い行は自動でマージ済み。マージ済みの行にカーソルを合わせると反対側を採れる",
            none: "このファイルの 2 つのバージョンは中身が同一",
            auto: "マージ済み",
            /** マージ済みの行で作者がひっくり返せるほう。2 つのうち片方しか出ない。 */
            useMine: "自分のものを使う",
            useTheirs: "相手のものを使う",
            /** その側にこの項目自体が無い。採るとはそれを採ること。 */
            absent: "存在しない",
            /** 行が描く数個より先のフィールド。選択の根拠になるものは隠さない。 */
            moreFields: "+{count} 件",
            undecided: {
                other: "どちらを残すか決まっていない変更が {count} 件ある",
            },
            /** 第 1 段階に戻る。それぞれ、どの壁に当たったのかを言う。 */
            blocked: {
                title: "このファイルはどちらか一方から丸ごと採るしかない",
                noSpec: "Studio はこのファイルの形式を知らないので、一部だけをマージできない",
                noMerge3: "Studio はこの形式を読めるが、2 つのバージョンを変更ごとにマージできない",
                readOnly: "Studio はこの形式をマージできるが、結果を書き戻せないので、ファイル全体をどちらか一方から採る",
                tooLarge: "このファイルは大きすぎて、変更ごとのマージができない",
                tooMany: "このファイルは変更が多すぎて、1 件ずつ決められない",
                unreadable: "2 つのバージョンのうち一方を読めなかったので、ファイル全体を採るしかない",
            },
        },
    },
} satisfies LocaleNamespace<"documentDiff">;
