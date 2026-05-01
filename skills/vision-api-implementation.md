---
name: Vision API 実装ロードマップ
description: Phase A 完了後の Phase B/C 実装手順
type: implementation-plan
status: phase-A-complete-phase-B-pending
related_spec: skills/vision-api-spec.md
---

# Vision API 実装ロードマップ

## Phase A: 仕様 + 型 + プロンプト (✅ 完了)

| # | ファイル | ステータス | 行数 |
|---|---------|-----------|------|
| 1 | `skills/vision-api-spec.md` | ✅ 作成済 | ~370 |
| 2 | `src/lib/types/vision.ts` | ✅ 作成済 | ~270 |
| 3 | `src/lib/vision/json-schema.ts` | ✅ 作成済 | ~330 |
| 4 | `src/lib/vision/prompts.ts` | ✅ 作成済 | ~310 |
| 5 | `skills/vision-api-implementation.md` | ✅ 作成済 (本ファイル) | ~150 |

**Phase A 検証**:
- ✅ TypeScript 型チェック クリア (`npx tsc --noEmit`)
- ✅ Phase B 実装に必要な API 表面が確定

## Phase B: 実装本体 (次セッション以降)

### 依存関係グラフ

```
   types/vision.ts (✅)
        ↑
        ├── vision/json-schema.ts (✅)
        ├── vision/prompts.ts (✅)
        ├── vision/api-client.ts ← Phase B-1
        ├── vision/spatial-reasoning.ts ← Phase B-2
        ├── vision/image-quality.ts ← Phase B-3
        ├── vision/cache.ts ← Phase B-4
        └── vision/socratic-engine.ts ← Phase B-5
```

### Phase B-1: api-client.ts (~200 行)

**目的**: Gemini Vision API を呼び出す統一クライアント

**実装ポイント**:
- `gemini.ts` のパターンを踏襲 (fetch ベース、SDK 不使用)
- `response_mime_type: 'application/json'` を強制
- `response_schema: VISION_RESPONSE_SCHEMA` を渡す
- `temperature: 0.1` (情報抽出向けに幻覚抑制)
- `categorizeApiError` を classroom/error-handling.ts から流用
- ジッター付き指数バックオフでリトライ
- レスポンスは `validateVisionResponse` でバリデート

**主要関数**:
```typescript
async function analyzeImage(
  request: VisionRequest,
  options?: VisionRequestOptions
): Promise<VisionApiResponse>
```

**エラー時のフォールバック**:
- 400 → ローカルログ + UI に「画像形式エラー」表示
- 429 → 指数バックオフ
- 5xx → 3 回リトライ後、UI に「あとでもう一度試してね」表示

### Phase B-2: spatial-reasoning.ts (~120 行)

**目的**: 正規化座標 ↔ 絶対座標の双方向変換

**実装関数**:
```typescript
descaleBoundingBox(
  normalizedBox: NormalizedBoundingBox,
  imageWidth: number,
  imageHeight: number
): AbsoluteBoundingBox

scaleBoundingBox(
  absoluteBox: AbsoluteBoundingBox,
  imageWidth: number,
  imageHeight: number
): NormalizedBoundingBox

createOverlaysFromVisionResult(
  result: VisionAnalysisResult,
  imageWidth: number,
  imageHeight: number
): BoundingBoxOverlay[]
```

**テスト観点**:
- 既知座標 [200, 150, 350, 600] + 画像 1280×800 → 既知絶対座標
- 双方向変換のラウンドトリップ誤差 ≤ 1px
- 範囲外座標で例外

### Phase B-3: image-quality.ts (~150 行)

**目的**: クライアント側の事前検証

**実装関数**:
```typescript
async assessLocalQuality(
  imageBlob: Blob
): Promise<LocalImageQualityCheck>

async compressIfNeeded(
  imageBlob: Blob,
  maxDimension?: number,
  quality?: number
): Promise<Blob>

calculateLaplacianVariance(imageData: ImageData): number
calculateMeanBrightness(imageData: ImageData): number
```

**実装メモ**:
- ブラウザ環境前提 (Canvas API 使用)
- ラプラシアン分散は 3×3 カーネルで近似計算
- 圧縮は Canvas → toBlob で JPEG q=0.85
- Sharp (Node.js のみ) は不使用

### Phase B-4: cache.ts (~100 行)

**目的**: ローカル画像キャッシュ (再撮影時の API 節約)

**実装関数**:
```typescript
async hashImage(blob: Blob): Promise<string>  // SHA-256
async getCached(hash: string): Promise<VisionAnalysisResult | null>
async setCached(hash: string, result: VisionAnalysisResult): Promise<void>
async cleanupExpired(): Promise<number>  // 期限切れ削除
```

**実装メモ**:
- localStorage か IndexedDB (5MB 超の可能性あり → IndexedDB 推奨)
- TTL 1 時間 (LOCAL_CACHE_TTL_MS)
- ハッシュ衝突対策: 最後に hash + width + height で複合キー

### Phase B-5: socratic-engine.ts (~250 行)

**目的**: Vision の結果を context にしてソクラテス式対話を駆動

**実装関数**:
```typescript
async startDialogue(
  vision: VisionAnalysisResult,
  stumblingPointId: string,
  childGrade?: number
): Promise<{ state: SocraticDialogueState; firstQuestion: string }>

async continueDialogue(
  state: SocraticDialogueState,
  childResponse: string
): Promise<{ state: SocraticDialogueState; nextQuestion: string }>

async classifyChildResponse(
  response: string
): Promise<ChildResponseClassification>
```

**実装メモ**:
- `gemini.ts` の `callGeminiAPI` を流用
- システムプロンプトは `buildSocraticSystemPrompt`
- 児童発話分類は軽量モデル (Flash-Lite) で並列実行
- モード遷移は `determineNextSocraticMode` を使用
- 状態は localStorage に保存 (storage.ts 流用可能)

### Phase B-6: pattern-analyzer 統合 (~50 行)

**目的**: VisionAnalysisResult を pattern-analyzer.ts へ橋渡し

**実装場所**: `src/lib/vision/analyzer-bridge.ts` (新規)

```typescript
import { MasteryMap } from '../types/analysis';
import { VisionAnalysisResult, VisionMasteryUpdate } from '../types/vision';

export function visionToMasteryUpdate(
  vision: VisionAnalysisResult
): VisionMasteryUpdate

export function mergeVisionIntoMastery(
  existing: MasteryMap,
  vision: VisionAnalysisResult
): MasteryMap
```

## Phase B 完了後の動作確認スクリプト

`scripts/vision-test.ts` (CLI) を作成:

```bash
npm run vision -- analyze --image ./test-images/grade1-math.jpg
# → JSON 出力 + 検出された stumbling_points を表示

npm run vision -- socratic --image ./test-images/grade1-math.jpg --grade 1
# → Vision 解析 → 対話モードに入る (CLI で 5 ターンまで)
```

## Phase C: UI + 高度機能 (将来)

### C-1: HITL UI (React コンポーネント)
- `src/app/components/BoundingBoxOverlay.tsx`
- `src/app/components/MarkAdjuster.tsx` (ドラッグで調整)
- `src/app/components/ConfirmationPanel.tsx`

### C-2: Japanese Textbook LOD マッピング
- `src/lib/vision/lod-mapper.ts`
- w3id.org/jp-textbook の SPARQL クエリ
- unit_name → 学習指導要領コード変換

### C-3: PII マスキング (TensorFlow.js)
- `src/lib/vision/pii-masker.ts`
- ブラウザ内テキスト検出 → 黒塗り
- EXIF メタデータ削除

### C-4: Explicit Caching (大規模 PDF 対応)
- `cache.ts` 拡張で `ai.caches.create` 利用
- TTL 1 時間、教科書 PDF 全体をキャッシュ

## Phase B 開始時のチェックリスト

次セッションで Phase B を始める前に確認:

- [ ] `GOOGLE_API_KEY` または `NEXT_PUBLIC_GEMINI_API_KEY` が `.env.local` に設定済み
- [ ] テスト用画像 (5 教科 × 3 学年) が `test-images/` にある
- [ ] `src/lib/types/vision.ts` の型定義を確認 (変更なし前提)
- [ ] `src/lib/vision/json-schema.ts` のスキーマを確認
- [ ] `src/lib/vision/prompts.ts` のプロンプトを確認
- [ ] gemini-3.1-pro-vision モデルへのアクセス権がある (なければ gemini-2.5-flash で代替)

## 推定実装時間 (Phase B)

| サブフェーズ | 行数 | 推定時間 | Token 消費 |
|------------|------|---------|----------|
| B-1 api-client | 200 | 30 分 | ~3,500 |
| B-2 spatial-reasoning | 120 | 15 分 | ~2,000 |
| B-3 image-quality | 150 | 20 分 | ~2,500 |
| B-4 cache | 100 | 15 分 | ~1,800 |
| B-5 socratic-engine | 250 | 45 分 | ~4,500 |
| B-6 analyzer-bridge | 50 | 10 分 | ~1,000 |
| テストスクリプト | 100 | 15 分 | ~2,000 |
| **合計** | **~970** | **~150 分** | **~17,000** |

## Phase B の依存関係 (実装順序)

```
1. api-client.ts (他は依存しない)
   ↓
2. spatial-reasoning.ts (api-client なしでテスト可)
   ↓
3. image-quality.ts (独立、ブラウザ依存)
   ↓
4. cache.ts (独立、storage.ts 流用)
   ↓
5. analyzer-bridge.ts (api-client.ts に依存)
   ↓
6. socratic-engine.ts (api-client.ts + prompts.ts に依存)
   ↓
7. テストスクリプト (全部に依存)
```

## 関連ファイル

- 完全仕様: `skills/vision-api-spec.md`
- 型定義: `src/lib/types/vision.ts`
- JSON スキーマ: `src/lib/vision/json-schema.ts`
- プロンプト: `src/lib/vision/prompts.ts`
- 既存 Gemini クライアント (参考): `src/lib/gemini.ts`
- 既存エラーハンドリング (参考): `src/lib/classroom/error-handling.ts`
- 既存ストレージ (参考): `src/lib/storage.ts`
