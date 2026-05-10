# decisions.md (learning-app-project Project)

<!-- フォーマット: 日付 / 状況 / 判断内容 / 理由 -->
<!--
このファイルは AG Governance v5.0 Layer P (Project Skills) として運用されます。
learning-app-project 固有の判断をここに記録してください。

既存の learning-app 関連判断は Global skills (/AG_Root/Antigravity/skills/decisions.md)
に残されています。今後の新規判断のみここに追記してください。

アーキテクチャ全体に関わる判断（AG Governance / 全プロジェクト共通の方針）は Global に追記し、
learning-app 固有のもの（Gemini モデル選定 / Classroom スコープ等）はここに追記する判断を心がけてください。
-->

## 2026-05-11 / adaptive question depth コミット漏れの修復方針
**状況**: 5/3 commit `d6c0fd4` で実装記録だけしてあったが、本体コードは untracked のまま。本番（5/2 デプロイの bee0d03）には未反映。本日新たに `7fcf972` として実装本体を commit + push し、`vercel --prod --yes` で再デプロイした。
**判断**: --amend や rebase で 5/3 の commit を遡及修正せず、**新規 commit として今日の日付で記録**した。
**理由**:
- AG ガバナンス上「過去の commit を改ざんしない」原則に従う
- skills の記録 (5/3) と実装 commit (5/11) のタイムラグ自体が「失敗の証跡」として残る価値がある
- 本番 (Vercel) の git 履歴も差分として明確に追える

## 2026-05-11 / Vercel デプロイ既存状態の上書き判断
**状況**: lovely-noodling-noodle.md は「初回デプロイ」想定だったが、実態は 18 日前から複数回デプロイ済み (production URL `https://learning-app-project-zeta.vercel.app` が 8 日前から HTTP 200)。環境変数 6 つも 8 日前に登録済み。
**判断**: 既存デプロイをそのまま継承し、未反映だった adaptive question depth 機能の追加デプロイのみ実行。新規プロジェクト作成や既存リソースの破棄は行わない。
**理由**:
- 既存 URL `learning-app-project-zeta.vercel.app` を息子が既にブックマークしている可能性。URL が変わると断絶
- 環境変数も 6/6 ローカルと MATCH 確認済み (F-2 クリア)、再登録すると暗号化キーが変わるリスクのみ増える
- "既存検証 → 差分のみデプロイ" のほうが「初回デプロイ計画再実行」より安全
