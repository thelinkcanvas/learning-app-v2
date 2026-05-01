---
name: テンプレート画像生成
description: Gemini Nano Banana 2 で教材テンプレ画像（WebP 1280×800 ≤200KB）を自動生成
type: skill
trigger: manual / batch
---

# テンプレート画像生成スキル

## 目的

小学 1-6 年生向けの教材テンプレート画像を、Gemini 3.1 Flash Image
(Nano Banana 2) で自動生成する。出力は厳密な仕様に従う：

- **WebP 形式**
- **1280 × 800 ピクセル**（アスペクト比 16:10）
- **200KB 以下**
- **教科書品質の日本語テキスト**（漢字・ひらがな）

## アーキテクチャ

```
[CLI: scripts/generate-template-image.ts]
        ↓
[1] prompt-templates.ts   ← 教科×学年からプロンプト生成
        ↓
[2] image-generator.ts    ← Gemini API (2K, 16:9, thinkingLevel:high) + 3層フォールバック
        ↓
[3] image-pipeline.ts     ← Sharp で center-crop → 1280×800 → WebP q80 (≤200KB)
        ↓
public/images/{subject}/g{grade}-{subject}-v{variation}.webp
```

### 設計の核心

| レイヤ | なぜ必要か |
|--------|-----------|
| **オーバーサンプリング (2K → 1280×800)** | API は 1280×800 をネイティブ対応していない。リサイズ品質を保つため大きく作って縮める |
| **center-crop (16:9 → 16:10)** | 教材テンプレの「日の丸構図」前提で安全にクロップ可能 |
| **WebP q80 + autoShrink** | 予測符号化で SSIM を保ったまま JPEG 比 25-34% 削減。超過時は q70→q60 で再エンコード |
| **3 層モデルフォールバック** | レート制限・safety block・キャパ不足時も継続稼働 |

## 実行方法

### 単発生成
```bash
# 算数・小3
npm run generate-template -- --subject math --grade 3

# 国語・小1（タイトル指定）
npm run generate-template -- --subject japanese --grade 1 --title "ことば"

# バリエーション指定（同教科で別構図）
npm run generate-template -- --subject science --grade 4 --variation 2
```

### 一括生成（夜間バッチ向け）
```bash
# 4教科 × 6学年 = 24枚
npm run generate-templates:all

# プロンプトだけ確認（API 呼ばない）
npm run generate-templates:dry
```

### 検証
```bash
# 生成後の仕様準拠を再確認
npm run validate-images
```

## プロンプト設計の原則（Research Prompt 1 由来）

1. **二段階言語**: 指示は英語、出力テキストは日本語
2. **リテラル指定**: 描画する文字列はダブルクォート `"算数"` で囲む
3. **10 文字以下ルール**: 描画日本語は短く（98% 精度ライン）
4. **UD デジタル教科書体を明示**: ユニバーサルデザインで児童の可読性確保
5. **"Children's book illustration" 禁止**: 装飾ノイズが増える → "Flat vector design"
6. **"top to bottom" 強調**: 縦書き要求時は明示しないと 90 度回転する
7. **Image Search Grounding**: 地図・国旗など事実精度が必要なら "Use image search" を冒頭に

## エラー処理

| ステータス | 対応 |
|-----------|------|
| 429 / 503 / 504 | 指数バックオフ + ジッター（initialBackoffMs=2000） |
| 400 (FAILED_PRECONDITION) | 即停止。Billing/モデル名/API キー確認 |
| 200 + finishReason=SAFETY | safety block。プロンプト見直し（即時失敗） |
| 全モデル失敗 | エラー終了。CDN ベーステンプレへの手動切り戻し |

## コスト

| 用途 | 推奨モデル | 単価 | 月 24 枚 |
|------|-----------|------|---------|
| 夜間バッチ | Nano Banana 2 (Batch) | $0.034 | $0.82 |
| インタラクティブ | Nano Banana 2 (Standard 1K) | $0.067 | - |
| 緊急フォールバック | Gemini 2.5 Flash Image | 同等 | - |

> **注**: 現在の実装は Standard API 経由。Batch API への切り替えは
> `image-generator.ts` の URL を `:batchGenerateContent` に変更し、
> 非同期ポーリングを実装する（V1.1 候補）。

## チェックリスト

- [x] WebP 1280×800 ≤200KB の決定論的保証（Sharp）
- [x] 教科×学年プロンプトテンプレート（4×6 = 24 種）
- [x] thinkingLevel: high で空間推論精度確保
- [x] 3 層モデルフォールバック
- [x] 指数バックオフ + ジッター
- [x] safety block の専用ハンドリング
- [ ] OCR ベースのテキスト精度自動検証（将来）
- [ ] Batch API 移行でコスト 50% 削減（V1.1）

## 関連ファイル

- `src/lib/image-pipeline.ts` - Sharp 後処理
- `src/lib/prompt-templates.ts` - 教科別プロンプト
- `src/lib/image-generator.ts` - Gemini API 呼び出し
- `scripts/generate-template-image.ts` - CLI エントリー
- `scripts/validate-images.ts` - 既存の事後検証スキル
