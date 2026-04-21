# V2 Phase 1-2 本番化検証チェックリスト

**対象リリース**: Learning App V2 Phase 1-2（Day 6-10）
**作成日**: 2026-04-22
**最終更新**: Day 10 実装完了時点

---

## 1. 実装完了確認

### コア実装（Day 6-10）

- [x] **Day 6**: `src/lib/pattern-analyzer.ts`（6 パターン検出エンジン）
- [x] **Day 7**: `src/lib/gemini-analysis.ts`（Gemini 補強 + fallback）
- [x] **Day 8**: `src/lib/storage.ts` + `/api/analysis/*`（CRUD + API）
- [x] **Day 9**: `AnalysisPanel.tsx` + `ParentReportPanel.tsx`（UI）
- [x] **Day 10**: `scheduler.ts` + `useAutoSaveAnalysis.ts` + `batch-analysis.ts`

### ファイルインベントリ

| カテゴリ | ファイル | 行数 |
|---|---|---|
| 型定義 | `src/lib/types/analysis.ts` | 286 |
| パターン検出 | `src/lib/pattern-analyzer.ts` | 667 |
| Gemini 統合 | `src/lib/gemini-analysis.ts` | 586 |
| Storage | `src/lib/storage.ts` | 421 |
| Scheduler | `src/lib/scheduler.ts` | 233 |
| Client Hook | `src/hooks/useAutoSaveAnalysis.ts` | 260 |
| API Route (日次) | `src/app/api/analysis/[subject]/route.ts` | 117 |
| API Route (週間) | `src/app/api/analysis/report/weekly/route.ts` | 95 |
| UI (子) | `src/components/AnalysisPanel.tsx` | 156 |
| UI (親) | `src/components/ParentReportPanel.tsx` | 200 |
| Batch CLI | `scripts/batch-analysis.ts` | 359 |

---

## 2. テスト結果

### 単体テスト（Vitest）

- [x] `pattern-analyzer.test.ts` - 49 テスト ✅
- [x] `gemini-analysis.test.ts` - 21 テスト ✅
- [x] `storage.test.ts` - 28 テスト ✅
- [x] `analysis-api.test.ts` - 14 テスト ✅
- [x] `scheduler.test.ts` - 34 テスト ✅

### 統合テスト

- [x] `integration.test.ts` - 13 テスト ✅
  - Scenario A: 当日分析フロー（会話 → 分析 → 保存 → 再読込）
  - Scenario B: 週間レポートフロー（5日 → 集約 → 親ガイダンス）
  - Scenario C: エラー耐性（Gemini 500 / タイムアウト → heuristic fallback）
  - Scenario D: コスト追跡 + スケジューリング（JST 20時判定、予算警告）
  - Scenario E: Storage メンテナンス（MVP 後方互換性）

### テスト合計

```
Test Files:  6 passed (6)
Tests:       159 passed (159)
Duration:    ~200ms
```

---

## 3. ビルド・品質

- [x] TypeScript コンパイル: **エラー 0**
- [x] Next.js build: **成功**（867ms）
- [x] ESLint: 0 errors（既存警告 2 件は Day 10 無関係）
- [x] 全 API エンドポイント動作確認（skipGemini、Gemini呼び出し、fallback）
- [x] Batch CLI 動作確認（daily, weekly, cost, help）

---

## 4. 仕様・要件の達成度

### 検出対象パターン（6種類）

| Pattern | 実装 | テスト |
|---|---|---|
| A: 同一質問繰り返し | ✅ | ✅ |
| B: 失敗→成功遷移 | ✅ | ✅ |
| C: 教科別マスタリー | ✅ | ✅ |
| D: 確信度低下 | ✅ | ✅ |
| E: ヒント依存 | ✅ | ✅ |
| F: 学習流暢性 | ✅ | ✅ |

### 2 層分析構造

| 実行 | 実装 | 検証 |
|---|---|---|
| 即時（毎日 20:00 JST） | `useAutoSaveAnalysis` + `decideSchedule` | ✅ |
| 週末（金曜 22:00 JST） | 同上（weekly branch） | ✅ |

### localStorage 互換性

- [x] MVP の `conversation_{subject}_{date}` キー **非改変**
- [x] 新キー `analysis_*`, `weekly_report_*` で独立空間
- [x] MVP 形式（timestamp なし）→ timestamped への透過変換

### Gemini API コスト管理

- [x] 日次推定 ¥30/日
- [x] 週間推定 ¥100/週
- [x] 月額閾値 ¥2,000
- [x] 80% 警告、100% 超過アラート
- [x] 月別サマリ出力（`cost` コマンド）

---

## 5. 本番環境デプロイ準備

### 必須環境変数

- [ ] `NEXT_PUBLIC_GEMINI_API_KEY` - Vercel Production に設定済み
- [ ] API キーは rotate 済み（4/19 セキュリティ対応で実施）

### デプロイ前確認

- [ ] `npm run build` ローカルで成功
- [ ] `npm test` 全合格（159/159）
- [ ] `.env.local` が `.gitignore` に含まれている
- [ ] `data/` ディレクトリが `.gitignore` に含まれている（batch 出力）

### デプロイ後確認

- [ ] Vercel Production URL で子向け UI 表示
- [ ] Chromebook（1280×800）でレイアウト崩れなし
- [ ] POST `/api/analysis/[subject]` 200 応答
- [ ] POST `/api/analysis/report/weekly` 200 応答
- [ ] 翌日 20:00 JST 経過後、localStorage に `analysis_*` キーが追加される

### 運用監視

- [ ] Gemini API コスト週次レビュー（GCP コンソール）
- [ ] エラー率追跡（Vercel Analytics or Sentry）
- [ ] Chromebook 実機テスト（お子さんの実使用）

---

## 6. 既知のリスクと対応状況

| リスク | 対策 | 状況 |
|---|---|---|
| Gemini API レスポンス遅延 | fallback で heuristic-only 返却 | ✅ 実装済 |
| パターン検出誤検知 | Gemini に意味的検証を委譲 | ✅ 実装済 |
| 子ども個差（ベースライン） | 将来の「学習ペース」パラメータで対応 | 🔜 V2.1 |
| 親ガイダンス抽象性 | `concreteResources` 欄で具体化 | ✅ 実装済 |
| localStorage 容量超過 | `pruneOldAnalysisData(30)` で自動削除 | ✅ 実装済 |
| Gemini API キー漏洩 | 4/19 rotate + fine-grained PAT | ✅ 対応済 |

---

## 7. 成功基準（Success Metrics）

| 指標 | 目標値 | 計測方法 | 現状 |
|---|---|---|---|
| パターン検出精度 | 85%+ | 親による評価 | 未計測（運用後） |
| Gemini API コスト | ¥2,000/月以内 | `batch:cost` | 設計内 ✅ |
| 子向け UI 応答時間 | 5秒以内 | Chrome DevTools | 未計測 |
| 親向けレポート生成 | 60秒以内 | Chrome DevTools | 未計測 |
| Chromebook 動作 | 30fps+ | Lighthouse | 未計測 |
| 親の実行率 | 70%+ | フィードバック | 未計測（運用後） |

---

## 8. Next Steps

### V2.1 候補（将来改善）

1. **Vercel Cron 連携**（サーバーサイド定時実行）
2. **学習ペースベースライン**（初回使用時の調整）
3. **E2E テスト**（Playwright - Chromebook viewport）
4. **グラフライブラリ導入**（Chart.js、recharts 等）
5. **Screenshot 分析**（宿題写真 → Gemini マルチモーダル）
6. **Google Classroom 連携**

### 継続監視項目

- Gemini API コスト（毎週末 `cost` コマンド）
- パターン検出精度（お子さんからのフィードバック）
- UI 反応（Chromebook 実機）

---

## 9. サインオフ

- [ ] 実装者（Claude）: Day 6-10 全実装完了、159 テスト合格
- [ ] レビュワー（AG）: ___________
- [ ] デプロイ承認: ___________
- [ ] 本番稼働開始日: ___________

---

**このチェックリストは V2 Phase 1-2 リリース時点の最終版です。**
