import { attr, children, descendants, openPackage } from './package';
import type { Paragraph, WordDocument, WordTable } from './types';
/** 문단의 탭과 줄바꿈을 포함한 텍스트를 문서 순서대로 보존한다. */
function textOf(node: Element): string {
  if (node.localName === 't') return node.textContent ?? '';
  if (node.localName === 'tab') return '\t';
  if (node.localName === 'br' || node.localName === 'cr') return '\n';
  return Array.from(node.children).map(textOf).join('');
}
/** 숫자 토큰은 해석하지 않고 원문 문맥과 함께 제공한다. */
function paragraph(node: Element, location: string): Paragraph {
  const text = textOf(node);
  return {
    kind: 'paragraph',
    location,
    text,
    numbers: text.match(/[-+]?\d[\d,]*(?:\.\d+)?(?:\s*(?:억|천만|백만|만|천)?원|%|개월|년|세)?/g) ?? [],
  };
}
/** 본문 문단과 표의 행·열, 가로/세로 병합 및 문단 위치를 추출한다. */
export async function parseDocx(data: ArrayBuffer, fileName: string): Promise<WordDocument> {
  const read = await openPackage(data);
  const xml = await read('word/document.xml');
  const body = descendants(xml, 'body')[0];
  if (!body) throw new Error('Word 본문을 찾을 수 없습니다.');
  const blocks: WordDocument['blocks'] = [];
  let p = 0,
    t = 0;
  for (const node of Array.from(body.children)) {
    if (node.localName === 'p') blocks.push(paragraph(node, `본문 문단 ${++p}`));
    if (node.localName === 'tbl') {
      const location = `본문 표 ${++t}`;
      const rows: WordTable['rows'] = children(node, 'tr').map((row, ri) => {
        let column = Number(attr(descendants(children(row, 'trPr')[0] ?? row, 'gridBefore')[0], 'val') ?? 0) + 1;
        return children(row, 'tc').map((cell) => {
          const props = children(cell, 'tcPr')[0];
          const span = Number((props && attr(descendants(props, 'gridSpan')[0], 'val')) || 1);
          const mergeNode = props && descendants(props, 'vMerge')[0];
          const start = column;
          column += span;
          const paragraphs = descendants(cell, 'p').map((el, pi) => paragraph(el, `${location} · ${ri + 1}행 ${start}열 · 문단 ${pi + 1}`));
          return {
            column: start,
            span,
            merge: mergeNode ? (attr(mergeNode, 'val') ?? 'continue') : undefined,
            text: paragraphs.map((p) => p.text).join('\n'),
            paragraphs,
          };
        });
      });
      blocks.push({ kind: 'table', location, rows });
    }
  }
  return { fileName, blocks };
}
