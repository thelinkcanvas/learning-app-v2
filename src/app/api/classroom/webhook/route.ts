import { NextRequest, NextResponse } from 'next/server';
import type { ClassroomPubSubMessage } from '@/lib/types/classroom';
import { decodePubSubMessage } from '@/lib/classroom/pubsub-handler';

/**
 * Google Pub/Sub Push 通知エンドポイント
 *
 * 設計方針：
 * - Pub/Sub からの POST のみ受け付ける（GET は 405）
 * - 認証は Pub/Sub の OIDC token を Authorization ヘッダで検証する想定
 *   （本番では JWT 検証を実装：iss/aud/exp）
 * - 処理本体は worker キューに投げる方が望ましいが、最小実装は同期処理
 * - Pub/Sub は 2xx を期待。3xx/4xx/5xx を返すと再配信される
 *
 * 設定方法：
 * 1. GCP Pub/Sub トピック作成: classroom-notifications
 * 2. このエンドポイント URL を Push サブスクリプションのエンドポイントに登録
 *    例: https://your-app.vercel.app/api/classroom/webhook
 * 3. Classroom 側で `POST /v1/registrations` を呼んでトピック購読
 */

export async function POST(request: NextRequest) {
  try {
    // 1. OIDC token 簡易検証（本番では JWT verify ライブラリで厳格化）
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing OIDC token' }, { status: 401 });
    }
    // TODO: JWT verify with Google's public keys
    // - iss === 'https://accounts.google.com'
    // - aud === 自分の API URL
    // - exp が未来

    // 2. ペイロード受信
    const body = (await request.json()) as ClassroomPubSubMessage;
    if (!body.message?.data) {
      return NextResponse.json({ error: 'Invalid Pub/Sub message format' }, { status: 400 });
    }

    // 3. デコード（実際の同期処理は別 worker でやるのが望ましい）
    const payload = decodePubSubMessage(body);

    // 4. 同期処理は重いので、ここではログだけ残して即 ACK
    //    本実装では handleClassroomNotification を呼ぶか、Cloud Tasks に enqueue
    console.log('[Classroom Webhook] received:', {
      collection: payload.collection,
      eventType: payload.eventType,
      resource: payload.resourceId,
    });

    // 5. 2xx で ACK（再配信を止める）
    return NextResponse.json({ status: 'acknowledged' }, { status: 200 });
  } catch (err) {
    // パース失敗等は 400 で返す（再配信させない）
    console.error('[Classroom Webhook] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'This endpoint only accepts POST from Google Pub/Sub' },
    { status: 405 }
  );
}
