// 軽量テスト: src/lib/tutor-prompt.ts の質問深度自動調整ロジック
// 実行: npx tsx scripts/test-tutor-prompt.ts
// (vitest を補完する単体スクリプト。CI 統合は test:* スクリプト経由)

import {
  detectDifficulty,
  detectFatigue,
  detectAnswerQuality,
  countConsecutiveShortAnswers,
  extractSignals,
  buildAdaptiveGuidance,
  type PromptMessage,
} from '../src/lib/tutor-prompt';
import { createSystemPrompt } from '../src/lib/gemini';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function group(name: string, fn: () => void) {
  console.log(`\n[${name}]`);
  fn();
}

group('detectDifficulty', () => {
  assert(
    detectDifficulty({
      conversationHistory: [{ role: 'assistant', content: '3+5=?' }],
      latestUserMessage: '8',
    }) === 'simple',
    'simple: "3+5=?"'
  );
  assert(
    detectDifficulty({
      conversationHistory: [{ role: 'assistant', content: '8-2 はいくつかな？' }],
      latestUserMessage: '6',
    }) === 'simple',
    'simple: "8-2 はいくつかな？"'
  );
  assert(
    detectDifficulty({
      conversationHistory: [
        { role: 'assistant', content: '公園に7人います。3人帰りました。何人残っていますか？' },
      ],
      latestUserMessage: '4',
    }) === 'complex',
    'complex: "公園に7人います..."'
  );
  assert(
    detectDifficulty({
      conversationHistory: [
        { role: 'assistant', content: '50円の鉛筆を2本と100円のノートを買ったら全部でいくら？' },
      ],
      latestUserMessage: '200円',
    }) === 'complex',
    'complex: "50円の鉛筆..."'
  );
  assert(
    detectDifficulty({
      conversationHistory: [{ role: 'assistant', content: 'これは何の漢字ですか？' }],
      latestUserMessage: '雨',
    }) === 'standard',
    'standard: 漢字問題'
  );
});

group('detectFatigue', () => {
  assert(detectFatigue('もういい'), '"もういい"');
  assert(detectFatigue('次の問題にして'), '"次の問題にして"');
  assert(detectFatigue('べつのにしようかw'), '"べつのにしようかw"');
  assert(detectFatigue('めんどう'), '"めんどう"');
  assert(detectFatigue('くどいなぁ'), '"くどいなぁ"');
  assert(!detectFatigue('わかった！次やろう？'), 'false: "わかった！次やろう？"');
  assert(!detectFatigue('8'), 'false: "8" (回答)');
});

group('detectAnswerQuality', () => {
  assert(detectAnswerQuality('うん') === 'short', 'short: "うん"');
  assert(detectAnswerQuality('そう') === 'short', 'short: "そう"');
  assert(detectAnswerQuality('8') === 'short', 'short: "8"');
  assert(
    detectAnswerQuality('7と3を引いたら4だから') === 'descriptive',
    'descriptive: 説明文'
  );
});

group('countConsecutiveShortAnswers', () => {
  const history1: PromptMessage[] = [
    { role: 'user', content: 'まず7あって、引いて4だね' },
    { role: 'assistant', content: 'なぜそう思った？' },
    { role: 'user', content: 'うん' },
    { role: 'assistant', content: 'もう一度説明できる？' },
    { role: 'user', content: 'そう' },
  ];
  assert(countConsecutiveShortAnswers(history1) === 2, '直近2連続 short → 2');

  const history2: PromptMessage[] = [
    { role: 'user', content: 'うん' },
    { role: 'assistant', content: '...' },
    { role: 'user', content: '7と3を引き算して4' },
  ];
  assert(countConsecutiveShortAnswers(history2) === 0, '直近が descriptive なら 0');
});

group('extractSignals', () => {
  const ctx = {
    conversationHistory: [{ role: 'assistant' as const, content: '3+5=?' }],
    latestUserMessage: '8',
  };
  const signals = extractSignals(ctx);
  assert(signals.difficulty === 'simple', 'difficulty=simple');
  assert(signals.fatigueDetected === false, 'fatigueDetected=false');
  assert(signals.answerQuality === 'short', 'answerQuality=short ("8")');
});

group('buildAdaptiveGuidance', () => {
  const simple = buildAdaptiveGuidance({
    conversationHistory: [{ role: 'assistant', content: '3+5=?' }],
    latestUserMessage: '8',
  });
  assert(simple.includes('簡単'), 'simple: 簡単マーカー含む');
  assert(simple.includes('質問深度の自動調整'), 'simple: 自動調整セクション含む');
  assert(!simple.includes('疲労シグナル検知'), 'simple: 疲労ガイダンスは含まない');

  const fatigue = buildAdaptiveGuidance({
    conversationHistory: [{ role: 'assistant', content: '3+5=?' }],
    latestUserMessage: 'めんどう',
  });
  assert(fatigue.includes('疲労シグナル検知'), 'fatigue: 疲労ガイダンス含む');
  assert(fatigue.includes('即座に次の問題'), 'fatigue: 即座切替指示');

  const shortChain = buildAdaptiveGuidance({
    conversationHistory: [
      { role: 'assistant', content: 'なぜ？' },
      { role: 'user', content: 'うん' },
      { role: 'assistant', content: 'どう考えた？' },
    ],
    latestUserMessage: 'そう',
  });
  assert(shortChain.includes('単語回答の連続検知'), 'short: 単語回答ガイダンス含む');

  // 初回ターン: 空文字
  const empty = buildAdaptiveGuidance({
    conversationHistory: [],
    latestUserMessage: '',
  });
  assert(empty === '', 'empty: 初回ターンは空文字');
});

group('createSystemPrompt 統合', () => {
  // context なし: 基本プロンプトのみ（ガイダンス追記なし）
  const basicMath = createSystemPrompt('math');
  assert(basicMath.includes('算数'), 'context なし: 算数を含む');
  assert(!basicMath.includes('質問深度の自動調整'), 'context なし: ガイダンスは含まない');

  // context あり (simple): 簡単ガイダンスが追記される
  const adaptiveMath = createSystemPrompt('math', {
    conversationHistory: [{ role: 'assistant', content: '3+5=?' }],
    latestUserMessage: '8',
  });
  assert(adaptiveMath.includes('算数'), 'context あり: 算数を含む（教科コンテキスト保持）');
  assert(adaptiveMath.includes('質問深度の自動調整'), 'context あり: ガイダンス追記');
  assert(adaptiveMath.includes('テンポを優先'), 'context あり: simple ガイダンス内容');
  assert(
    adaptiveMath.indexOf('算数') < adaptiveMath.indexOf('質問深度の自動調整'),
    '基本プロンプトの後にガイダンス追記される順序'
  );

  // 教科コンテキスト保持の確認: 全教科で動作
  for (const subj of ['math', 'japanese', 'science', 'social']) {
    const prompt = createSystemPrompt(subj, {
      conversationHistory: [],
      latestUserMessage: 'こんにちは',
    });
    const expected = { math: '算数', japanese: '国語', science: '理科', social: '社会' }[subj]!;
    assert(prompt.includes(expected), `${subj}: ${expected} を含む`);
  }
});

group('実機シナリオ (要件1-3)', () => {
  // 要件1: 簡単問題 → simple ガイダンス
  const s1 = buildAdaptiveGuidance({
    conversationHistory: [{ role: 'assistant', content: '3+5=?' }],
    latestUserMessage: '8',
  });
  assert(s1.includes('テンポを優先'), '要件1: テンポ優先指示');

  // 要件2: 文章題 → complex ガイダンス
  const s2 = buildAdaptiveGuidance({
    conversationHistory: [
      { role: 'assistant', content: '公園に7人います。3人帰りました。何人残っていますか？' },
    ],
    latestUserMessage: '4',
  });
  assert(s2.includes('複雑') && s2.includes('1〜2段階'), '要件2: 複雑問題は1〜2段階');

  // 要件3: めんどう → 即次問題
  const s3 = buildAdaptiveGuidance({
    conversationHistory: [{ role: 'assistant', content: '3+5=?' }],
    latestUserMessage: 'めんどう',
  });
  assert(s3.includes('即座に次の問題'), '要件3: 即座切替指示');
});

console.log('\n========================================');
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
