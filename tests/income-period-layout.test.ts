import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { feedbackWorkbook, feedbackWord } from './feedback-fixtures';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { suggestLinks } from '../src/normalization/links';
import { assessRelationship } from '../src/normalization/relationships';
import { periodOf } from '../src/normalization/unitContext';
import { inspectDocuments } from '../src/inspection/analyze';
import { reviewQuality } from '../src/inspection/quality';
import { emptyPlanning } from '../src/planning/types';

it.each([false, true])('가로로 반복된 월·연 소득을 직전 항목명에 대응시킨다 (%s)', async (reverse) => {
  const pairs = reverse ? ['부부 연 실수령액', 9600, '부부 월 실수령액', 800] : ['부부 월 실수령액', 800, '부부 연 실수령액', 9600];
  const items = extractWorkbook(
    await parseXlsx(await feedbackWorkbook([['단위: 만원'], ['구분', '내용', '구분', '내용'], pairs]), 'layout.xlsx'),
  );
  expect(items.map((c) => [c.label, c.period, c.normalizedValue])).toEqual(
    reverse
      ? [
          ['부부 연 실수령액', '연간', 96000000],
          ['부부 월 실수령액', '월간', 8000000],
        ]
      : [
          ['부부 월 실수령액', '월간', 8000000],
          ['부부 연 실수령액', '연간', 96000000],
        ],
  );
  const word = extractWord(
    await parseDocx(
      await feedbackWord([
        ['항목', '월간(만원)', '연간(만원)'],
        ['부부 실수령 소득', 800, 9600],
      ]),
      'layout.docx',
    ),
  );
  const all = [...items, ...word];
  for (const link of suggestLinks(all, [])) {
    const a = all.find((c) => c.id === link.xlsxId)!;
    const b = all.find((c) => c.id === link.docxId)!;
    if (a.period !== b.period) {
      expect(assessRelationship(a, b).periodConflict).toBe(true);
      continue;
    }
    expect(a.normalizedValue).toBe(b.normalizedValue);
  }
});

it('연 실수령액과 연봉을 연간으로 보존한다', () => {
  expect(periodOf('', '부부 연 실수령액', true)).toBe('연간');
  expect(periodOf('', '연봉', true)).toBe('연간');
});

/** 실제 문서는 환경변수로만 읽으며 저장소에 복사하지 않는다. */
it.skipIf(!process.env.PLANCHECK_NEWLYWED_XLSX || !process.env.PLANCHECK_NEWLYWED_DOCX)(
  '실제 신혼부부 문서에서 연간 소득을 월간 값과 연결하지 않는다',
  async () => {
    const buffer = (path: string) => {
      const b = readFileSync(path);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const x = extractWorkbook(await parseXlsx(buffer(process.env.PLANCHECK_NEWLYWED_XLSX!), 'actual.xlsx'));
    const w = extractWord(await parseDocx(buffer(process.env.PLANCHECK_NEWLYWED_DOCX!), 'actual.docx'));
    const annual = x.find((c) => c.location.endsWith('!D7'))!;
    expect(annual.label).toBe('부부 연 실수령액');
    expect(annual.period).toBe('연간');
    expect(annual.normalizedValue).toBe(84000000);
    const all = [...x, ...w];
    const husband = x.find((c) => /남편/.test(c.label) && !/부부|합산/.test(c.label) && c.period === '월간')!;
    const wife = x.find((c) => /아내/.test(c.label) && !/부부|합산/.test(c.label) && c.period === '월간')!;
    const combined = w.find((c) => c.field === 'income' && /부부 합산/.test(c.label) && c.period === '월간')!;
    expect(husband.normalizedValue).toBe(3900000);
    expect(wife.normalizedValue).toBe(3100000);
    expect(combined.normalizedValue).toBe(husband.normalizedValue! + wife.normalizedValue!);
    const quality = reviewQuality(inspectDocuments({ items: all, links: [], calculations: [], references: [], planning: emptyPlanning() }));
    const incomeCross = quality.filter((e) => e.finding.kind === 'CROSS' && e.finding.result.evidence.every((c) => c.field === 'income'));
    expect(incomeCross.filter((e) => e.tier === '우선 검토' && e.finding.signal === '수치 차이')).toHaveLength(0);
    for (const personal of [husband, wife]) {
      const record = incomeCross.find(
        (e) => e.finding.result.evidence.some((c) => c.id === personal.id) && e.finding.result.evidence.some((c) => c.id === combined.id),
      )!;
      expect(record.tier).toBe('상세 분석 기록');
      expect(record.finding.result.difference).toBeNull();
    }
    const links = suggestLinks(all, []).filter((l) => l.xlsxId === annual.id);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const other = w.find((c) => c.id === link.docxId)!;
      if (other.period !== '연간') {
        expect(assessRelationship(annual, other).periodConflict).toBe(true);
        continue;
      }
      expect(other.normalizedValue).toBe(annual.normalizedValue);
    }
  },
);
