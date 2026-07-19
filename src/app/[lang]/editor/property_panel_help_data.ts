export type FieldHelpEntry = {
    label: string
    description: string
    references?: { syntax: string, description: string }[]
    examples?: string[]
}

// Common reference info for expression input fields
const EXPRESSION_REFERENCES: { syntax: string, description: string }[] = [
    { syntax: 'field.fieldName', description: 'データソースフィールド値' },
    { syntax: 'vars.variableName', description: '計算変数値' },
    { syntax: 'param.paramName', description: '外部パラメータ値' },
    { syntax: 'PAGE_NUMBER', description: '現在の評価文脈のページ番号。evaluationTime=report では最終ページ番号になる' },
    { syntax: 'COLUMN_NUMBER', description: '現在の列番号' },
    { syntax: 'REPORT_COUNT', description: '現在の評価文脈までに処理済みのレコード数' },
    { syntax: 'TOTAL_PAGES', description: '総ページ数。evaluationTime=report で確定する' },
    { syntax: 'TRUE, FALSE', description: '真偽値リテラル' },
    { syntax: '!', description: '否定' },
    { syntax: '+, -, *, /', description: '四則演算' },
    { syntax: '()', description: '優先順位の明示' },
    { syntax: '`...${...}`', description: 'テンプレートリテラル' },
    { syntax: '??', description: 'null合体演算子' },
    { syntax: 'format(value, pattern)', description:
        'valueをpatternで書式化して文字列を返す。' +
        '\n\n【数値パターン】' +
        '\n# … 任意桁（値がなければ非表示）' +
        '\n0 … 必須桁（値がなければ0埋め）' +
        '\n, … 3桁区切り' +
        '\n. … 小数点' +
        '\nパターン前後の文字列はそのまま接頭辞・接尾辞になる' +
        '\n\n数値パターン例:' +
        '\nformat(12345.678, "#,##0.00") → "12,345.68"' +
        '\nformat(42, "0000") → "0042"' +
        '\nformat(1234, "¥#,##0") → "¥1,234"' +
        '\nformat(1234, "税込 #,##0 円") → "税込 1,234 円"' +
        '\nformat(0.15, "0.0%") → "0.2%"' +
        '\nformat(1234.5, "#,##0.#") → "1,234.5"' +
        '\nformat(1234, "#,##0.#") → "1,234"' +
        '\nformat(-42, "0000") → "-0042"' +
        '\n\n【日付パターン】' +
        '\nyyyy … 4桁西暦, MM … 2桁月, M … 月, dd … 2桁日, d … 日' +
        '\nHH … 2桁時, mm … 2桁分, ss … 2桁秒' +
        '\n\n日付パターン例:' +
        '\nformat(field.date, "yyyy/MM/dd") → "2024/04/01"' +
        '\nformat(field.date, "yyyy年M月d日") → "2024年4月1日"' +
        '\nformat(field.date, "yyyy-MM-dd HH:mm:ss") → "2024-04-01 09:05:03"' +
        '\nformat(field.date, "HH:mm") → "09:05"' +
        '\nformat(now(), "yyyy/MM/dd") → 現在日付'
    },
    { syntax: 'round(value, digits)', description:
        '四捨五入。digitsは小数桁数（負数で整数桁丸め）。' +
        '\nround(123.456, 2) → 123.46' +
        '\nround(123.456, 0) → 123' +
        '\nround(-1255, -2) → -1300'
    },
    { syntax: 'roundUp(value, digits)', description:
        'ゼロから遠い方向への丸め（絶対値切り上げ）。' +
        '\nroundUp(123.451, 2) → 123.46' +
        '\nroundUp(-12.341, 2) → -12.35'
    },
    { syntax: 'roundDown(value, digits)', description:
        'ゼロ方向への丸め（絶対値切り捨て）。' +
        '\nroundDown(123.459, 2) → 123.45' +
        '\nroundDown(-12.349, 2) → -12.34'
    },
    { syntax: 'roundHalfEven(value, digits)', description:
        '銀行家丸め。端数0.5のとき偶数側に丸める。' +
        '\nroundHalfEven(2.5, 0) → 2' +
        '\nroundHalfEven(3.5, 0) → 4'
    },
    { syntax: 'ceil(value, digits)', description:
        '正の無限大方向への切り上げ。' +
        '\nceil(123.41, 1) → 123.5' +
        '\nceil(-12.31, 1) → -12.3'
    },
    { syntax: 'floor(value, digits)', description:
        '負の無限大方向への切り捨て。' +
        '\nfloor(123.49, 1) → 123.4' +
        '\nfloor(-12.31, 1) → -12.4'
    },
    { syntax: 'trunc(value, digits)', description:
        'ゼロ方向への切り捨て。' +
        '\ntrunc(123.49, 1) → 123.4' +
        '\ntrunc(1255, -2) → 1200'
    },
    { syntax: 'now()', description:
        '現在日時をDateとして返す。引数なし。' +
        '\nformat(now(), "yyyy/MM/dd") → 現在日付' +
        '\nformat(now(), "HH:mm:ss") → 現在時刻'
    },
]

const EXPRESSION_EXAMPLES = [
    'field.productName',
    'vars.totalAmount',
    'param.reportTitle',
    'field.price * field.quantity',
    '!FALSE',
    '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`',
    'field.name ?? "N/A"',
    'PAGE_NUMBER + " / " + TOTAL_PAGES',
    'format(field.amount, "#,##0.00")',
    'round(field.tax, 2)',
    'format(now(), "yyyy/MM/dd HH:mm:ss")',
]

const CONDITION_REFERENCES: { syntax: string, description: string }[] = [
    ...EXPRESSION_REFERENCES,
    { syntax: '===, !==', description: '等価・非等価比較' },
    { syntax: '&&, ||', description: '論理AND・OR' },
    { syntax: '>, <, >=, <=', description: '大小比較' },
    { syntax: '? :', description: '三項演算子' },
    { syntax: '??', description: 'null合体演算子' },
]

const CONDITION_EXAMPLES = [
    'field.status === "active"',
    '!FALSE && field.amount >= 0',
    'field.amount > 0',
    'param.showDetail === true',
    'field.name !== null && field.name !== ""',
    'COLUMN_NUMBER === 1',
]

export const FIELD_HELP: Record<string, FieldHelpEntry> = {
    // ========================
    // Page settings
    // ========================
    'page.templateName': {
        label: 'テンプレート名',
        description: '帳票テンプレートの識別名。サブレポート参照やテンプレート管理に使用される。',
    },
    'page.size': {
        label: '用紙サイズ',
        description: '定型用紙サイズを選択。カスタムを選ぶと幅・高さを自由に指定できる。',
    },
    'page.width': {
        label: 'ページ幅',
        description: 'ページの幅。カスタムサイズ選択時のみ編集可能。単位はpt（ポイント）基準で内部管理される。',
    },
    'page.height': {
        label: 'ページ高さ',
        description: 'ページの高さ。カスタムサイズ選択時のみ編集可能。',
    },
    'page.orientation': {
        label: '向き',
        description: '用紙の向き。変更すると幅と高さが自動的に入れ替わる。',
    },
    'page.marginTop': {
        label: '上余白',
        description: 'ページ上端からコンテンツ領域までの距離。',
    },
    'page.marginBottom': {
        label: '下余白',
        description: 'ページ下端からコンテンツ領域までの距離。',
    },
    'page.marginLeft': {
        label: '左余白',
        description: 'ページ左端からコンテンツ領域までの距離。',
    },
    'page.marginRight': {
        label: '右余白',
        description: 'ページ右端からコンテンツ領域までの距離。',
    },
    'page.columnCount': {
        label: '段組み列数',
        description: 'Detailバンドの段組み列数。1の場合は段組みなし。',
    },
    'page.columnWidth': {
        label: '段組み列幅',
        description: '各段の幅。列数×列幅＋(列数-1)×列間隔がコンテンツ幅に収まる必要がある。',
    },
    'page.columnSpacing': {
        label: '段組み列間隔',
        description: '段と段の間のスペース。',
    },
    'page.columnPrintOrder': {
        label: '段組み印刷順序',
        description: '段組み時のレコード配置方向。縦方向: 1段目を上から下へ埋めてから次の段へ。横方向: 各行を左から右へ埋めてから次の行へ。',
    },

    // ========================
    // Report settings
    // ========================
    'report.titleNewPage': {
        label: 'タイトル新ページ',
        description: 'タイトルバンドを独立したページに出力するかどうか。有効時、タイトルの後に改ページが入る。',
    },
    'report.summaryNewPage': {
        label: 'サマリー新ページ',
        description: 'サマリーバンドを独立した新しいページから出力するかどうか。',
    },
    'report.summaryWithPageHeaderAndFooter': {
        label: 'サマリーページヘッダー/フッター',
        description: 'Summary バンドの「新しいページから開始」が有効な場合、そのサマリーページと継続ページに pageHeader / pageFooter を表示するかどうか。columnHeader / columnFooter はこの設定では表示されない。',
    },
    'report.testDataPath': {
        label: 'テストデータファイル',
        description: 'プレビュー時に使用するJSONデータファイルのパス。なしの場合はダミーデータで表示される。',
    },

    // ========================
    // Band settings
    // ========================
    'band.enabled': {
        label: 'バンド有効',
        description: 'バンドの有効/無効を切り替える。無効なバンドはレイアウトに含まれない。',
    },
    'band.height': {
        label: 'バンド高さ',
        description: 'バンドの設計高さ。子要素の stretchWithOverflow、subreport、table などの実効高さにより、出力時にはこの高さを超えて継続配置される場合がある。',
    },
    'band.startNewPage': {
        label: '新しいページから開始',
        description: 'このバンドを必ず改ページ後の新しいページから開始する。Title は専用タイトルページ、Summary は専用サマリーページの挙動になる。Summary / Title のページや継続ページでは columnHeader / columnFooter は表示されない。',
    },
    'band.splitType': {
        label: '分割制御',
        description: 'バンドがページ境界を超える場合の分割動作を制御する。\n\n'
            + '■ Stretch（デフォルト）\nバンドの設計高さが現在ページの残り高さに収まる場合に描画を開始し、その後に子要素の伸長であふれた分だけを次ページへ継続する。'
            + '例: 明細行が多い請求書で、行の基本高さは現在ページに配置しつつ、備考欄などの伸長分だけ自然に次ページへ続ける場合。\n\n'
            + '■ Prevent\nバンド全体を分割せず、収まらない場合はバンドごと次ページへ移動する。'
            + '例: 契約条項や署名欄など、途中で切れると読みにくい固まりを1ページ内に維持したい場合。\n\n'
            + '■ Immediate\nページ境界で即座に分割する。Stretchとの違いは、バンド内の要素配置を考慮せず境界位置で機械的に切る点。'
            + '例: 背景パターンや罫線など、どこで切れても問題ないバンドに使用する。',
    },
    'band.printWhenExpression': {
        label: '表示条件式（バンド）',
        description: 'バンドの表示条件を式で指定。trueを返す場合にバンドが出力される。',
        references: CONDITION_REFERENCES,
        examples: CONDITION_EXAMPLES,
    },

    // ========================
    // Group (control break)
    // ========================
    'group.add': {
        label: 'グループを追加',
        description: 'グループ（コントロールブレーク）を追加する。グループヘッダー/フッターのバンドが自動生成され、グループ式の値が変わるたびにブレークが発生する。複数グループはネスト（外側→内側）される。',
    },
    'group.name': {
        label: 'グループ名',
        description: 'グループの識別名。変数の resetGroup や evaluationGroup から参照される。',
    },
    'group.expression': {
        label: 'グループ式',
        description: 'この式の評価値が前の行と異なるとグループブレークが発生し、フッター/ヘッダーが出力される。',
        references: CONDITION_REFERENCES,
        examples: ['field.category', 'field.department'],
    },
    'group.startNewPage': {
        label: 'グループごとに改ページ',
        description: 'グループの開始時に新しいページから印字を開始する。',
    },
    'group.startNewColumn': {
        label: 'グループごとに改カラム',
        description: '段組み時、グループの開始時に次のカラムへ移動する。',
    },
    'group.reprintHeaderOnEachPage': {
        label: '改ページ後にヘッダーを再印字',
        description: 'グループの途中でページが変わった場合、続きページの先頭にグループヘッダーを再印字する。',
    },
    'group.resetPageNumber': {
        label: 'ページ番号をリセット',
        description: 'グループブレーク時にページ番号を1へ戻す（改ページ指定時は新ページが1ページ目になる）。',
    },
    'group.keepTogether': {
        label: 'グループを同一ページに保持',
        description: 'グループ全体が現在ページの残りに収まらず、かつ新しいページには収まる場合、改ページしてグループ全体を同一ページに収める。',
    },
    'group.minHeightToStartNewPage': {
        label: '改ページ判定の最低残余高さ',
        description: 'グループ開始時、ページの残り高さがこの値未満なら改ページしてから開始する。',
    },
    'group.footerPosition': {
        label: 'フッター位置',
        description: 'グループフッターの配置。normal: 明細直後。stackAtBottom: ページ下部に積む。forceAtBottom: 常にページ下部。collateAtBottom: 外側グループと揃えて下部。',
    },

    // ========================
    // Element - Position & size
    // ========================
    'element.x': {
        label: 'X座標',
        description: '要素の左端位置（バンド左端からの相対座標）。',
    },
    'element.y': {
        label: 'Y座標',
        description: '要素の上端位置（バンド上端からの相対座標）。',
    },
    'element.width': {
        label: '要素幅',
        description: '要素の幅。',
    },
    'element.height': {
        label: '要素高さ',
        description: '要素の高さ。テキスト系要素で stretchWithOverflow が有効な場合は、出力時に内容に応じて実効高さが拡張されることがある。',
    },

    // ========================
    // Element - Placement control
    // ========================
    'element.positionType': {
        label: '位置タイプ',
        description: 'バンドが伸縮した際の要素の追従方式。Float: 上の要素に追従して移動。上端固定: バンド上端からの距離を維持。下端固定: バンド下端からの距離を維持。',
    },
    'element.stretchType': {
        label: '伸縮タイプ',
        description: '要素の垂直方向の伸縮動作。伸縮なし: 固定高さ。コンテナ高さ: バンドの高さに合わせて伸縮。コンテナ下端: バンドの下端まで伸縮。',
    },
    'element.fitParentHorizontal': {
        label: '親の幅にフィット（水平）',
        description: '子要素の x を 0、幅を親（frame / テーブル列 / セル）のコンテンツ幅に自動追従させる。親のリサイズや列幅変更に連動する。',
    },
    'element.fitParentVertical': {
        label: '親の高さにフィット（垂直）',
        description: '子要素の y を 0、高さを親のコンテンツ高さに自動追従させる。',
    },

    // ========================
    // Element - Print control
    // ========================
    'element.printWhenExpression': {
        label: '表示条件式',
        description: '要素の表示条件を式で指定。trueを返す場合に要素が出力される。空の場合は常に表示。',
        references: CONDITION_REFERENCES,
        examples: CONDITION_EXAMPLES,
    },
    'element.removeLineWhenBlank': {
        label: '空白時行削除',
        description: '要素が空白（非表示または内容なし）の場合、要素が占める垂直スペースを削除してバンドを縮小する。',
    },
    'element.printRepeatedValues': {
        label: '繰り返し値印刷',
        description: '前のレコードと同じ値の場合も繰り返し出力するかどうか。無効にすると同じ値が連続する場合に最初の1回だけ表示される。',
    },

    // ========================
    // Element - Display
    // ========================
    'element.mode': {
        label: '描画モード',
        description: '要素の背景描画モード。透明: 背景色を描画しない。不透明: 背景色を描画する。',
    },
    'element.opacity': {
        label: '不透明度',
        description: '要素全体の不透明度。0.0（完全透明）〜 1.0（完全不透明）。',
    },
    'element.forecolor': {
        label: '前景色',
        description: '要素の前景色（テキスト色、線色など）。全ての色指定はRGB（#RRGGBB）のほかCMYK（cmyk(C,M,Y,K)、各0〜100%）と特色（spot(名前,C,M,Y,K)、代替CMYK付き）に対応。CMYK/特色はPDFにDeviceCMYK/Separationでネイティブ出力され、画面プレビューは近似RGBで表示される。',
    },
    'element.backcolor': {
        label: '背景色',
        description: '要素の背景色。描画モードが「不透明」の場合に使用される。',
    },

    // ========================
    // Border
    // ========================
    'border.allWidth': {
        label: 'ボーダー幅（一括）',
        description: '全辺のボーダー幅を一括設定。',
    },
    'border.allColor': {
        label: 'ボーダー色（一括）',
        description: '全辺のボーダー色を一括設定。',
    },
    'border.allStyle': {
        label: 'ボーダースタイル（一括）',
        description: '全辺のボーダースタイルを一括設定。実線・破線・点線から選択。',
    },
    'border.sideEnabled': {
        label: 'ボーダー辺有効',
        description: '各辺のボーダーの有効/無効を個別に設定。',
    },
    'border.sideWidth': {
        label: 'ボーダー辺幅',
        description: '各辺のボーダー幅を個別に設定。',
    },
    'border.sideColor': {
        label: 'ボーダー辺色',
        description: '各辺のボーダー色を個別に設定。',
    },
    'border.sideStyle': {
        label: 'ボーダー辺スタイル',
        description: '各辺のボーダースタイルを個別に設定。',
    },

    // ========================
    // Padding
    // ========================
    'padding.top': {
        label: 'パディング上',
        description: '要素の内側余白（上）。コンテンツとボーダーの間の距離。',
    },
    'padding.bottom': {
        label: 'パディング下',
        description: '要素の内側余白（下）。',
    },
    'padding.left': {
        label: 'パディング左',
        description: '要素の内側余白（左）。',
    },
    'padding.right': {
        label: 'パディング右',
        description: '要素の内側余白（右）。',
    },

    // ========================
    // Text
    // ========================
    'text.text': {
        label: 'テキスト内容',
        description: '静的テキスト要素に表示する固定テキスト。改行を含むことができる。',
    },
    'text.expression': {
        label: 'テキストフィールド式',
        description: '動的に評価されるワンライナー式。参照、四則演算、テンプレートリテラル、三項演算子に加え、format・丸め系・now などの組込み関数を使用できる。',
        references: EXPRESSION_REFERENCES,
        examples: EXPRESSION_EXAMPLES,
    },
    'text.fontFamily': {
        label: 'フォント',
        description: '使用するフォントファミリー名。プロジェクトに登録されたフォントから選択。',
    },
    'text.fontSize': {
        label: 'フォントサイズ',
        description: 'フォントサイズ（pt）。',
    },
    'text.bold': {
        label: '太字',
        description: 'テキストを太字で表示する。',
    },
    'text.italic': {
        label: '斜体',
        description: 'テキストを斜体で表示する。',
    },
    'text.underline': {
        label: '下線',
        description: 'テキストに下線を付ける。',
    },
    'text.strikethrough': {
        label: '取消線',
        description: 'テキストに取消線を付ける。',
    },
    'text.hAlign': {
        label: '水平配置',
        description: 'テキストの水平方向の配置。左・中央・右・均等から選択。',
    },
    'text.vAlign': {
        label: '垂直配置',
        description: 'テキストの垂直方向の配置。上・中央・下から選択。',
    },
    'text.rotation': {
        label: '回転',
        description: 'テキストの回転角度。0°/90°/180°/270°から選択。',
    },
    'text.markup': {
        label: 'マークアップ',
        description: 'テキスト内のマークアップ解釈方式。なし: プレーンテキスト。HTML: HTMLタグを解釈してリッチテキスト表示。',
    },
    'text.direction': {
        label: 'テキスト方向',
        description: 'テキストの書字方向。LTR: 左から右。RTL: 右から左（アラビア語等）。自動: 内容に応じて自動判定。',
    },
    'text.writingMode': {
        label: '書字方向',
        description: 'テキストの書字モード。横書き・縦書き（右→左）・縦書き（左→右）から選択。日本語の縦書きには「縦書き（右→左）」を使用。',
    },
    'text.lineSpacingType': {
        label: '行間タイプ',
        description: '行間の計算方式。1行/1.5行/2行: フォントサイズ基準の倍率。比率指定: 任意の倍率。固定: 固定値（pt）。最小: 最小値（pt）。',
    },
    'text.lineSpacingValue': {
        label: '行間値',
        description: '行間の数値。タイプが「比率指定」の場合は倍率、「固定」「最小」の場合はpt値。',
    },
    'text.letterSpacing': {
        label: '字間',
        description: '文字間のスペース（pt）。正の値で広がり、負の値で狭まる。',
    },
    'text.wordSpacing': {
        label: '語間',
        description: '単語間のスペース（pt）。主に欧文テキストに影響する。',
    },
    'text.firstLineIndent': {
        label: '先頭行字下げ',
        description: '段落の最初の行のインデント量（pt）。',
    },
    'text.tabStopWidth': {
        label: 'タブ幅',
        description: 'タブ文字の幅（pt）。',
    },
    'text.leftIndent': {
        label: '左インデント',
        description: '段落の左インデント量（pt）。',
    },
    'text.rightIndent': {
        label: '右インデント',
        description: '段落の右インデント量（pt）。',
    },
    'text.wrap': {
        label: '折り返し',
        description: 'テキストが要素幅を超えた場合に折り返すかどうか。無効にすると1行で表示される。',
    },
    'text.shrinkToFit': {
        label: '縮小して収める',
        description: 'テキストが要素領域に収まらない場合、フォントサイズを自動縮小して収める。折り返しが無効の場合は横幅基準、有効の場合は高さ基準で判定。',
    },
    'text.minFontSize': {
        label: '最小フォントサイズ',
        description: '縮小して収める場合の最小フォントサイズ（pt）。これ以下には縮小されない。',
    },
    'text.fitWidth': {
        label: '幅に合わせる',
        description: '要素幅に合わせてフォントサイズを自動調整する。テキスト全体が要素幅にフィットするようにサイズが計算される。',
    },
    'text.outlineText': {
        label: 'PDF文字出力',
        description: '要素ごとに、フォント埋込み、グリフパスへのアウトライン化、閲覧環境のシステムフォント参照を選択する。既定値はフォント埋込み。',
    },
    'text.anchorName': {
        label: 'アンカー名',
        description: 'ブックマークやハイパーリンクの参照先となるアンカー名。PDF出力時のしおりにも使用される。',
        references: EXPRESSION_REFERENCES,
        examples: ['"chapter1"', 'field.sectionId', '"item_" + field.id'],
    },
    'text.bookmarkLevel': {
        label: 'ブックマークレベル',
        description: 'PDFブックマーク（しおり）の階層レベル。0: ブックマークなし。1以上: 階層レベル（1がトップ）。',
    },

    // ========================
    // Hyperlink
    // ========================
    'hyperlink.type': {
        label: 'ハイパーリンクタイプ',
        description: 'リンクの種類。参照: URL。ローカルアンカー: 同一レポート内のアンカー。ローカルページ: 同一レポート内のページ番号。リモートアンカー/ページ: 別ドキュメント内の参照。',
    },
    'hyperlink.target': {
        label: 'リンク先',
        description: 'リンク先の値。タイプに応じてURL、アンカー名、ページ番号を指定。',
        references: EXPRESSION_REFERENCES,
        examples: ['"https://example.com"', '"#chapter1"', 'field.url'],
    },
    'hyperlink.remoteDocument': {
        label: 'リモートドキュメント',
        description: 'リモートアンカー/ページ参照時の外部ドキュメントのパスまたはURL。',
    },

    // ========================
    // Text field
    // ========================
    'textField.pattern': {
        label: 'パターン',
        description: '数値・日付・日時の書式パターン。core の format(value, pattern) と同じ書式系を使用し、textField の値を表示直前に整形する。例: カンマ区切り、0埋め、小数精度、日付/日時。',
        examples: ['#,##0.00', '¥#,##0', '0.0%', 'yyyy/MM/dd', 'yyyy-MM-dd HH:mm:ss'],
    },
    'textField.blankWhenNull': {
        label: 'Null時空白',
        description: '値がnullの場合に"null"ではなく空白を表示する。',
    },
    'textField.stretchWithOverflow': {
        label: 'オーバーフロー時伸縮',
        description: 'テキストが要素の高さを超える場合、要素を自動拡張して全テキストを表示する。',
    },
    'textField.evaluationTime': {
        label: '評価タイミング',
        description: '式をいつ評価するかを決める。\n\n'
            + '■ Now（既定）\n要素を配置する時点で即時評価する。ページごとに変わる値をそのページの値で表示したい時に使う。\n'
            + '例: pageFooter の textField に PAGE_NUMBER を置くと、1ページ目は 1、2ページ目は 2 になる。\n\n'
            + '■ Band\nその要素を含む band の処理完了後に評価する。band 内で更新された変数の最終値を同じ band で表示したい時に使う。\n'
            + '例: detail band の末尾で vars.lineTotal の確定値を表示する。\n\n'
            + '■ Column\n現在列の処理完了後に評価する。段組み帳票で列単位の確定値を表示したい時に使う。\n'
            + '例: 2段組みの各列末尾で、その列に入った件数を表示する。\n\n'
            + '■ Page\n現在ページの処理完了後に評価する。ページ合計やページ末時点の集計値を表示したい時に使う。\n'
            + '例: pageHeader の textField を evaluationTime=page にすると、そのページに実際に載った明細を含む vars.pageSum を表示できる。\n\n'
            + '■ Group\n指定グループの処理完了後に評価する。evaluationGroup の指定が必須。\n'
            + '例: groupFooter で vars.groupTotal を確定後の値で表示する。\n\n'
            + '■ Report\n帳票全体の処理完了後に評価する。総ページ数や最終集計のように、最後まで処理しないと確定しない値向け。\n'
            + '重要: 一般的な帳票機能にあるように、この時点の PAGE_NUMBER は最終ページ番号になる。1つの textField に `${PAGE_NUMBER} / ${TOTAL_PAGES}` を書いて evaluationTime=report にすると、全ページで `4 / 4` のように表示される。\n'
            + '1 / 4, 2 / 4, ... にしたい場合は、PAGE_NUMBER を evaluationTime=now の textField、TOTAL_PAGES を evaluationTime=report の別 textField に分ける。\n\n'
            + '■ Auto\nエンジンが最適なタイミングを選ぶ。評価タイミングを明示したい場合は now / band / page / group / report を優先して使う。',
    },
    'textField.evaluationGroup': {
        label: '評価グループ',
        description: 'evaluationTime=Groupの場合に評価を行うグループ名。',
    },
    'textField.textTruncate': {
        label: 'テキスト切り詰め',
        description: 'テキストが領域を超えた場合の切り詰め方式。なし: 切り詰めない。切り詰め: そのまま切断。省略記号（文字）: 文字単位で"..."付与。省略記号（単語）: 単語単位で"..."付与。',
    },

    // ========================
    // Line
    // ========================
    'line.lineWidth': {
        label: '線幅',
        description: '線の太さ（pt）。',
    },
    'line.lineStyle': {
        label: '線種',
        description: '線のスタイル。実線・破線・点線から選択。',
    },
    'line.lineColor': {
        label: '線色',
        description: '線の色。',
    },

    // ========================
    // Rectangle & ellipse
    // ========================
    'shape.radius': {
        label: '角丸半径（一括）',
        description: '矩形の全角の丸み半径を一括設定（pt）。0で直角。',
    },
    'shape.topLeftRadius': {
        label: '左上角丸半径',
        description: '矩形の左上角の丸み半径（pt）。',
    },
    'shape.topRightRadius': {
        label: '右上角丸半径',
        description: '矩形の右上角の丸み半径（pt）。',
    },
    'shape.bottomRightRadius': {
        label: '右下角丸半径',
        description: '矩形の右下角の丸み半径（pt）。',
    },
    'shape.bottomLeftRadius': {
        label: '左下角丸半径',
        description: '矩形の左下角の丸み半径（pt）。',
    },
    'shape.fillType': {
        label: '塗りの種類',
        description: '塗りなし、単色、線形グラデーション、放射グラデーションを選択。',
    },
    'shape.fill': {
        label: '塗り色',
        description: '図形の塗りつぶし色。',
    },
    'shape.gradientStops': {
        label: 'グラデーション停止点',
        description: 'グラデーションの色、位置、不透明度を設定。位置と不透明度は0から100の範囲。',
    },
    'shape.linearAngle': {
        label: '線形グラデーション角度',
        description: '線形グラデーションの向き（度）。',
    },
    'shape.linearX1': {
        label: '開始X',
        description: '線形グラデーションの開始X位置（要素幅に対する%）。',
    },
    'shape.linearY1': {
        label: '開始Y',
        description: '線形グラデーションの開始Y位置（要素高さに対する%）。',
    },
    'shape.linearX2': {
        label: '終了X',
        description: '線形グラデーションの終了X位置（要素幅に対する%）。',
    },
    'shape.linearY2': {
        label: '終了Y',
        description: '線形グラデーションの終了Y位置（要素高さに対する%）。',
    },
    'shape.radialCx': {
        label: '中心X',
        description: '放射グラデーション中心のX位置（要素幅に対する%）。',
    },
    'shape.radialCy': {
        label: '中心Y',
        description: '放射グラデーション中心のY位置（要素高さに対する%）。',
    },
    'shape.radialR': {
        label: '半径',
        description: '放射グラデーション半径（要素サイズに対する%）。',
    },
    'shape.stroke': {
        label: '枠線色',
        description: '図形の枠線の色。',
    },
    'shape.strokeWidth': {
        label: '枠線幅',
        description: '図形の枠線の太さ（pt）。',
    },

    // ========================
    // Path
    // ========================
    'path.anchorCount': {
        label: 'アンカー数',
        description: 'パスを構成するアンカー点の数。',
    },
    'path.edit': {
        label: 'パスを編集',
        description: 'パス編集モードを開始/終了。編集中はキャンバス上にアンカーポイントとハンドルが表示され、ドラッグで形状を変更、セグメントクリックでアンカー追加、Deleteでアンカー削除ができる。要素のダブルクリックでも開始でき、Escapeで終了する。',
    },
    'path.closed': {
        label: '閉じたパス',
        description: '始点と終点を接続して閉じた形状として扱う。',
    },
    'path.fillType': {
        label: '塗りの種類',
        description: '塗りなし、単色、線形グラデーション、放射グラデーションを選択。',
    },
    'path.fillColor': {
        label: '塗り色',
        description: '単色塗りに使用する色。',
    },
    'path.gradientStops': {
        label: 'グラデーション停止点',
        description: 'グラデーションの色、位置、不透明度を設定。位置と不透明度は0から100の範囲。',
    },
    'path.linearAngle': {
        label: '線形グラデーション角度',
        description: '線形グラデーションの向き（度）。',
    },
    'path.linearX1': {
        label: '開始X',
        description: '線形グラデーションの開始X位置（要素幅に対する%）。',
    },
    'path.linearY1': {
        label: '開始Y',
        description: '線形グラデーションの開始Y位置（要素高さに対する%）。',
    },
    'path.linearX2': {
        label: '終了X',
        description: '線形グラデーションの終了X位置（要素幅に対する%）。',
    },
    'path.linearY2': {
        label: '終了Y',
        description: '線形グラデーションの終了Y位置（要素高さに対する%）。',
    },
    'path.radialCx': {
        label: '中心X',
        description: '放射グラデーション中心のX位置（要素幅に対する%）。',
    },
    'path.radialCy': {
        label: '中心Y',
        description: '放射グラデーション中心のY位置（要素高さに対する%）。',
    },
    'path.radialR': {
        label: '半径',
        description: '放射グラデーション半径（要素サイズに対する%）。',
    },
    'path.stroke': {
        label: '線色',
        description: 'パスの線色。',
    },
    'path.strokeWidth': {
        label: '線幅',
        description: 'パスの線幅（pt）。',
    },
    'path.strokeCap': {
        label: '線端',
        description: '開いたパスの端の形状。',
    },
    'path.strokeJoin': {
        label: '線結合',
        description: '折れ曲がり箇所の結合形状。',
    },
    'path.strokeDashPreset': {
        label: '破線プリセット',
        description: 'よく使う破線配列を選択。',
    },
    'path.strokeDash': {
        label: '破線配列',
        description: '線分長と空白長をpt単位で交互に指定。空欄は実線。',
    },

    // ========================
    // Image
    // ========================
    'image.source': {
        label: '画像ソース',
        description: '画像ファイルの静的パス。ファイルパスまたはURLを指定。',
    },
    'image.sourceExpression': {
        label: '画像ソース式',
        description: '画像ソースを動的に指定する式。sourceよりも優先される。',
        references: EXPRESSION_REFERENCES,
        examples: ['"images/" + field.imageName', 'param.logoPath'],
    },
    'image.scaleMode': {
        label: 'スケールモード',
        description: '画像のスケーリング方式。クリップ: 元サイズで表示し、はみ出し部分を切り取る。フレームに合わせる: 要素サイズに合わせて伸縮（比率無視）。比率を維持: 要素内に収まる最大サイズで比率を維持。実寸: 元のピクセルサイズで表示。',
    },
    'image.hAlign': {
        label: '画像水平配置',
        description: '画像の水平方向の配置。スケールモードがクリップまたは比率維持の場合に有効。',
    },
    'image.vAlign': {
        label: '画像垂直配置',
        description: '画像の垂直方向の配置。スケールモードがクリップまたは比率維持の場合に有効。',
    },
    'image.onError': {
        label: '画像エラー時',
        description: '画像の読み込みに失敗した場合の動作。エラー: エラーを発生。空白: 何も表示しない。アイコン: エラーアイコンを表示。',
    },
    'image.lazy': {
        label: '遅延読み込み',
        description: '画像を遅延読み込み（レイジーロード）するかどうか。大量の画像がある場合にパフォーマンス向上に寄与。',
    },
    'image.lockAspectRatio': {
        label: 'アスペクト比を維持',
        description: 'エディタ上で画像要素をリサイズする際にアスペクト比（縦横比）を維持する。有効にすると、幅または高さの一方を変更したときに他方が自動的に調整される。',
    },

    // ========================
    // SVG
    // ========================
    'svg.svgContent': {
        label: 'SVGコンテンツ',
        description: 'インラインSVGマークアップ。<svg>タグを含む完全なSVGコードを記述する。',
    },

    // ========================
    // Barcode
    // ========================
    'barcode.barcodeType': {
        label: 'バーコードタイプ',
        description: 'バーコードの種類。1次元: Code39, Code128, EAN-13等。2次元: QRコード, DataMatrix, PDF417。',
    },
    'barcode.expression': {
        label: 'バーコードデータ式',
        description: 'バーコードに埋め込むデータの式。',
        references: EXPRESSION_REFERENCES,
        examples: ['field.productCode', 'field.url', '`PREFIX-${field.id}`'],
    },
    'barcode.showText': {
        label: 'テキスト表示',
        description: 'バーコードの下にデータのテキスト表現を表示するかどうか。1次元バーコードの場合に有効。',
    },
    'barcode.errorCorrectionLevel': {
        label: '誤り訂正レベル',
        description: 'QRコードの誤り訂正レベル。L: 7%回復。M: 15%回復。Q: 25%回復。H: 30%回復。レベルが高いほど読み取り耐性が上がるがデータ容量は減少。',
    },

    // ========================
    // Math formula
    // ========================
    'math.formula': {
        label: '数式 (LaTeX)',
        description: 'LaTeX形式の数式記述。KaTeX構文に準拠。',
        examples: ['\\frac{a}{b}', '\\sum_{i=1}^{n} x_i', 'E = mc^2'],
    },
    'math.fontFamily': {
        label: '数式フォント',
        description: '数式のフォントファミリー名。',
    },
    'math.fontSize': {
        label: '数式フォントサイズ',
        description: '数式のフォントサイズ（pt）。',
    },
    'math.color': {
        label: '数式色',
        description: '数式の描画色。',
    },

    // ========================
    // Break
    // ========================
    'break.breakType': {
        label: 'ブレークタイプ',
        description: '改ページ: 次のページに移行。改段: 段組み時に次の段に移行。',
    },

    // ========================
    // Subreport
    // ========================
    'subreport.templateExpression': {
        label: 'テンプレート式',
        description: 'サブレポートのテンプレートファイルパスを返す、設計時に確定可能な文字列式。設定後は参照先テンプレート内容をキャンバス上へ読み取り専用で描画し、循環参照になる値は受理しない。',
        references: EXPRESSION_REFERENCES,
        examples: ['"templates/detail.report"', "'subreports/invoice_detail.report'"],
    },
    'subreport.dataSourceExpression': {
        label: 'データソース式（サブレポート）',
        description: 'サブレポートに渡すデータソースを指定する式。',
        references: EXPRESSION_REFERENCES,
        examples: ['field.details', 'param.subData'],
    },

    // ========================
    // Table
    // ========================
    'table.borderColor': {
        label: 'テーブル外枠色',
        description: 'テーブルの外枠線の色。',
    },
    'table.borderWidth': {
        label: 'テーブル外枠幅',
        description: 'テーブルの外枠線の太さ（pt）。',
    },
    'table.innerColor': {
        label: 'テーブル内線色',
        description: 'テーブルの内部罫線の色。',
    },
    'table.innerWidth': {
        label: 'テーブル内線幅',
        description: 'テーブルの内部罫線の太さ（pt）。',
    },
    'table.column.backcolor': {
        label: '列背景色',
        description: '選択列に属するセルの既定背景色。セル側で上書き可能。',
    },
    'table.column.forecolor': {
        label: '列文字色',
        description: '選択列に属するセルの既定文字色。セル側で上書き可能。',
    },
    'table.column.borderWidth': {
        label: '列ボーダー幅',
        description: '選択列の既定ボーダー幅。セル側でさらに上書き可能。',
    },
    'table.cell.expression': {
        label: 'セル式',
        description: 'セルに表示する式。固定文字と両方入れた場合は式を優先して描画する。',
        references: EXPRESSION_REFERENCES,
        examples: ['field.amount', 'param.headerTitle', '`No.${field.no}`'],
    },
    'table.cell.backcolor': {
        label: 'セル背景色',
        description: '選択セルの背景色。',
    },
    'table.cell.forecolor': {
        label: 'セル文字色',
        description: '選択セルの文字色。',
    },
    'table.cell.borderWidth': {
        label: 'セルボーダー幅',
        description: '選択セルのボーダー幅。辺ごとの有効/無効と色・線種も編集できる。',
    },

    // ========================
    // Crosstab
    // ========================
    'crosstab.rowGroupField': {
        label: '行グループのフィールド',
        description: 'クロス集計の行方向のグループ化に使うフィールド名。複数指定で多段（外側→内側）にネストする。',
    },
    'crosstab.columnGroupField': {
        label: '列グループのフィールド',
        description: 'クロス集計の列方向のグループ化に使うフィールド名。複数指定で多段にネストする。',
    },
    'crosstab.measureField': {
        label: 'メジャーのフィールド',
        description: '集計対象のフィールド名。複数メジャーはデータセル内に縦に並ぶ。',
    },
    'crosstab.measureCalculation': {
        label: '集計方法',
        description: 'sum / count / average / min / max のいずれか。小計・総合計にも同じ集計方法が適用される。',
    },
    'crosstab.measureFormat': {
        label: '表示パターン',
        description: '集計値の書式パターン（例: #,##0）。',
    },
    'crosstab.rowHeaderWidth': {
        label: '行ヘッダー幅',
        description: 'クロス集計の行ヘッダー列の幅。',
    },
    'crosstab.columnHeaderHeight': {
        label: '列ヘッダー高さ',
        description: 'クロス集計の列ヘッダー行の高さ。',
    },
    'crosstab.cellWidth': {
        label: 'セル幅',
        description: 'クロス集計のデータセルの幅。',
    },
    'crosstab.cellHeight': {
        label: 'セル高さ',
        description: 'クロス集計のデータセルの高さ。',
    },
    'crosstab.borderColor': {
        label: 'クロス集計枠線色',
        description: 'クロス集計の枠線の色。',
    },
    'crosstab.borderWidth': {
        label: 'クロス集計枠線幅',
        description: 'クロス集計の枠線の太さ（pt）。',
    },
    'crosstab.showSubtotals': {
        label: '小計表示',
        description: '行グループ・列グループの小計を表示するかどうか。',
    },
    'crosstab.showGrandTotal': {
        label: '総計表示',
        description: '全体の合計（総計）を表示するかどうか。',
    },
    'crosstab.dataSourceExpression': {
        label: 'データソース式（クロス集計）',
        description: 'クロス集計に使用するデータソースを指定する式。',
        references: EXPRESSION_REFERENCES,
        examples: ['field.salesData', 'param.crosstabData'],
    },
}
