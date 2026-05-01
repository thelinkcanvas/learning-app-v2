---
name: Gemini Vision API 仕様書
description: マルチモーダルAIによるソクラテス式学習支援パイプラインの完全仕様
type: specification
status: phase-A-spec-complete
source: Research Prompt 4
related_files:
  - src/lib/types/vision.ts (Phase A)
  - src/lib/vision/json-schema.ts (Phase A)
  - src/lib/vision/prompts.ts (Phase A)
  - src/lib/vision/api-client.ts (Phase B - 実装予定)
  - src/lib/vision/spatial-reasoning.ts (Phase B - 実装予定)
  - src/lib/vision/socratic-engine.ts (Phase B - 実装予定)
  - src/lib/vision/image-quality.ts (Phase B - 実装予定)
---

# Gemini Vision API 統合仕様書

## 1. 目的とユースケース

学習者が学習中に教科書・問題集の写真をアプリで撮影し、「分からない箇所を丸で囲む」というアナログな行動をトリガーに、AIが「どこで何につまずいているか」を空間的・意味的に認識する。
抽出された認知的障害を pattern-analyzer.ts に渡し、ソクラテス式問答による学習支援を提供する。

### ユーザーフロー
```
[児童]
  ↓ 教科書を開き、分からない問題を鉛筆で○で囲む
  ↓ アプリで写真を撮る
[クライアント]
  ↓ 画像品質チェック (ブレ・暗さ・対象判定)
  ↓ ローカルでハッシュ計算 → 既存キャッシュ参照判定
  ↓ PII マスキング (名前等のローカル前処理)
[Gemini Vision API]
  ↓ JSON 構造化出力で stumbling_points 抽出
  ↓ box_2d 正規化座標 (0-1000) を返却
[クライアント側ポストプロセス]
  ↓ box_2d を画像ピクセル座標へ逆スケール
  ↓ HITL UI で「この箇所で合ってる？」と確認
[pattern-analyzer.ts]
  ↓ stumbling_points を受け取り mastery を更新
[Gemini Text (Socratic Engine)]
  ↓ extracted_problem, identified_concept, cognitive_issue を context に注入
  ↓ ソクラテス式プロンプトで対話開始
  ↓ 状態管理: 探索 → 詳細化 → 足場架け
```

## 2. アーキテクチャ全体図

```
┌─────────────────────── Client (Next.js) ───────────────────────┐
│                                                                 │
│  [Camera Input] ──→ [image-quality.ts] ──→ [PII Masking]       │
│       │                  ブレ/暗さ              ローカル        │
│       │                  検出                                   │
│       ↓                                                         │
│  [Image Hash Cache] ────────→ [Skip if cached]                 │
│       │                                                         │
│       ↓                                                         │
│  [Vision Request Builder]                                      │
│       │ - response_mime_type: application/json                  │
│       │ - response_schema: VisionAnalysisResult                 │
│       │ - temperature: 0.1                                      │
└───────┼──────────────────────────────────────────────────────────┘
        ↓ TLS
┌─────────────────────── Gemini Vision API ──────────────────────┐
│  Gemini 3.1 Pro (Phase A)                                      │
│   → 高精度の box_2d 抽出と意味推論                              │
│  Gemini 3.1 Flash-Lite (チャット段階)                          │
│   → 安価な対話処理                                              │
└───────┬──────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────── Pipeline (server) ──────────────────────┐
│                                                                 │
│  [JSON Validator] (json-schema.ts)                             │
│       ↓                                                         │
│  [Coordinate Descaler] (spatial-reasoning.ts)                  │
│   normalized (0-1000) → absolute (px)                          │
│       ↓                                                         │
│  [pattern-analyzer.ts integration]                             │
│   stumbling_points → MasteryMap 更新                            │
│       ↓                                                         │
│  [Socratic Engine] (socratic-engine.ts)                        │
│   状態: exploratory / details / scaffolding                    │
│   制約: ask-don't-answer, step-by-step, interrogate            │
└───────┬──────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────── Client (HITL UI) ───────────────────────┐
│  [Bounding Box Overlay] - 半透明で box_2d を描画                │
│  [Drag to Adjust] - 児童が指で箱を調整可能                      │
│  [Confirm Button] - 「ここで合ってるね！」                      │
└─────────────────────────────────────────────────────────────────┘
```

## 3. JSON スキーマ完全定義

### 3.1 VisionAnalysisResult (Vision API レスポンス)

```typescript
{
  "type": "object",
  "properties": {
    "document_metadata": {
      "type": "object",
      "properties": {
        "subject": {
          "type": "string",
          "enum": ["国語", "算数", "理科", "社会", "英語", "生活", "不明"]
        },
        "unit_name": {
          "type": "string",
          "description": "教科書の上部ヘッダから抽出した単元名"
        },
        "grade_estimate": {
          "type": "integer",
          "minimum": 1,
          "maximum": 6,
          "description": "問題の難易度から推定した学年（不明な場合は 0）"
        },
        "page_type": {
          "type": "string",
          "enum": ["textbook", "workbook", "notebook", "test", "unknown"]
        }
      },
      "required": ["subject", "unit_name"]
    },
    "stumbling_points": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "mark_id": {
            "type": "string",
            "description": "一意ID (例: mark-001)"
          },
          "mark_type": {
            "type": "string",
            "enum": ["circle", "underline", "question_mark", "cross", "triangle", "tick"]
          },
          "box_2d": {
            "type": "array",
            "items": { "type": "integer" },
            "minItems": 4,
            "maxItems": 4,
            "description": "[ymin, xmin, ymax, xmax] 各値は 0-1000 に正規化"
          },
          "extracted_problem": {
            "type": "string",
            "description": "マークが囲んでいる問題文・数式・単語のテキスト"
          },
          "identified_concept": {
            "type": "string",
            "description": "つまずきの背後にある教育概念 (例: '分数の割り算', '光の屈折')"
          },
          "cognitive_issue": {
            "type": "string",
            "description": "認知的に何が問題か (例: '分母分子の意味理解不足', '計算ミスではなく概念混乱')"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "AI の認識信頼度 (0.7 未満は HITL 確認推奨)"
          }
        },
        "required": ["mark_id", "mark_type", "box_2d", "extracted_problem", "identified_concept", "cognitive_issue"]
      }
    },
    "image_quality": {
      "type": "object",
      "properties": {
        "is_educational_content": { "type": "boolean" },
        "is_readable": { "type": "boolean" },
        "warnings": {
          "type": "array",
          "items": { "type": "string" }
        }
      },
      "required": ["is_educational_content", "is_readable"]
    }
  },
  "required": ["document_metadata", "stumbling_points", "image_quality"]
}
```

### 3.2 SocraticDialogueState (対話状態)

```typescript
{
  "session_id": "string",
  "stumbling_point_id": "string",  // 紐づく mark_id
  "mode": "exploratory" | "details" | "scaffolding",
  "turn_count": "number",
  "child_response_history": [
    { "turn": 1, "content": "...", "classified_as": "vague|concrete|stuck|correct" }
  ],
  "concept_understanding_score": "number",  // 0-1
  "next_question_strategy": "deepen|broaden|simplify|conclude"
}
```

## 4. プロンプトエンジニアリング仕様

### 4.1 Vision API システムプロンプト

```
あなたは小学生の学習教材を解析する視覚 AI です。
画像内の手書き注釈（丸・下線・疑問符）を検出し、児童がどの問題でつまずいているかを特定してください。

【検出対象の手書き記号】
- 丸 (○): 強調・未知の語彙・気になる箇所
- 下線: 重要箇所・疑問のある単語
- 疑問符 (?): 明示的な疑問
- バツ (×): 不正解と認識した箇所
- 三角 (△): 部分的に理解できている箇所
- チェック (✓): 日本のコンテキストでは「要確認」と解釈

【座標系】
box_2d は [ymin, xmin, ymax, xmax] 形式、各値を 0-1000 に正規化。
画像左上が (0, 0)、右下が (1000, 1000)。

【出力ルール】
- response_schema に厳密に従う
- 確信度 (confidence) を 0-1 で必ず付与
- 印刷文字でも、児童が理解しているかどうかは判定しない
- マークが無い場合は stumbling_points を空配列で返す

【禁止事項】
- 解答や解説を出力に含めない (これは Vision フェーズ)
- 児童の名前等の PII をテキスト抽出に含めない
- 関係ない画像 (おもちゃ等) は image_quality.is_educational_content = false で返す
```

### 4.2 教科別追加プロンプト

```typescript
const SUBJECT_HINTS = {
  '算数': '数式は LaTeX で extracted_problem に記録。途中式があれば各ステップを評価。',
  '国語': '縦書き・横書きの読み取り順序を維持。ルビ (振り仮名) は () 内に記録。',
  '理科': '図表・グラフは関係性を意味的に記述 (例: "矢印が示すエネルギー伝達方向")。',
  '社会': '地図・表は固有名詞を正確に。地図記号は名称で記録。',
};
```

### 4.3 Socratic Engine システムプロンプト

```
あなたは小学生の家庭教師です。視覚 AI が児童のつまずきを以下のように特定しました:

【検出された問題】
{{ extracted_problem }}

【教科 / 単元】
{{ subject }} / {{ unit_name }}

【推定された認知的問題】
{{ cognitive_issue }}

【絶対遵守ルール】
1. 解答を直接教えない (Ask, Don't Answer)
2. 1 回の返答に質問は 1 つだけ (Step-by-step)
3. 児童が間違えても即座に否定しない、理由を問う (Interrogate Assumptions)
4. 児童が「わからない」と言ったら、ハードルを 1 段下げる (Scaffolding)

【現在の対話モード】 {{ mode }}
- exploratory: 児童の現状理解を確認する開かれた質問
- details: 抽象的な答えに対し具体化を求める
- scaffolding: 行き詰まり対応、類題や視覚的アナロジーを提示

【返答形式】
- 1 文の質問のみ
- 絵文字なし
- 漢字は学年相当のもの (grade_estimate を参照)
```

## 5. 座標逆スケール仕様 (spatial-reasoning.ts)

### 5.1 正規化 → 絶対座標変換

```typescript
function descaleBoundingBox(
  normalizedBox: [number, number, number, number],  // [ymin, xmin, ymax, xmax]
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = normalizedBox;
  
  const absX = Math.floor((xmin / 1000) * imageWidth);
  const absY = Math.floor((ymin / 1000) * imageHeight);
  const absWidth = Math.floor(((xmax - xmin) / 1000) * imageWidth);
  const absHeight = Math.floor(((ymax - ymin) / 1000) * imageHeight);
  
  return { x: absX, y: absY, width: absWidth, height: absHeight };
}
```

### 5.2 検証ルール

- ymin < ymax かつ xmin < xmax (順序チェック)
- 全ての値が 0 ≤ v ≤ 1000 (範囲チェック)
- 面積が画像の 0.5% 以上 (極小ボックスは誤検知の可能性大)
- 面積が画像の 80% 未満 (画像全体は意味なし)

## 6. キャッシング戦略 (Phase B)

### 6.1 Implicit Caching の活用

リクエスト構造を「不変要素を先頭、変動要素を末尾」に統一:

```typescript
const requestParts = [
  { text: SYSTEM_INSTRUCTION },        // 不変 (常に先頭)
  { inlineData: { data: imageBase64 } }, // 不変 (画像は同じならキャッシュヒット)
  { text: SUBJECT_HINTS[subject] },    // 教科別の固定文
  { text: userQuery },                 // 変動 (毎ターン異なる)
];
```

### 6.2 Explicit Caching (大規模教材時)

```typescript
// TTL 1 時間で cachedContent オブジェクトを作成
const cache = await ai.caches.create({
  model: 'gemini-3.1-pro-vision',
  config: {
    contents: [textbookPdfPart],
    ttl: '3600s',
    displayName: `textbook-${grade}-${subject}-${unit}`,
  },
});

// 以降のリクエストで cache.name を参照
```

### 6.3 ローカル画像ハッシュキャッシュ

```typescript
interface LocalImageCache {
  hash: string;           // SHA-256 of image
  visionResult: VisionAnalysisResult;
  cachedAt: number;       // Date.now()
  ttlMs: number;          // 1時間
}

// localStorage または IndexedDB に保存
const cacheKey = `vision_${sha256(imageBase64)}`;
```

## 7. エラーハンドリング (image-quality.ts + api-client.ts)

### 7.1 クライアント側事前検証

| 検査項目 | 閾値 | アクション |
|---------|-----|-----------|
| ラプラシアン分散 (ブレ) | < 100 | 「ピント合わせて撮り直して」UI |
| 平均輝度 (暗さ) | < 50 / 255 | ヒストグラム均等化 → 再評価 |
| ファイルサイズ | > 5 MB | 自動圧縮 (長辺 1600px, JPEG q=85) |
| アスペクト比 | < 0.3 or > 3.0 | 「ページ全体が写るように」UI |

### 7.2 API エラー対応

| ステータス | 対応 |
|-----------|------|
| 400 INVALID_ARGUMENT | リクエスト形式エラー、ローカルログ |
| 429 RESOURCE_EXHAUSTED | 指数バックオフ + ジッター |
| 503 UNAVAILABLE | 3回まで自動リトライ |
| 5xx | 5分後に再試行を提案 |
| `is_educational_content: false` | 「お勉強のページを撮ってね」UI |

## 8. プライバシー保護 (Phase B)

### 8.1 ローカル PII マスキング

撮影直後にクライアントで実行:
1. 画像端の 10% 領域を自動クロップ (机の周り、児童の手等を除去)
2. ローカル軽量モデル (TensorFlow.js) で「名前らしいテキスト」を検出 → 黒塗り
3. EXIF メタデータ削除 (位置情報等)

### 8.2 ハイブリッド推論フロー

```
[Local] 画像撮影
   ↓
[Local] PII マスキング + 品質検証
   ↓
[Local] 画像ハッシュ計算 → キャッシュ判定
   ↓ (キャッシュミスのみ)
[Cloud Gemini Pro Vision] 高精度 box_2d 抽出
   ↓ (JSON のみ返却、画像は破棄)
[Local] 座標逆スケール + HITL UI
   ↓
[Cloud Gemini Flash-Lite] 軽量 Socratic 対話
```

## 9. pattern-analyzer.ts との統合

### 9.1 データフロー

```typescript
// VisionAnalysisResult を pattern-analyzer 用に変換
function visionToMasteryUpdate(
  vision: VisionAnalysisResult,
  studentId: string
): Partial<MasteryMap> {
  return {
    [vision.document_metadata.subject]: {
      [vision.document_metadata.unit_name]: {
        stumbling_count: vision.stumbling_points.length,
        last_seen_concepts: vision.stumbling_points.map(s => s.identified_concept),
        last_cognitive_issues: vision.stumbling_points.map(s => s.cognitive_issue),
        last_analyzed_at: Date.now(),
      },
    },
  };
}
```

### 9.2 Japanese Textbook LOD マッピング (Phase C 以降)

`unit_name` を w3id.org/jp-textbook の RDF と照合 → 学習指導要領コードへ正規化。
将来は同コードに紐づく類題を自動提示。

## 10. Phase A 実装範囲 (今セッション)

| ファイル | 役割 | 行数目安 |
|---------|------|---------|
| `src/lib/types/vision.ts` | TypeScript 型定義 | ~150 |
| `src/lib/vision/json-schema.ts` | JSON スキーマ定数 + バリデータ | ~200 |
| `src/lib/vision/prompts.ts` | プロンプトテンプレート | ~250 |
| `skills/vision-api-spec.md` | 本仕様書 | (このファイル) |
| `skills/vision-api-implementation.md` | 実装ロードマップ | ~150 |

### Phase A 完了時の成果物
- ✅ Phase B (実装) で必要な型・スキーマ・プロンプトが揃う
- ✅ 次セッションで「仕様書から実装」が可能
- ✅ pattern-analyzer.ts との連携 I/F が確定

## 11. Phase B 実装範囲 (次セッション以降)

| ファイル | 役割 | 行数目安 | 依存 |
|---------|------|---------|------|
| `src/lib/vision/api-client.ts` | Gemini Vision API 呼び出し | ~200 | gemini.ts |
| `src/lib/vision/spatial-reasoning.ts` | 座標逆スケール | ~120 | types/vision.ts |
| `src/lib/vision/socratic-engine.ts` | 対話エンジン | ~250 | gemini.ts, prompts.ts |
| `src/lib/vision/image-quality.ts` | 品質検証 | ~150 | (Sharp はサーバー側のみ) |
| `src/lib/vision/cache.ts` | ローカルキャッシュ | ~100 | storage.ts |

## 12. Phase C (将来拡張)

- React HITL UI コンポーネント
- Japanese Textbook LOD マッピング
- TensorFlow.js による PII マスキング
- Cloud Tasks 経由の非同期処理

## 13. テスト観点

### 13.1 Phase A
- 型定義: tsc で型エラーなし
- JSON スキーマ: ajv で validate 動作

### 13.2 Phase B
- 座標変換: 既知座標で逆スケール一致
- プロンプト: snapshot test で内容固定
- API クライアント: モックレスポンスで正常/異常系

### 13.3 統合
- 教科書サンプル画像 (5 教科 × 3 学年) で box_2d 抽出精度 > 80%
- ソクラテス式: 「答えを言わない」テスト (ground truth と LLM judge)
