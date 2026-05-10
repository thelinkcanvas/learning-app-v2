# patterns.md (learning-app-project Project)

<!-- フォーマット: 日付 / パターン名 / 概要 / 使用条件 -->
<!--
このファイルは AG Governance v5.0 Layer P (Project Skills) として運用されます。
learning-app-project 固有の正規パターンをここに記録してください。

既存の learning-app 関連パターンは Global skills (/AG_Root/Antigravity/skills/patterns.md)
に残されています。今後の新規パターンのみここに追記してください。

汎用的なパターン（git / Vercel CLI / nano 等）は Global に追記し、
learning-app 固有のもの（Gemini ソクラテス対話 / Classroom 統合等）はここに追記する判断を心がけてください。
-->

## 2026-05-11 / Vercel 既存デプロイ検証フロー
**概要**: 「初回デプロイ」と言われても既存デプロイがあるケースは多い。`vercel --prod` を即実行する前に既存状態を確認するフロー。
**手順**:
1. `.vercel/project.json` の存在確認 → リンク済みかどうか
2. `vercel project ls` → アカウント上の既存プロジェクト一覧
3. `curl -sS -o /dev/null -w "%{http_code}" <prod-url>` → 既存 production URL が生きているか
4. `vercel ls <project>` → デプロイ履歴とコミットID
5. `vercel env ls production` → 環境変数の存在確認 (値は表示されない)
6. `vercel env pull .env.prod.tmp --environment=production --yes` → 値を取得して `.env.local` と diff
7. `git status -s` → 未コミット差分がないか
8. 差分があれば commit & push → `vercel --prod --yes` で再デプロイ
9. 動作確認後 `.env.prod.tmp` を必ず削除
**使用条件**: 過去にデプロイした記憶がある or 未確認のプロジェクトで Vercel 操作する全てのケース

## 2026-05-11 / 環境変数の実値検証パターン (F-2 対策)
**概要**: 「Vercel に登録済み」と表示されても実値が空文字列のケースがある (F-2)。長さと先頭数文字で確認する。
**手順**:
```bash
vercel env pull .env.prod.tmp --environment=production --yes
for k in NEXT_PUBLIC_GEMINI_API_KEY GOOGLE_API_KEY ...; do
  l=$(grep "^${k}=" .env.local | cut -d= -f2- | tr -d '"');
  p=$(grep "^${k}=" .env.prod.tmp | cut -d= -f2- | tr -d '"');
  [ "$l" = "$p" ] && echo "✅ ${k}: MATCH" || echo "⚠️  ${k}: DIFFER (local_len=${#l} prod_len=${#p})";
done
rm .env.prod.tmp
```
**使用条件**: Vercel デプロイ前 / 環境変数追加後 / "デプロイは成功するのにアプリが動かない" 系の調査時

## 2026-05-11 / 本番 JS バンドル内容の文字列検索による反映確認
**概要**: 「本番に新コードが反映されているか」を git の SHA に頼らず、バンドル内の特徴的な文字列で検証する。
**手順**:
```bash
# 例: adaptive question depth の "もういい" keyword が含まれるか
curl -sS https://<prod-url>/learn/math | grep -oE '/_next/static/[^"]+\.js' | sort -u | while read jsp; do
  CONTENT=$(curl -sS "https://<prod-url>${jsp}");
  HIT=$(echo "$CONTENT" | grep -oE "もういい|めんどう" | head -1);
  [ -n "$HIT" ] && echo "  ✅ ${jsp}: ${HIT}";
done
```
**使用条件**:
- デプロイ後の反映確認
- デプロイの成否を build status だけで判断したくない時
- 機能ごとに「これが入っていれば反映済み」と言える文字列がある時
**注意**: ブラウザ動作確認の代替にはならない。"バンドルに含まれる" と "実行時に動く" は別問題
