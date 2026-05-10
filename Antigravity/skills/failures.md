# failures.md (learning-app-project Project)

<!-- フォーマット: 日付 / 問題の概要 / 原因 / 次回の回避策 -->
<!--
このファイルは AG Governance v5.0 Layer P (Project Skills) として運用されます。
learning-app-project 固有の失敗・回避策をここに記録してください。

既存の learning-app 関連エントリは Global skills (/AG_Root/Antigravity/skills/failures.md)
に残されています。今後の新規エントリのみここに追記してください。

汎用的な失敗（macOS / git / 認証 / AG ガバナンス等）は Global に追記し、
learning-app 固有のもの（Vercel / Gemini / Next.js / Classroom 等）はここに追記する判断を心がけてください。
-->

## 2026-05-11 / Vercel デプロイ前にローカル実装が untracked のままだった
**問題**: 5/3 commit `d6c0fd4` で「adaptive question depth 実装記録」を skills に commit していたが、実装本体（src/lib/tutor-prompt.ts, scripts/test-tutor-prompt.ts, src/lib/gemini.ts の修正）が untracked のまま 1 週間放置されていた。本番には未反映、ユーザー（息子）の手元では古い動作のまま。
**原因**: 「skills の記録 commit」と「実装本体の commit」を分けたが、後者を忘れた。git status を確認する習慣がなかった。
**回避策**:
- 機能実装後に必ず `git status -s` で未追跡ファイルを確認する
- skills への記録 commit は実装 commit の **後** にする（実装が確実に push 済みであることを確認してから記録）
- Vercel 既存デプロイがある場合、再デプロイ前に必ず「未コミット差分があるか」を確認する

## 2026-05-11 / NEXT_PUBLIC_GEMINI_API_KEY が JS バンドルに見当たらない
**問題**: 本番デプロイ後、`curl` で全 9 JS チャンクを走査したが `AIza...` 形式の API キーが grep で見つからない。`NEXT_PUBLIC_` プレフィックスはブラウザ公開のはずなのに。
**原因**: 未確定（要追加調査）。可能性として: (1) サーバー側コンポーネントのみで使用、(2) 動的 import で別 chunk に分離、(3) Next.js 16 が環境変数を別経路で注入、(4) F-2 と同様に空文字列で登録された
**回避策**:
- `vercel env pull` で実値が入っていることを確認するまでは「公開済み」と判断しない
- 真の動作確認はブラウザでの手動チャットテスト
- Phase B (BFF パターン) で API キーをサーバー側に隠すのが本筋。MVP では動作確認優先

## 2026-05-11 / AG への snapshot 連携が 5/2 で 9 日間停止していた
**問題**: `latest_snapshot.md` が 5/2 01:30 で更新停止。AG は v5.0 進化を一切認識できず、5/3〜5/9 の作業（adaptive question depth、ROBLOX 開発、v5.0 アーキテクチャ実装）が見えていなかった。audit.log にも 5/3〜5/9 のエントリが 0 件。
**原因**: snapshot は手動更新に依存していた。worktree で作業していたセッションは ag.js を経由せず、Master audit.log にも書き込まれなかった。
**回避策**:
- 重要マイルストーン後に手動で `latest_snapshot.md` 更新 + `sync_snapshot.sh` 実行
- v5.1 で snapshot 自動更新フックを ag.js に追加予定
- worktree で作業する場合は AG ガード経由を意識する（CC 直接実行を避ける）
