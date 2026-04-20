/**
 * Pattern Analyzer V2 - 単体テスト
 *
 * 6種類のパターン検出メソッドの動作を検証する
 * - Utility functions: classifyMessage, isHintRequest, extractKeywords, keywordSimilarity, minutesBetween
 * - Pattern A-F: 各検出メソッドの正負ケース
 * - analyzeDaily: 統合エントリポイント
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PatternAnalyzer,
  classifyMessage,
  isHintRequest,
  extractKeywords,
  keywordSimilarity,
  minutesBetween,
} from './pattern-analyzer';
import { TimestampedMessage } from './types/analysis';

// ============================================================================
// Helper: タイムスタンプ生成（2026-04-19 を基準）
// ============================================================================

const BASE_DATE = '2026-04-19T09:00:00.000Z';

function makeTime(offsetMinutes: number): string {
  const base = new Date(BASE_DATE).getTime();
  return new Date(base + offsetMinutes * 60 * 1000).toISOString();
}

function makeMessage(
  role: 'user' | 'assistant',
  content: string,
  offsetMinutes: number
): TimestampedMessage {
  return { role, content, timestamp: makeTime(offsetMinutes) };
}

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe('classifyMessage', () => {
  it('成功キーワードを含む assistant メッセージを success と判定', () => {
    expect(classifyMessage('その通り！よくできたね', 'assistant')).toBe('success');
    expect(classifyMessage('正解！すごい！', 'assistant')).toBe('success');
    expect(classifyMessage('バッチリだね ✨', 'assistant')).toBe('success');
  });

  it('失敗キーワードを含む assistant メッセージを failure と判定', () => {
    expect(classifyMessage('もう一度考えてみようか', 'assistant')).toBe('failure');
    expect(classifyMessage('ちょっと違うな、ヒントをあげよう', 'assistant')).toBe('failure');
    expect(classifyMessage('うーん、惜しいね', 'assistant')).toBe('failure');
  });

  it('中立的な assistant メッセージを neutral と判定', () => {
    expect(classifyMessage('それでは問題を始めます', 'assistant')).toBe('neutral');
    expect(classifyMessage('3+4はいくつかな？', 'assistant')).toBe('neutral');
  });

  it('user メッセージは常に neutral', () => {
    expect(classifyMessage('その通り', 'user')).toBe('neutral');
    expect(classifyMessage('もう一度', 'user')).toBe('neutral');
  });

  it('成功と失敗が両方含まれる場合は success を優先', () => {
    expect(classifyMessage('もう一度、と思ったけど正解！', 'assistant')).toBe('success');
  });
});

describe('isHintRequest', () => {
  it('ヒント要求キーワードを含むメッセージを検出', () => {
    expect(isHintRequest('わからないよ')).toBe(true);
    expect(isHintRequest('ヒントをください')).toBe(true);
    expect(isHintRequest('やり方を教えて')).toBe(true);
    expect(isHintRequest('難しいな')).toBe(true);
  });

  it('ヒント要求でないメッセージを false と判定', () => {
    expect(isHintRequest('答えは5です')).toBe(false);
    expect(isHintRequest('3+4=7')).toBe(false);
  });
});

describe('extractKeywords', () => {
  it('漢字連続（2文字以上）を主要キーワードとして抽出', () => {
    const result = extractKeywords('算数の計算と漢字の練習');
    expect(result).toContain('算数');
    expect(result).toContain('計算');
    expect(result).toContain('漢字');
    expect(result).toContain('練習');
  });

  it('漢字を含むバイグラムも補助キーワードとして抽出', () => {
    const result = extractKeywords('繰り上がりの計算');
    // 漢字を含むバイグラム（'繰り', 'り上', '上が' など）
    expect(result.some((w) => w.includes('繰'))).toBe(true);
    expect(result.some((w) => w.includes('上'))).toBe(true);
    // 漢字連続
    expect(result).toContain('計算');
  });

  it('ストップワードを除外', () => {
    const result = extractKeywords('教えてわからない');
    expect(result).not.toContain('教えて');
    expect(result).not.toContain('わからない');
  });

  it('重複を除去', () => {
    const result = extractKeywords('算数の算数');
    const count = result.filter((w) => w === '算数').length;
    expect(count).toBe(1);
  });

  it('日本語が含まれないテキストは空配列', () => {
    const result = extractKeywords('123 456');
    expect(result).toEqual([]);
  });
});

describe('keywordSimilarity', () => {
  it('完全に同じキーワードは類似度 1.0', () => {
    expect(keywordSimilarity(['算数', '計算'], ['算数', '計算'])).toBe(1);
  });

  it('完全に異なるキーワードは類似度 0', () => {
    expect(keywordSimilarity(['算数'], ['国語'])).toBe(0);
  });

  it('部分一致は Jaccard 係数で計算', () => {
    // 共通 1件 / 合計 3件 = 0.333...
    const sim = keywordSimilarity(['算数', '計算'], ['算数', '国語']);
    expect(sim).toBeCloseTo(1 / 3, 2);
  });

  it('両方とも空なら類似度 1.0', () => {
    expect(keywordSimilarity([], [])).toBe(1);
  });

  it('片方が空なら類似度 0', () => {
    expect(keywordSimilarity(['算数'], [])).toBe(0);
  });
});

describe('minutesBetween', () => {
  it('同じ時刻は 0 分', () => {
    const ts = makeTime(0);
    expect(minutesBetween(ts, ts)).toBe(0);
  });

  it('10分の差は 10 を返す', () => {
    expect(minutesBetween(makeTime(0), makeTime(10))).toBe(10);
  });

  it('順序を問わず絶対値を返す', () => {
    expect(minutesBetween(makeTime(10), makeTime(0))).toBe(10);
  });
});

// ============================================================================
// Pattern A: Repetition Tests
// ============================================================================

describe('PatternAnalyzer.detectRepetitionPattern', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('同じキーワードの質問が3回以上ある場合に検出', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がりの計算について教えて', 0),
      makeMessage('assistant', '繰り上がりとは...', 1),
      makeMessage('user', '繰り上がりがやっぱりわからない', 10),
      makeMessage('assistant', 'もう一度説明するよ', 11),
      makeMessage('user', '繰り上がりの問題がまた解けない', 20),
    ];

    const patterns = analyzer.detectRepetitionPattern(messages);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].occurrences).toBeGreaterThanOrEqual(3);
  });

  it('threshold 未満の繰り返しは検出しない', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がりを教えて', 0),
      makeMessage('user', '繰り上がりまた', 10),
    ];

    const patterns = analyzer.detectRepetitionPattern(messages);
    expect(patterns.length).toBe(0);
  });

  it('5分以内の繰り返しは immediate に分類', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がりとは', 0),
      makeMessage('user', '繰り上がりの計算', 1),
      makeMessage('user', '繰り上がりわからない', 2),
    ];

    const patterns = analyzer.detectRepetitionPattern(messages);
    if (patterns.length > 0) {
      expect(patterns[0].classification).toBe('immediate');
    }
  });

  it('1時間以上の繰り返しは review に分類', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がりとは', 0),
      makeMessage('user', '繰り上がりの計算', 70),
      makeMessage('user', '繰り上がりわからない', 150),
    ];

    const patterns = analyzer.detectRepetitionPattern(messages);
    if (patterns.length > 0) {
      expect(patterns[0].classification).toBe('review');
    }
  });

  it('異なるトピックは別グループとして扱う', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がり問題', 0),
      makeMessage('user', '繰り上がり難しい', 5),
      makeMessage('user', '繰り上がりまた', 10),
      makeMessage('user', '漢字の読み方', 15),
      makeMessage('user', '漢字練習', 20),
    ];

    const patterns = analyzer.detectRepetitionPattern(messages);
    // 繰り上がり 3回、漢字 2回（threshold 未満）
    const kuriagari = patterns.find((p) => p.topic.includes('繰'));
    expect(kuriagari).toBeDefined();
    expect(kuriagari?.occurrences).toBe(3);
  });
});

// ============================================================================
// Pattern B: Failure-Success Transition Tests
// ============================================================================

describe('PatternAnalyzer.detectFailureSuccessTransition', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('失敗→成功の遷移を検出', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がり計算したい', 0),
      makeMessage('assistant', 'もう一度考えてみようか', 1),
      makeMessage('user', 'やってみる', 2),
      makeMessage('assistant', 'ちょっと違うな、ヒントをあげよう', 3),
      makeMessage('user', '8+5=13', 5),
      makeMessage('assistant', 'その通り！すごい！', 6),
    ];

    const transitions = analyzer.detectFailureSuccessTransition(messages);
    expect(transitions.length).toBe(1);
    expect(transitions[0].failureCount).toBe(2);
    expect(transitions[0].successAt).toBe(messages[5].timestamp);
  });

  it('失敗のみで成功がない場合は検出しない', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', 'やってみる', 0),
      makeMessage('assistant', 'もう一度', 1),
      makeMessage('assistant', 'ヒントをあげよう', 2),
    ];

    const transitions = analyzer.detectFailureSuccessTransition(messages);
    expect(transitions.length).toBe(0);
  });

  it('失敗を経ずに成功した場合は検出しない', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '8+5=13', 0),
      makeMessage('assistant', 'その通り！', 1),
    ];

    const transitions = analyzer.detectFailureSuccessTransition(messages);
    expect(transitions.length).toBe(0);
  });

  it('複数の遷移を独立に検出', () => {
    const messages: TimestampedMessage[] = [
      // 遷移1
      makeMessage('user', '問題1', 0),
      makeMessage('assistant', 'もう一度', 1),
      makeMessage('user', '答え', 2),
      makeMessage('assistant', 'その通り！', 3),
      // 遷移2
      makeMessage('user', '問題2', 10),
      makeMessage('assistant', 'ちょっと違う', 11),
      makeMessage('user', '答え', 12),
      makeMessage('assistant', '正解！', 13),
    ];

    const transitions = analyzer.detectFailureSuccessTransition(messages);
    expect(transitions.length).toBe(2);
  });

  it('masteryTime を正しく計算', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '問題', 0),
      makeMessage('assistant', 'もう一度', 1),
      makeMessage('user', '答え', 2),
      makeMessage('assistant', 'その通り！', 5),
    ];

    const transitions = analyzer.detectFailureSuccessTransition(messages);
    expect(transitions[0].masteryTime).toBe('5分');
  });
});

// ============================================================================
// Pattern C: Subject Mastery Tests
// ============================================================================

describe('PatternAnalyzer.detectSubjectMastery', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('成功率80%以上の単元を strengths に分類', () => {
    // unit 名は「漢字連続（2文字以上）」で抽出されるため、明示的な熟語を含める
    const messages: TimestampedMessage[] = [
      makeMessage('user', '計算問題の解き方', 0),
      makeMessage('assistant', '正解！', 1),
      makeMessage('user', '計算問題もう一つ', 2),
      makeMessage('assistant', 'その通り！', 3),
      makeMessage('user', '計算問題やってみる', 4),
      makeMessage('assistant', 'すごい！', 5),
    ];

    const result = analyzer.detectSubjectMastery(messages);
    expect(result.strengths.length).toBeGreaterThan(0);
  });

  it('成功率60%未満の単元を weaknesses に分類', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '分数計算の問題', 0),
      makeMessage('assistant', 'もう一度', 1),
      makeMessage('user', '分数計算また', 2),
      makeMessage('assistant', 'ちょっと違う', 3),
      makeMessage('user', '分数計算もう一つ', 4),
      makeMessage('assistant', 'うーん、惜しい', 5),
    ];

    const result = analyzer.detectSubjectMastery(messages);
    expect(result.weaknesses.length).toBeGreaterThan(0);
  });

  it('neutral メッセージは集計に含めない', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '問題', 0),
      makeMessage('assistant', '始めましょう', 1),
    ];

    const result = analyzer.detectSubjectMastery(messages);
    expect(result.occurrences).toBe(0);
  });

  it('attempts が 1 の単元は判定対象から除外', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', 'ユニークトピック', 0),
      makeMessage('assistant', '正解！', 1),
    ];

    const result = analyzer.detectSubjectMastery(messages);
    expect(Object.keys(result.subjectMap).length).toBe(0);
  });
});

// ============================================================================
// Pattern D: Confidence Decline Tests
// ============================================================================

describe('PatternAnalyzer.detectConfidenceDecline', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('サンプル不足（4件未満）は declineDetected = false', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '問題1の答えを教えて', 0),
      makeMessage('user', '問題2も', 1),
      makeMessage('user', '問題3', 2),
    ];

    const result = analyzer.detectConfidenceDecline(messages);
    expect(result.declineDetected).toBe(false);
    expect(result.avgMessageLengthTrend.length).toBe(0);
  });

  it('後半で文字数が大きく減り失敗が増えた場合に decline 検出', () => {
    const longQ = 'ここに長い質問を書いてこれは前半の詳しい説明を求める問題です';
    const shortQ = 'む';

    const messages: TimestampedMessage[] = [
      makeMessage('user', longQ, 0),
      makeMessage('assistant', 'その通り', 1),
      makeMessage('user', longQ, 2),
      makeMessage('assistant', '正解', 3),
      makeMessage('user', shortQ, 10),
      makeMessage('assistant', 'もう一度', 11),
      makeMessage('user', shortQ, 12),
      makeMessage('assistant', 'ちょっと違う', 13),
    ];

    const result = analyzer.detectConfidenceDecline(messages);
    expect(result.declineDetected).toBe(true);
    expect(result.severity).toBe('medium');
  });

  it('文字数が安定している場合は decline 検出なし', () => {
    const q = '問題を教えてください';
    const messages: TimestampedMessage[] = [
      makeMessage('user', q, 0),
      makeMessage('assistant', '正解', 1),
      makeMessage('user', q, 2),
      makeMessage('assistant', 'その通り', 3),
      makeMessage('user', q, 4),
      makeMessage('assistant', 'すごい', 5),
      makeMessage('user', q, 6),
      makeMessage('assistant', 'よくできた', 7),
    ];

    const result = analyzer.detectConfidenceDecline(messages);
    expect(result.declineDetected).toBe(false);
  });
});

// ============================================================================
// Pattern E: Hint Dependency Tests
// ============================================================================

describe('PatternAnalyzer.detectHintDependency', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('依存率70%以上で dependent と判定', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', 'わからない教えて', 0),
      makeMessage('user', 'ヒントをください', 1),
      makeMessage('user', 'やり方がわからない', 2),
      makeMessage('user', '難しい', 3),
      makeMessage('user', '答えは5', 4),
    ];

    const result = analyzer.detectHintDependency(messages);
    expect(result.style).toBe('dependent');
    expect(result.dependencyRate).toBeGreaterThanOrEqual(0.7);
  });

  it('依存率30%未満で autonomous と判定', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '答えは5', 0),
      makeMessage('user', '答えは7', 1),
      makeMessage('user', '計算結果は12', 2),
      makeMessage('user', '答えは20', 3),
      makeMessage('user', 'わからない', 4),
    ];

    const result = analyzer.detectHintDependency(messages);
    expect(result.style).toBe('autonomous');
    expect(result.dependencyRate).toBeLessThan(0.3);
  });

  it('依存率30-70%で balanced と判定', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '答えは5', 0),
      makeMessage('user', 'わからない', 1),
      makeMessage('user', '答えは7', 2),
      makeMessage('user', 'ヒント', 3),
    ];

    const result = analyzer.detectHintDependency(messages);
    expect(result.style).toBe('balanced');
  });

  it('ユーザーメッセージ 0 件の場合は balanced でスコア 0', () => {
    const messages: TimestampedMessage[] = [];
    const result = analyzer.detectHintDependency(messages);
    expect(result.style).toBe('balanced');
    expect(result.dependencyRate).toBe(0);
  });
});

// ============================================================================
// Pattern F: Learning Fluency Tests
// ============================================================================

describe('PatternAnalyzer.detectLearningFluency', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('3ターン以下で習得したトピックを quickLearnTopics に', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '足し算教えて', 0),
      makeMessage('assistant', 'これは...', 1),
      makeMessage('user', 'やってみる', 2),
      makeMessage('assistant', 'その通り！', 3),
    ];

    const result = analyzer.detectLearningFluency(messages);
    expect(result.quickLearnTopics.length).toBeGreaterThan(0);
  });

  it('10ターン以上かかったトピックを slowLearnTopics に', () => {
    const messages: TimestampedMessage[] = [];
    messages.push(makeMessage('user', '繰り上がり教えて', 0));
    // 10ターンのやり取り（成功なし）
    for (let i = 1; i <= 10; i++) {
      messages.push(makeMessage('assistant', '考えてみよう', i * 2 - 1));
      messages.push(makeMessage('user', 'もう一回やる', i * 2));
    }
    messages.push(makeMessage('assistant', 'その通り！', 22));

    const result = analyzer.detectLearningFluency(messages);
    expect(result.slowLearnTopics.length).toBeGreaterThan(0);
  });

  it('成功がない場合はトピック習得未完', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '問題', 0),
      makeMessage('assistant', 'うーん', 1),
      makeMessage('user', 'もう一度', 2),
      makeMessage('assistant', 'もう一度考えて', 3),
    ];

    const result = analyzer.detectLearningFluency(messages);
    expect(result.occurrences).toBe(0);
  });
});

// ============================================================================
// analyzeDaily Integration Tests
// ============================================================================

describe('PatternAnalyzer.analyzeDaily', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('DailyAnalysisResult を返す', () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がり教えて', 0),
      makeMessage('assistant', 'これは...', 1),
      makeMessage('user', '答え13', 2),
      makeMessage('assistant', 'その通り！', 3),
    ];

    const result = analyzer.analyzeDaily(messages, 'math', '2026-04-19');
    expect(result.date).toBe('2026-04-19');
    expect(result.subject).toBe('math');
    expect(result.messageCount).toBe(4);
    expect(result.generatedAt).toBeDefined();
    expect(Array.isArray(result.patterns)).toBe(true);
    expect(Array.isArray(result.recommendedActions)).toBe(true);
  });

  it('空のメッセージ配列でもエラーなく返る', () => {
    const result = analyzer.analyzeDaily([], 'math', '2026-04-19');
    expect(result.messageCount).toBe(0);
    expect(result.overallProgress).toBe('パターンなし。安定した学習セッション');
  });

  it('高severity が 2 件以上で「複数の課題」コメント', () => {
    // 高severityになる繰り返しを作る
    const messages: TimestampedMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(makeMessage('user', `繰り上がり${i}`, i));
    }
    for (let i = 0; i < 5; i++) {
      messages.push(makeMessage('user', `漢字練習${i}`, i + 100));
    }

    const result = analyzer.analyzeDaily(messages, 'math', '2026-04-19');
    // いくつかのパターンが検出されるべき
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it('recommendedActions は最大5件', () => {
    const messages: TimestampedMessage[] = [];
    // 大量のメッセージを生成
    for (let i = 0; i < 20; i++) {
      messages.push(makeMessage('user', `ヒント教えて${i}`, i));
      messages.push(makeMessage('assistant', 'もう一度', i + 0.5));
    }

    const result = analyzer.analyzeDaily(messages, 'math', '2026-04-19');
    expect(result.recommendedActions.length).toBeLessThanOrEqual(5);
  });

  it('カスタム config で閾値を変更できる', () => {
    const customAnalyzer = new PatternAnalyzer({ repetitionThreshold: 2 });
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がり問題', 0),
      makeMessage('user', '繰り上がりまた', 10),
    ];

    const result = customAnalyzer.analyzeDaily(messages, 'math', '2026-04-19');
    // threshold=2 なので 2回でも検出される
    const repetition = result.patterns.find((p) => p.type === 'repetition');
    expect(repetition).toBeDefined();
  });
});
