#!/usr/bin/env node

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

interface ConversationLog {
  subject: string;
  date: string;
  messages: {
    role: 'user' | 'assistant';
    content: string;
  }[];
}

interface ReportData {
  week: string;
  subjects: Record<
    string,
    {
      messages: number;
      userQuestions: string[];
      keyInsights: string[];
    }
  >;
  highlights: string[];
  growthPoints: string[];
}

// サンプル分析エンジン（Gemini API 連携は Day 4 で実装）
function analyzeConversations(logs: ConversationLog[]): ReportData {
  const reportData: ReportData = {
    week: new Date().toISOString().split('T')[0],
    subjects: {},
    highlights: [],
    growthPoints: [],
  };

  logs.forEach((log) => {
    if (!reportData.subjects[log.subject]) {
      reportData.subjects[log.subject] = {
        messages: 0,
        userQuestions: [],
        keyInsights: [],
      };
    }

    const subject = reportData.subjects[log.subject];
    subject.messages += log.messages.length;

    // Extract user questions
    log.messages.forEach((msg) => {
      if (msg.role === 'user' && msg.content.includes('?')) {
        subject.userQuestions.push(msg.content.substring(0, 100));
      }
    });
  });

  // Generate highlights based on activity
  Object.entries(reportData.subjects).forEach(([subject, data]) => {
    if (data.messages > 5) {
      reportData.highlights.push(
        `📚 ${subject}: ${data.messages}回の質問と対話を重ねました`
      );
    }
  });

  // Add growth points
  reportData.growthPoints = [
    '💪 何度も質問をし直す粘り強さ',
    '🧠 「なぜ？」という深い問いが増えた',
    '✨ 自分で答えを探そうとする意識が見られた',
  ];

  return reportData;
}

function generateMarkdownReport(data: ReportData): string {
  let md = `# 📚 週末学習レポート\n\n`;
  md += `**期間**: ${data.week}\n\n`;

  md += `## 📊 この週の学習内容\n\n`;

  Object.entries(data.subjects).forEach(([subject, stats]) => {
    md += `### ${subject.toUpperCase()}\n`;
    md += `- 質問数: ${stats.userQuestions.length}回\n`;
    md += `- 対話数: ${stats.messages}回\n`;
    if (stats.userQuestions.length > 0) {
      md += `- 主な質問: "${stats.userQuestions[0]}..."\n`;
    }
    md += `\n`;
  });

  md += `## ✨ 今週の成長ポイント\n\n`;
  data.growthPoints.forEach((point) => {
    md += `${point}\n`;
  });

  md += `\n## 💡 親からのコメント\n\n`;
  md += `[保護者の方へ: ここに週末の勉強を見守った感想をお書きください]\n`;

  md += `\n---\n`;
  md += `*このレポートは AI 家庭教師が自動生成しました*\n`;

  return md;
}

function generateHtmlReport(data: ReportData): string {
  let html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>週末学習レポート</title>
  <style>
    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f7fa;
      color: #333;
    }
    h1 { color: #1e40af; border-bottom: 3px solid #1e40af; }
    h2 { color: #0284c7; margin-top: 30px; }
    .subject-card {
      background: white;
      border-left: 4px solid #0284c7;
      padding: 15px;
      margin: 10px 0;
      border-radius: 4px;
    }
    .growth-point {
      background: #ecfdf5;
      border-left: 4px solid #10b981;
      padding: 12px 15px;
      margin: 8px 0;
      border-radius: 4px;
    }
    .highlight {
      background: #fef3c7;
      padding: 12px;
      margin: 8px 0;
      border-radius: 4px;
    }
    .parent-note {
      background: #e0e7ff;
      padding: 15px;
      margin-top: 30px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>📚 週末学習レポート</h1>
  <p><strong>期間</strong>: ${data.week}</p>

  <h2>📊 この週の学習内容</h2>
`;

  Object.entries(data.subjects).forEach(([subject, stats]) => {
    html += `
  <div class="subject-card">
    <h3>${subject.toUpperCase()}</h3>
    <p>質問数: <strong>${stats.userQuestions.length}回</strong></p>
    <p>対話数: <strong>${stats.messages}回</strong></p>
  </div>
`;
  });

  html += `<h2>✨ 今週の成長ポイント</h2>`;
  data.growthPoints.forEach((point) => {
    html += `<div class="growth-point">${point}</div>`;
  });

  html += `
  <div class="parent-note">
    <h3>💡 親からのコメント</h3>
    <p>[保護者の方へ: ここに週末の勉強を見守った感想をお書きください]</p>
  </div>

  <p style="margin-top: 40px; text-align: center; color: #666; font-size: 12px;">
    このレポートは AI 家庭教師が自動生成しました
  </p>
</body>
</html>
`;

  return html;
}

async function loadConversationLogs(subject?: string): Promise<ConversationLog[]> {
  const logsDir = path.join(process.cwd(), 'src', 'lib', 'logs');

  // For now, return sample data
  // In Day 4, we'll integrate localStorage data from actual sessions
  const sampleLogs: ConversationLog[] = [
    {
      subject: 'math',
      date: new Date().toISOString().split('T')[0],
      messages: [
        { role: 'user', content: '23 + 15 はいくつ？' },
        {
          role: 'assistant',
          content: 'いい質問だね。一の位から考えてみようか。',
        },
        { role: 'user', content: '3 + 5 = 8、20 + 10 = 30 だから 38？' },
        { role: 'assistant', content: 'すごいやん！その通り！' },
      ],
    },
    {
      subject: 'japanese',
      date: new Date().toISOString().split('T')[0],
      messages: [
        { role: 'user', content: '「これ」と「それ」の違いは？' },
        {
          role: 'assistant',
          content: 'いい質問だ。文の中で何を指しているか考えてみようか。',
        },
      ],
    },
  ];

  return subject ? sampleLogs.filter((log) => log.subject === subject) : sampleLogs;
}

async function main() {
  console.log(chalk.bold.cyan('\n📊 週末進捗レポート生成スクリプト\n'));

  try {
    // Load conversation logs
    const logs = await loadConversationLogs();
    console.log(chalk.gray(`📝 ${logs.length}個の学習セッションを読み込みました`));

    // Analyze conversations
    const reportData = analyzeConversations(logs);
    console.log(chalk.green('✓ 会話を分析しました'));

    // Generate reports
    const mdReport = generateMarkdownReport(reportData);
    const htmlReport = generateHtmlReport(reportData);

    // Save reports
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const mdPath = path.join(reportsDir, `report-${timestamp}.md`);
    const htmlPath = path.join(reportsDir, `report-${timestamp}.html`);

    fs.writeFileSync(mdPath, mdReport);
    fs.writeFileSync(htmlPath, htmlReport);

    console.log(chalk.green('✓ レポート生成完了'));
    console.log(`  📄 Markdown: ${mdPath}`);
    console.log(`  🌐 HTML: ${htmlPath}`);

    console.log(chalk.bold.cyan('\n📈 レポート概要:'));
    reportData.highlights.forEach((h) => console.log(`  ${h}`));

    console.log(chalk.bold.green('\n✨ 週末レポートの準備が完了しました！\n'));
  } catch (error) {
    console.error(chalk.red('エラーが発生しました:'), error);
    process.exit(1);
  }
}

main();
