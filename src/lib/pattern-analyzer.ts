/**
 * パターン分析エンジン V2 - メインエンジン
 *
 * 6種類のエラーパターンを会話ログから自動検出する
 * - Pattern A: 同一質問の繰り返し（定着度不足）
 * - Pattern B: 失敗→成功の遷移（学習進度）
 * - Pattern C: 教科別得意・苦手分野（マスタリー）
 * - Pattern D: 確信度低下（集中力低下）
 * - Pattern E: ヒント要求頻度（学習スタイル）
 * - Pattern F: 学習流暢性（概念理解の進み具合）
 */

import {
  TimestampedMessage,
  AnalysisPattern,
  RepetitionPattern,
  FailureSuccessTransition,
  SubjectMasteryPattern,
  ConfidenceMetrics,
  HintDependencyScore,
  FluencyMetrics,
  MasteryMap,
  UnitMastery,
  MessageClassification,
  AnalyzerConfig,
  DEFAULT_ANALYZER_CONFIG,
  SUCCESS_KEYWORDS,
  FAILURE_KEYWORDS,
  HINT_REQUEST_KEYWORDS,
  DailyAnalysisResult,
} from './types/analysis';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * メッセージのタイプを分類する（成功/失敗/中立）
 * Gemini の応答テキストから判定
 */
export function classifyMessage(
  content: string,
  role: 'user' | 'assistant'
): MessageClassification {
  if (role !== 'assistant') return 'neutral';

  const lower = content.toLowerCase();

  // Success keywords
  const hasSuccess = SUCCESS_KEYWORDS.some((kw) =>
    content.includes(kw) || lower.includes(kw.toLowerCase())
  );

  // Failure keywords
  const hasFailure = FAILURE_KEYWORDS.some((kw) =>
    content.includes(kw) || lower.includes(kw.toLowerCase())
  );

  // Success takes priority (if both, it's a transition message)
  if (hasSuccess) return 'success';
  if (hasFailure) return 'failure';

  return 'neutral';
}

/**
 * ユーザーメッセージがヒント要求を含むか判定
 */
export function isHintRequest(content: string): boolean {
  return HINT_REQUEST_KEYWORDS.some((kw) => content.includes(kw));
}

/**
 * テキストからキーワードを抽出
 *
 * MeCab を使わず、正規表現だけでできる範囲の軽量トークナイズ：
 * 1. 漢字連続（2文字以上）— 最も意味密度が高い
 * 2. カタカナ連続（2文字以上）— 外来語
 * 3. 漢字を含む文字バイグラム — 似た話題を捉えるための補助
 *
 * V2 Phase 1 の heuristic 層。より精密な解析は Gemini（Day 7）で行う。
 */
export function extractKeywords(text: string): string[] {
  const results: Set<string> = new Set();

  // 1. 漢字連続（2文字以上）— 主要キーワード
  const kanjiCompounds = text.match(/[\u4E00-\u9FAF]{2,}/g) || [];
  for (const word of kanjiCompounds) results.add(word);

  // 2. カタカナ連続（2文字以上）— 外来語
  const katakana = text.match(/[\u30A0-\u30FF]{2,}/g) || [];
  for (const word of katakana) results.add(word);

  // 3. 漢字を含む文字バイグラム（日本語のみ抽出したあとの隣接2文字）
  const japaneseOnly = text.replace(
    /[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g,
    ''
  );
  for (let i = 0; i <= japaneseOnly.length - 2; i++) {
    const bigram = japaneseOnly.slice(i, i + 2);
    if (/[\u4E00-\u9FAF]/.test(bigram)) {
      results.add(bigram);
    }
  }

  // ストップワード除外
  const stopWords = new Set([
    'ください', 'ですか', 'ますか', 'でしょう', 'なります',
    'あります', 'ありません', 'これは', 'それは', 'あれは',
    'どうして', 'なんで', 'ですが', 'なので', 'したい',
    'わかる', 'わかり', 'わかっ', 'わからない', 'わかりません',
    'おしえて', '教えて', 'もう一度', 'もうちょっと',
  ]);

  return Array.from(results).filter((w) => !stopWords.has(w));
}

/**
 * キーワード配列から「漢字連続（2文字以上）」のみを抽出
 * Pattern C（mastery）・Pattern F（fluency）で unit 名として使用
 */
function filterKanjiCompounds(keywords: string[]): string[] {
  return keywords.filter((w) => /^[\u4E00-\u9FAF]{2,}$/.test(w));
}

/**
 * 2つのキーワード配列の類似度を計算（Jaccard 係数）
 */
export function keywordSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * タイムスタンプ間の分数差を計算
 */
export function minutesBetween(ts1: string, ts2: string): number {
  const d1 = new Date(ts1).getTime();
  const d2 = new Date(ts2).getTime();
  return Math.abs(d2 - d1) / (1000 * 60);
}

// ============================================================================
// Pattern Analyzer Main Class
// ============================================================================

export class PatternAnalyzer {
  private config: AnalyzerConfig;

  constructor(config: Partial<AnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
  }

  // ==========================================================================
  // Pattern A: 同一質問の繰り返し
  // ==========================================================================

  /**
   * 同じ質問が繰り返されているか検出する
   *
   * アルゴリズム:
   * 1. ユーザー質問を抽出し、キーワードを抽出
   * 2. キーワード類似度 >= 0.5 で同一グループに分類
   * 3. 同一グループが threshold 回以上出現 → パターン確定
   * 4. 間隔により「即時 (<5分)」と「復習 (>=1時間)」を区別
   */
  detectRepetitionPattern(messages: TimestampedMessage[]): RepetitionPattern[] {
    const userMessages = messages.filter((m) => m.role === 'user');

    // キーワードクラスタリング
    const groups: Array<{
      keywords: string[];
      messages: TimestampedMessage[];
    }> = [];

    for (const msg of userMessages) {
      const keywords = extractKeywords(msg.content);
      if (keywords.length === 0) continue;

      // 既存グループとの類似度を確認
      // 閾値 0.2：バイグラム＋漢字連続のキーワードは同一話題でも union が大きくなりやすいため低めに設定
      let matched = false;
      for (const group of groups) {
        if (keywordSimilarity(keywords, group.keywords) >= 0.2) {
          group.messages.push(msg);
          // グループのキーワードを拡張
          group.keywords = Array.from(new Set([...group.keywords, ...keywords]));
          matched = true;
          break;
        }
      }

      if (!matched) {
        groups.push({ keywords, messages: [msg] });
      }
    }

    // threshold 以上のグループを抽出
    const patterns: RepetitionPattern[] = [];

    for (const group of groups) {
      if (group.messages.length < this.config.repetitionThreshold) continue;

      const intervals: number[] = [];
      for (let i = 1; i < group.messages.length; i++) {
        intervals.push(
          minutesBetween(group.messages[i - 1].timestamp, group.messages[i].timestamp)
        );
      }

      const avgInterval =
        intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
      const classification: 'immediate' | 'review' =
        avgInterval < this.config.immediateIntervalMinutes ? 'immediate' : 'review';

      const timeSpan = minutesBetween(
        group.messages[0].timestamp,
        group.messages[group.messages.length - 1].timestamp
      );

      const severity: 'low' | 'medium' | 'high' =
        group.messages.length >= 5 ? 'high' :
        group.messages.length >= 4 ? 'medium' : 'low';

      // topic は「グループ内の複数メッセージで共有されるキーワード」を使う。
      // 全メッセージの union から選ぶと、1件だけに含まれるキーワードが
      // 代表になってしまい、共通テーマを表さないため。
      const keywordFreq = new Map<string, number>();
      for (const m of group.messages) {
        const kws = new Set(extractKeywords(m.content));
        for (const kw of kws) {
          keywordFreq.set(kw, (keywordFreq.get(kw) || 0) + 1);
        }
      }
      const shared = Array.from(keywordFreq.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([kw]) => kw);
      const sharedKanjiCompounds = filterKanjiCompounds(shared);
      const topic =
        sharedKanjiCompounds.length > 0
          ? sharedKanjiCompounds.slice(0, 3).join('・')
          : shared.length > 0
          ? shared.slice(0, 3).join('・')
          : group.keywords.slice(0, 3).join('・');

      patterns.push({
        type: 'repetition',
        confidence: Math.min(group.messages.length / 5, 1),
        topic,
        occurrences: group.messages.length,
        timeSpan: `${Math.round(timeSpan)}分`,
        severity,
        keywords: group.keywords,
        intervals,
        classification,
        recommendation:
          classification === 'immediate'
            ? `${topic}の理解が不十分。視覚教材や具体例で再学習を推奨`
            : `${topic}の復習を継続。間隔をあけた学習は効果的`,
        evidence: group.messages.slice(0, 3).map((m) => m.content),
      });
    }

    return patterns;
  }

  // ==========================================================================
  // Pattern B: 失敗→成功の遷移
  // ==========================================================================

  /**
   * 失敗から成功への遷移を検出する
   *
   * アルゴリズム:
   * 1. アシスタント応答を success/failure/neutral に分類
   * 2. 失敗の直後にユーザー質問があり、その後に成功が続くパターンを検出
   * 3. 失敗回数と成功までの所要時間を記録
   */
  detectFailureSuccessTransition(
    messages: TimestampedMessage[]
  ): FailureSuccessTransition[] {
    const transitions: FailureSuccessTransition[] = [];
    let currentFailureStreak: TimestampedMessage[] = [];
    let streakStartUserMsg: TimestampedMessage | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        // ユーザー質問：新しいストリーク開始の可能性
        if (currentFailureStreak.length === 0) {
          streakStartUserMsg = msg;
        }
        continue;
      }

      // assistant のメッセージ
      const classification = classifyMessage(msg.content, msg.role);

      if (classification === 'failure') {
        currentFailureStreak.push(msg);
      } else if (classification === 'success') {
        // 失敗が続いた後の成功 → 遷移成立
        if (currentFailureStreak.length > 0 && streakStartUserMsg) {
          const masteryMinutes = minutesBetween(
            streakStartUserMsg.timestamp,
            msg.timestamp
          );

          const allKw = extractKeywords(streakStartUserMsg.content);
          const kanjiKw = filterKanjiCompounds(allKw);
          const topic =
            kanjiKw.slice(0, 2).join('・') ||
            allKw.slice(0, 2).join('・') ||
            '学習項目';

          transitions.push({
            type: 'failure-success',
            confidence: Math.min(currentFailureStreak.length / 3, 1),
            topic,
            occurrences: currentFailureStreak.length,
            timeSpan: `${Math.round(masteryMinutes)}分`,
            severity: currentFailureStreak.length >= 3 ? 'medium' : 'low',
            failureCount: currentFailureStreak.length,
            successAt: msg.timestamp,
            masteryTime: `${Math.round(masteryMinutes)}分`,
            recommendation:
              currentFailureStreak.length >= 3
                ? `${topic}は粘り強く取り組み習得。次も同じスタイルで`
                : `${topic}を短時間で習得。順調な学習進度`,
          });
        }

        // ストリーク リセット
        currentFailureStreak = [];
        streakStartUserMsg = null;
      }
    }

    return transitions;
  }

  // ==========================================================================
  // Pattern C: 教科別得意・苦手分野（マスタリー）
  // ==========================================================================

  /**
   * 教科内の単元別マスタリーを検出する
   *
   * アルゴリズム:
   * 1. ユーザー質問からキーワードを抽出 → 単元候補
   * 2. 直後のアシスタント応答を分類
   * 3. 単元ごとに成功率を計算
   * 4. 80% 以上 → 得意、60% 未満 → 苦手
   */
  detectSubjectMastery(messages: TimestampedMessage[]): SubjectMasteryPattern {
    const unitMap: Record<string, {
      successes: number;
      attempts: number;
      lastAttempt: string;
    }> = {};

    for (let i = 0; i < messages.length - 1; i++) {
      const userMsg = messages[i];
      const assistantMsg = messages[i + 1];

      if (userMsg.role !== 'user' || assistantMsg.role !== 'assistant') continue;

      const allKeywords = extractKeywords(userMsg.content);
      // unit 名は「漢字連続（2文字以上）」に限定。バイグラムだと単元として
      // 意味を成さないため除外し、マスタリー計算の精度を高める。
      const keywords = filterKanjiCompounds(allKeywords);
      const classification = classifyMessage(assistantMsg.content, 'assistant');

      if (classification === 'neutral') continue;

      // 各キーワードを単元として集計
      for (const kw of keywords.slice(0, 3)) { // 上位3キーワードのみ
        if (!unitMap[kw]) {
          unitMap[kw] = { successes: 0, attempts: 0, lastAttempt: userMsg.timestamp };
        }
        unitMap[kw].attempts += 1;
        if (classification === 'success') unitMap[kw].successes += 1;
        unitMap[kw].lastAttempt = userMsg.timestamp;
      }
    }

    // MasteryMap に変換
    const masteryMap: MasteryMap = {};
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const [unit, data] of Object.entries(unitMap)) {
      if (data.attempts < 2) continue; // 1 回だけだと判断できない

      const rate = data.successes / data.attempts;
      const mastery: UnitMastery = {
        rate,
        attempts: data.attempts,
        trend: 'stable', // 日次分析では stable 固定。週間分析で trend を計算
        lastAttempt: data.lastAttempt,
      };
      masteryMap[unit] = mastery;

      if (rate >= this.config.strengthThreshold) strengths.push(unit);
      else if (rate < this.config.weaknessThreshold) weaknesses.push(unit);
    }

    return {
      type: 'mastery',
      confidence: Object.keys(masteryMap).length > 0 ? 0.8 : 0,
      topic: '教科内マスタリー',
      occurrences: Object.keys(masteryMap).length,
      severity:
        weaknesses.length >= 3 ? 'high' :
        weaknesses.length >= 1 ? 'medium' : 'low',
      subjectMap: masteryMap,
      strengths,
      weaknesses,
      recommendation:
        weaknesses.length > 0
          ? `苦手分野「${weaknesses.slice(0, 2).join('・')}」の重点補強を推奨`
          : '全単元で順調な習得',
    };
  }

  // ==========================================================================
  // Pattern D: 確信度低下（集中力低下）
  // ==========================================================================

  /**
   * 会話の後半で確信度が低下したか検出する
   *
   * アルゴリズム:
   * 1. ユーザー質問の文字数を時系列で取得
   * 2. 前半と後半で比較
   * 3. 後半の文字数が前半の 50% 以下、かつ失敗率上昇 → 集中力低下
   */
  detectConfidenceDecline(messages: TimestampedMessage[]): ConfidenceMetrics {
    const userMessages = messages.filter((m) => m.role === 'user');

    if (userMessages.length < 4) {
      // サンプル数不足
      return {
        type: 'confidence-decline',
        confidence: 0,
        topic: '確信度',
        occurrences: 0,
        severity: 'low',
        avgMessageLengthTrend: [],
        failureRateChange: 0,
        declineDetected: false,
      };
    }

    // 前半・後半の分割
    const mid = Math.floor(userMessages.length / 2);
    const firstHalf = userMessages.slice(0, mid);
    const secondHalf = userMessages.slice(mid);

    const avgLenFirst =
      firstHalf.reduce((sum, m) => sum + m.content.length, 0) / firstHalf.length;
    const avgLenSecond =
      secondHalf.reduce((sum, m) => sum + m.content.length, 0) / secondHalf.length;

    const lengthRatio = avgLenSecond / avgLenFirst;

    // 失敗率計算
    const countFailures = (msgs: TimestampedMessage[]): number => {
      let count = 0;
      for (let i = 0; i < messages.length - 1; i++) {
        if (
          messages[i].role === 'user' &&
          msgs.includes(messages[i]) &&
          messages[i + 1].role === 'assistant' &&
          classifyMessage(messages[i + 1].content, 'assistant') === 'failure'
        ) {
          count++;
        }
      }
      return count;
    };

    const failuresFirst = countFailures(firstHalf);
    const failuresSecond = countFailures(secondHalf);
    const failureRateChange =
      failuresSecond / secondHalf.length - failuresFirst / firstHalf.length;

    const declineDetected =
      lengthRatio < this.config.messageLengthDeclineRatio && failureRateChange > 0.2;

    // 時系列平均文字数（4分割）
    const quarterSize = Math.floor(userMessages.length / 4) || 1;
    const avgLengthTrend: number[] = [];
    for (let i = 0; i < 4; i++) {
      const slice = userMessages.slice(i * quarterSize, (i + 1) * quarterSize);
      if (slice.length === 0) continue;
      const avg = slice.reduce((sum, m) => sum + m.content.length, 0) / slice.length;
      avgLengthTrend.push(Math.round(avg));
    }

    return {
      type: 'confidence-decline',
      confidence: declineDetected ? Math.min(1 - lengthRatio, 1) : 0.1,
      topic: '学習セッション全体',
      occurrences: declineDetected ? 1 : 0,
      severity: declineDetected ? 'medium' : 'low',
      avgMessageLengthTrend: avgLengthTrend,
      failureRateChange,
      declineDetected,
      timestamp: declineDetected ? secondHalf[0].timestamp : undefined,
      recommendation: declineDetected
        ? '学習セッション後半で集中力低下を検出。休憩を推奨'
        : '全体を通して集中力を維持',
    };
  }

  // ==========================================================================
  // Pattern E: ヒント要求頻度（学習スタイル）
  // ==========================================================================

  /**
   * ヒント要求の頻度から学習スタイルを判定する
   *
   * アルゴリズム:
   * 1. ユーザー質問のうち、ヒント要求キーワードを含むものをカウント
   * 2. 依存率 = ヒント要求数 / 総質問数
   * 3. 70% 以上 → 依存型、30% 未満 → 自律型
   */
  detectHintDependency(messages: TimestampedMessage[]): HintDependencyScore {
    const userMessages = messages.filter((m) => m.role === 'user');
    const totalQuestions = userMessages.length;

    if (totalQuestions === 0) {
      return {
        type: 'hint-dependency',
        confidence: 0,
        topic: '学習スタイル',
        occurrences: 0,
        severity: 'low',
        hintRequests: 0,
        totalQuestions: 0,
        dependencyRate: 0,
        style: 'balanced',
      };
    }

    const hintRequests = userMessages.filter((m) => isHintRequest(m.content)).length;
    const dependencyRate = hintRequests / totalQuestions;

    let style: 'autonomous' | 'balanced' | 'dependent';
    if (dependencyRate >= this.config.hintDependencyThreshold) style = 'dependent';
    else if (dependencyRate < 0.3) style = 'autonomous';
    else style = 'balanced';

    const severity: 'low' | 'medium' | 'high' =
      style === 'dependent' ? 'medium' :
      style === 'balanced' ? 'low' : 'low';

    return {
      type: 'hint-dependency',
      confidence: 0.9,
      topic: '学習スタイル',
      occurrences: hintRequests,
      severity,
      hintRequests,
      totalQuestions,
      dependencyRate,
      style,
      recommendation:
        style === 'dependent'
          ? 'ヒント依存型。「まず自分で試そう」というメッセージを増やす'
          : style === 'autonomous'
          ? '自律学習型。このスタイルを継続'
          : 'バランス型。必要な時にヒントを求める良い習慣',
    };
  }

  // ==========================================================================
  // Pattern F: 学習流暢性（概念理解の進み具合）
  // ==========================================================================

  /**
   * トピックごとの習得に必要なターン数を計測する
   *
   * アルゴリズム:
   * 1. 成功メッセージごとに、直前のユーザー質問開始からのターン数を計算
   * 2. トピック（キーワード）別に平均ターン数を集計
   * 3. 3ターン以下 → 速習、10ターン以上 → 遅習
   */
  detectLearningFluency(messages: TimestampedMessage[]): FluencyMetrics {
    const topicTurnCounts: Record<string, number[]> = {};

    let currentTopic: string | null = null;
    let currentTurns = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        if (currentTopic === null) {
          // 新しいトピック開始：意味のある単位名（漢字連続）を優先
          const allKeywords = extractKeywords(msg.content);
          const kanjiCompounds = filterKanjiCompounds(allKeywords);
          currentTopic = kanjiCompounds[0] || allKeywords[0] || '一般学習';
          currentTurns = 1;
        } else {
          currentTurns++;
        }
      } else if (msg.role === 'assistant') {
        const classification = classifyMessage(msg.content, 'assistant');

        if (classification === 'success' && currentTopic !== null) {
          // トピック習得
          if (!topicTurnCounts[currentTopic]) topicTurnCounts[currentTopic] = [];
          topicTurnCounts[currentTopic].push(currentTurns);

          currentTopic = null;
          currentTurns = 0;
        }
      }
    }

    // 平均ターン数を計算
    const topicAvgTurns: Record<string, number> = {};
    for (const [topic, turns] of Object.entries(topicTurnCounts)) {
      const avg = turns.reduce((sum, t) => sum + t, 0) / turns.length;
      topicAvgTurns[topic] = Math.round(avg);
    }

    const quickLearnTopics: string[] = [];
    const slowLearnTopics: string[] = [];

    for (const [topic, avgTurns] of Object.entries(topicAvgTurns)) {
      if (avgTurns <= this.config.quickLearnTurnsMax) quickLearnTopics.push(topic);
      else if (avgTurns >= this.config.slowLearnTurnsMin) slowLearnTopics.push(topic);
    }

    const allAvgTurns = Object.values(topicAvgTurns);
    const overallAvg =
      allAvgTurns.length > 0
        ? allAvgTurns.reduce((sum, t) => sum + t, 0) / allAvgTurns.length
        : 0;

    return {
      type: 'fluency',
      confidence: allAvgTurns.length > 0 ? 0.7 : 0,
      topic: '学習流暢性',
      occurrences: allAvgTurns.length,
      severity: slowLearnTopics.length >= 2 ? 'medium' : 'low',
      topicTurnCounts: topicAvgTurns,
      avgTurnsToSuccess: Math.round(overallAvg * 10) / 10,
      quickLearnTopics,
      slowLearnTopics,
      recommendation:
        slowLearnTopics.length > 0
          ? `「${slowLearnTopics.slice(0, 2).join('・')}」は段階的な説明が必要。視覚教材を活用`
          : '全トピックで順調な理解進度',
    };
  }

  // ==========================================================================
  // Main Analysis Entry Point
  // ==========================================================================

  /**
   * 1日分の会話ログを総合分析する
   */
  analyzeDaily(
    messages: TimestampedMessage[],
    subject: string,
    date: string
  ): DailyAnalysisResult {
    const patterns: AnalysisPattern[] = [];

    // 各パターンを検出
    patterns.push(...this.detectRepetitionPattern(messages));
    patterns.push(...this.detectFailureSuccessTransition(messages));

    const masteryPattern = this.detectSubjectMastery(messages);
    if (masteryPattern.occurrences > 0) patterns.push(masteryPattern);

    const confidencePattern = this.detectConfidenceDecline(messages);
    if (confidencePattern.declineDetected) patterns.push(confidencePattern);

    const hintPattern = this.detectHintDependency(messages);
    if (hintPattern.totalQuestions > 0) patterns.push(hintPattern);

    const fluencyPattern = this.detectLearningFluency(messages);
    if (fluencyPattern.occurrences > 0) patterns.push(fluencyPattern);

    // 総合進度コメント
    const highSeverityCount = patterns.filter((p) => p.severity === 'high').length;
    const hasSuccessTransition = patterns.some((p) => p.type === 'failure-success');

    let overallProgress: string;
    if (highSeverityCount >= 2) {
      overallProgress = '複数の課題を検出。重点的な復習が必要';
    } else if (hasSuccessTransition) {
      overallProgress = '失敗から成功への遷移あり。良好な学習進度';
    } else if (patterns.length === 0) {
      overallProgress = 'パターンなし。安定した学習セッション';
    } else {
      overallProgress = '順調な学習進度。軽微な課題あり';
    }

    // 推奨アクション（各パターンから抽出）
    const recommendedActions = patterns
      .filter((p) => p.recommendation)
      .map((p) => p.recommendation!)
      .slice(0, 5); // 最大5件

    return {
      date,
      subject,
      patterns,
      masteryByUnit: masteryPattern.subjectMap,
      overallProgress,
      recommendedActions,
      generatedAt: new Date().toISOString(),
      messageCount: messages.length,
    };
  }
}
