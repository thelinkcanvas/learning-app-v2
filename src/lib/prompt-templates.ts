/**
 * 教材テンプレート画像生成用プロンプトライブラリ
 *
 * Research Prompt 1（Nano Banana 2 / Gemini 3.1 Flash Image）に基づく設計。
 *
 * 重要原則：
 * 1. 指示は英語、出力テキストは日本語（二段階言語指定）
 * 2. リテラル文字列はダブルクォーテーションで囲む（"算数" など）
 * 3. 描画する日本語は 10 文字以下に抑える（精度 98%）
 * 4. UD デジタル教科書体を明示指定（児童の可読性）
 * 5. "Children's book illustration" は禁止 → "Flat vector design" を使う
 */

export type Subject = 'math' | 'japanese' | 'science' | 'social';

export const SUBJECT_LABELS_JA: Record<Subject, string> = {
  math: '算数',
  japanese: '国語',
  science: '理科',
  social: '社会',
};

export type Grade = 1 | 2 | 3 | 4 | 5 | 6;

export interface TemplatePromptInput {
  subject: Subject;
  grade: Grade;
  /** テンプレートに描画する短い見出し。10 文字以下推奨 */
  title?: string;
  /** バリエーション ID（同一プロンプトでも異なる出力を得るためのシード代わり） */
  variationId?: number;
}

/**
 * 共通の品質誘導フレーズ（全教科で再利用）
 *
 * - "Flat vector design": 装飾ノイズを抑制
 * - "Minimalist educational infographic": 情報整理された教科書トーン
 * - "High contrast": 視認性確保
 * - "UD Digital Kyokasho font": 児童向け可読性
 */
const COMMON_STYLE = [
  'Flat vector design',
  'Minimalist educational infographic',
  'Clean solid white background',
  'High contrast',
  'Soft natural color palette suitable for elementary school textbooks',
  'No 3D effects',
  'No decorative noise',
  'No watermark',
].join(', ');

const FONT_DIRECTIVE =
  'Use a highly legible Japanese UD Digital Kyokasho font (UDデジタル教科書体). ' +
  'Strokes must be uniform in thickness, with clear stops (tome) and hooks (hane). ' +
  'Do not use thin Mincho serifs.';

/**
 * 教科別プロンプト生成器
 *
 * 各教科の認知負荷特性に合わせて、構図・色彩・要素を最適化する。
 */
export function buildPrompt(input: TemplatePromptInput): string {
  const { subject, grade } = input;
  const labelJa = SUBJECT_LABELS_JA[subject];
  const titleJa = input.title ?? labelJa;

  // 描画文字数を 10 文字以下に強制
  const safeTitle = titleJa.length > 10 ? titleJa.slice(0, 10) : titleJa;

  switch (subject) {
    case 'math':
      return mathPrompt(grade, safeTitle, input.variationId);
    case 'japanese':
      return japanesePrompt(grade, safeTitle, input.variationId);
    case 'science':
      return sciencePrompt(grade, safeTitle, input.variationId);
    case 'social':
      return socialPrompt(grade, safeTitle, input.variationId);
  }
}

/* -------------------------------------------------------------------------- */
/* 算数：幾何学的整合性が命。thinkingLevel: high を併用すること                */
/* -------------------------------------------------------------------------- */
function mathPrompt(grade: Grade, title: string, variation = 1): string {
  return `
Generate a minimalist, highly structured educational math worksheet template
for Japanese elementary school grade ${grade}.

Style: ${COMMON_STYLE}.

Required elements:
1. Draw a subtle 10x10 light blue coordinate grid centered in the image.
   Grid lines must be perfectly straight and evenly spaced.
2. Place a brightly colored 2D geometric shape (variation ${variation}) on the grid intersections.
   The shape vertices must snap exactly to grid points.
3. Render the exact Japanese text "${title}" at the top left corner.
   ${FONT_DIRECTIVE}
4. Render the exact number "${grade}" inside a clean yellow circle
   immediately to the right of the title text.

Composition: Spacious, mathematically precise layout.
Text must have absolute typographic perfection, mimicking professional textbook publishing.
Do not generate any pseudo-characters, gibberish, or decorative random shapes.
`.trim();
}

/* -------------------------------------------------------------------------- */
/* 国語：縦書きと原稿用紙が肝。"top to bottom" を強調指示                       */
/* -------------------------------------------------------------------------- */
function japanesePrompt(grade: Grade, title: string, variation = 1): string {
  const motif =
    variation % 2 === 0
      ? 'a flat-vector illustration of a stylized owl reading an open book'
      : 'a flat-vector illustration of a small fox holding a brush';

  return `
Generate a clean, traditional educational Japanese language textbook template
for Japanese elementary school grade ${grade}.

Style: ${COMMON_STYLE}, traditional Japanese textbook aesthetic.

Required elements:
1. Background: traditional Japanese manuscript paper (Genkouyoushi) pattern
   with light green, perfectly square grids covering the entire page.
2. Render the exact Japanese text "${title}" at the top right corner.
   CRITICAL: This text must be written VERTICALLY (reading from top to bottom),
   character by character, NOT rotated horizontally.
   ${FONT_DIRECTIVE}
3. Place ${motif} in the bottom left corner. Keep it small and non-distracting.

Composition: The vertical text orientation is mandatory and must be enforced strictly.
Each Kanji and Hiragana character must be rendered with absolute perfection,
showing clear strokes and correct proportions.
Do not generate any pseudo-characters or gibberish.
`.trim();
}

/* -------------------------------------------------------------------------- */
/* 理科：観察・実験図解。粒子モデルや天体は概念化が肝                          */
/* -------------------------------------------------------------------------- */
function sciencePrompt(grade: Grade, title: string, variation = 1): string {
  const motif = pickScienceMotif(grade, variation);

  return `
Generate a clean educational science worksheet template
for Japanese elementary school grade ${grade}.

Style: ${COMMON_STYLE}, scientific diagram aesthetic with clear labels.

Required elements:
1. Center: ${motif}
   Draw it as a labeled scientific diagram with simple arrows pointing to key parts.
   Use a limited palette (no more than 4 colors).
2. Render the exact Japanese text "${title}" at the top left corner.
   ${FONT_DIRECTIVE}
3. Render the exact number "${grade}" inside a clean light-green circle
   to the right of the title.

Composition: Diagrammatic clarity over decoration.
Arrows and labels must look like a real elementary textbook figure.
Do not generate any pseudo-characters or fictional creatures.
`.trim();
}

function pickScienceMotif(grade: Grade, variation: number): string {
  // 学年と認知発達段階に沿ったモチーフ
  const motifs: Record<Grade, string[]> = {
    1: ['a labeled diagram of a sunflower', 'a labeled diagram of a butterfly life cycle'],
    2: ['a labeled diagram of a tomato plant growth stages', 'a labeled diagram of a tadpole becoming a frog'],
    3: ['a labeled diagram of a magnet attracting iron pieces', 'a labeled diagram of plant roots, stem, leaves'],
    4: ['a labeled diagram of a simple electric circuit with a battery and bulb', 'a labeled diagram of water states (solid liquid gas)'],
    5: ['a labeled diagram of salt dissolving in water at the particle level', 'a labeled diagram of pendulum motion'],
    6: ['a labeled diagram of human blood circulation simplified', 'a labeled diagram of a food chain in a pond'],
  };
  const list = motifs[grade];
  return list[(variation - 1) % list.length];
}

/* -------------------------------------------------------------------------- */
/* 社会：地形・地図は image search grounding をプロンプトで明示                  */
/* -------------------------------------------------------------------------- */
function socialPrompt(grade: Grade, title: string, variation = 1): string {
  const motif = pickSocialMotif(grade, variation);

  return `
Use image search to find accurate geographic and cultural references for Japanese social studies.

Generate an educational infographic template for Japanese elementary school grade ${grade}.

Style: ${COMMON_STYLE}, data-visualization aesthetic, clean light-blue ocean background where applicable.

Required elements:
1. Center: ${motif}
   Geographical and historical accuracy is the highest priority.
   Do not hallucinate landmasses, flags, or fictional symbols.
2. Render the exact Japanese text "${title}" at the top center as a large title.
   ${FONT_DIRECTIVE}
3. Use a bold sans-serif weight for the title to ensure readability for young students.

Composition: Real-world accuracy is mandatory.
The shapes of islands, regions, or buildings must reflect reality.
`.trim();
}

function pickSocialMotif(grade: Grade, variation: number): string {
  const motifs: Record<Grade, string[]> = {
    1: ['a friendly illustration of a Japanese neighborhood with houses, a park, and a school', 'an illustration of common seasonal events in Japan'],
    2: ['a simplified map showing key facilities in a Japanese town (school, post office, station)', 'an illustration of public transportation in Japan'],
    3: ['a simplified prefectural-level map showing the local region of Japan', 'an illustration of a Japanese supermarket and how products arrive'],
    4: ['a simplified flat-vector map of all Japanese prefectures with colored regions', 'an illustration of the water purification process from river to home'],
    5: ['a flat-vector map of Japan showing major rice-producing regions in green', 'a flat-vector map showing major industrial belts of Japan'],
    6: ['a timeline illustration of major Japanese historical periods (Jomon to Meiji) with simple icons', 'a simplified diagram of how the Japanese Diet works'],
  };
  const list = motifs[grade];
  return list[(variation - 1) % list.length];
}

/**
 * セーフティ用：プロンプトが過剰に長くないか、危険語が含まれていないか軽く検査。
 */
export function lintPrompt(prompt: string): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (prompt.length > 4000) {
    warnings.push(`プロンプトが長すぎる可能性 (${prompt.length} chars). モデル指示追従性が低下する恐れ`);
  }
  if (/violence|weapon|blood|gun/i.test(prompt)) {
    warnings.push('安全フィルターに抵触する語が含まれている可能性');
  }
  return { ok: warnings.length === 0, warnings };
}
