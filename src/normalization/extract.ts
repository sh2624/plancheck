import type { Workbook, WordDocument } from '../parsers/types';
import type { Candidate, Field, Unit } from './types';
import { classify, normalize, unitOf } from './values';
const numeric = /^[+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*(?:억\s*원|만\s*원|원|%|개월|년)?$/i;
const token = /[+-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/i;
function metadata(text: string) {
  return {
    asOf: text.match(/(?:기준\s*(?:시점|시기|일)?\s*[:：]?\s*)([^·\n]{1,24})/)?.[1]?.trim() ?? '',
    scenario: text.match(/(?:[A-D]안|대체\s*시나리오|기본안|위기\s*예산|시나리오\s*[A-D가-힣0-9]+)/)?.[0] ?? '',
  };
}
function certainty(text: string): Candidate['certainty'] {
  if (/조건부|선정\s*시|확정\s*시|가정.*조건/.test(text)) return '조건부';
  if (/미확인|확인\s*(필요|전|후|중)|미정/.test(text)) return '미확인';
  if (/가정|추정|시뮬레이션|기대수익/.test(text)) return '가정';
  if (/확정/.test(text)) return '확정';
  return '미확인';
}
/** 원문을 보존한 후보를 만들고 모든 자동 추출의 사용자 확인을 미완료로 시작한다. */
function candidate(
  source: Candidate['source'],
  fileName: string,
  location: string,
  label: string,
  raw: string,
  field: Field,
  unit: Unit,
  context: string,
  meta: { asOf: string; scenario: string },
  period: string,
  note = '',
): Candidate {
  const number = raw.match(token)?.[0] ?? '';
  return {
    id: `${source}:${location}:${label}`,
    source,
    fileName,
    location,
    label,
    originalText: context,
    originalNumber: number || null,
    number,
    unit,
    normalizedValue: normalize(number, unit),
    field,
    ...meta,
    period,
    certainty: certainty(context),
    confirmed: false,
    excluded: false,
    method: source === 'XLSX' ? '행·열 문맥' : '문단 근접 문맥',
    confidence: note || !number || unit === '미확인' ? '확인 필요' : '문맥 일치',
    note,
  };
}
function column(address: string) {
  return address.replace(/\d/g, '');
}
function rowNumber(address: string) {
  return Number(address.match(/\d+/)?.[0] ?? 0);
}
/** 숫자와 항목명이 같은 행에 있는 셀을 열 제목·명시 단위와 함께 후보화한다. */
export function extractWorkbook(book: Workbook): Candidate[] {
  const output: Candidate[] = [];
  for (const sheet of book.sheets) {
    const rows = new Map<number, typeof sheet.cells>();
    for (const cell of sheet.cells) rows.set(rowNumber(cell.address), [...(rows.get(rowNumber(cell.address)) ?? []), cell]);
    let unit: Unit = '미확인',
      meta = { asOf: '', scenario: '' };
    const headers = new Map<string, string>();
    for (const cells of rows.values()) {
      const text = cells
        .map((c) => c.value)
        .filter(Boolean)
        .join(' | ');
      if (/단위\s*[:：]/.test(text)) unit = unitOf(text.match(/단위\s*[:：]\s*([^·|\n]+)/)?.[1] ?? '');
      const found = metadata(text);
      meta = {
        asOf: found.asOf || meta.asOf,
        scenario: found.scenario || meta.scenario,
      };
      if (cells.some((c) => /^(항목|금액|구분|월|연)$/.test(c.value.trim()))) {
        for (const c of cells) if (c.value) headers.set(column(c.address), c.value.trim());
      }
      const firstNumeric = cells.findIndex((c) => numeric.test(c.value.trim()) && c.type !== 's' && c.type !== 'inlineStr');
      const labels = cells
        .slice(0, firstNumeric < 0 ? cells.length : firstNumeric)
        .filter((c) => c.value.trim() && !numeric.test(c.value.trim()));
      const label = labels.map((c) => c.value).join(' · ');
      const field = classify(label);
      if (!field || /단위|기준|※/.test(label)) continue;
      const values = firstNumeric < 0 ? [] : cells.slice(firstNumeric).filter((c) => numeric.test(c.value.trim()) || c.formula);
      let emitted = false;
      for (const c of values) {
        const header = headers.get(column(c.address)) ?? '';
        if (/대비|비율|비중|비고|상태|확정/.test(header)) continue;
        const isPercent = !!c.numberFormat?.includes('%');
        if (isPercent && field !== 'loanRate') continue;
        const valueUnit: Unit =
          field === 'loanRate'
            ? isPercent
              ? '%'
              : unitOf(label)
            : field === 'loanTerm'
              ? unitOf(label)
              : unitOf(c.value) === '미확인'
                ? unit
                : unitOf(c.value);
        const period =
          header === '연'
            ? '연간'
            : header === '월' ||
                (['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(field) &&
                  /월|고정지출|변동지출|저축·투자/.test(label))
              ? '월간'
              : '';
        const raw = c.review ? '' : isPercent ? String(Number(c.value) * 100) : c.value;
        const item = candidate(
          'XLSX',
          book.fileName,
          `${sheet.name}!${c.address}`,
          label,
          raw,
          field,
          valueUnit,
          text,
          meta,
          period,
          c.review ? '원본 수식/값 확인 필요' : field === 'loanRate' && !isPercent ? '금리 표시 단위 확인 필요' : '',
        );
        item.originalNumber = c.value || null;
        output.push(item);
        emitted = true;
      }
      if (!emitted && !values.length)
        output.push(
          candidate(
            'XLSX',
            book.fileName,
            `${sheet.name}!${labels.at(-1)?.address ?? ''}`,
            label,
            '',
            field,
            unit,
            text,
            meta,
            '',
            '값 없음 · 주변 셀 확인 필요',
          ),
        );
    }
  }
  return output;
}
/** 문단에서 명시 단위가 있는 수치만 근접 항목명에 연결하고 복잡한 문장은 확인 대상으로 남긴다. */
function prose(text: string, location: string, fileName: string, globalMeta: { asOf: string; scenario: string }): Candidate[] {
  const result: Candidate[] = [];
  const matches = [...text.matchAll(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(억\s*원|만\s*원|원|%|개월)/g)];
  for (const match of matches) {
    const index = match.index!;
    const before = text.slice(Math.max(0, index - 45), index);
    const loanMentions = [...text.slice(0, index).matchAll(/학자금대출|신용대출|전세대출/g)];
    const loan = loanMentions.at(-1);
    const local = before.split(/[,.。;\n]/).at(-1) ?? before;
    const keywords = [
      ...local.matchAll(
        /월\s*실수령(?:\s*소득)?|월\s*소득|고정지출|변동지출|월\s*잉여|미배분\s*잉여|여유\s*자금|총자산|자산\s*합계|총부채|부채\s*합계|순자산|예금(?:·적금)?|적금|ETF|퇴직연금(?:\(DC\))?|보증금|목표액|결혼자금|비상자금|의료비\s*예비비|전세자금|자금\s*출처|재원/g,
      ),
    ];
    const key = keywords.at(-1);
    let label = key?.[0] ?? '',
      field = label ? classify(label) : null;
    const u = unitOf(match[2]);
    if (
      loan &&
      index - loan.index! < 160 &&
      ((u === '%' && /연\s*(?:약\s*)?$/.test(before)) ||
        /잔액(?:은|이)?\s*$/.test(before) ||
        /월\s*(?:상환액(?:은)?|약)?\s*$/.test(before) ||
        (u === '개월' && /상환|원리금|대출/.test(text.slice(loan.index!, index))))
    ) {
      field = u === '%' ? 'loanRate' : u === '개월' ? 'loanTerm' : /잔액/.test(before) ? 'loanBalance' : 'loanPayment';
      label = `${loan[0]} ${field === 'loanRate' ? '연금리' : field === 'loanBalance' ? '잔액' : field === 'loanTerm' ? '기간' : '월 상환액'}`;
    }
    if (!field || !label || (u === '%' && field !== 'loanRate') || (u === '개월' && field !== 'loanTerm')) continue;
    if (key && !/loan/.test(field) && index - (key.index! + Math.max(0, index - 45)) > 35) continue;
    if (key && !/loan/.test(field)) {
      const gap = local.slice(key.index! + key[0].length);
      if (!/^(?:[\s()·:：]|평가액|적립금|잔액|은|는|이|가|약|합계|총액|금액|적립|월|현재|일부|DC)*$/.test(gap)) continue;
      if (/월/.test(gap) && ['deposit', 'etf', 'pension'].includes(field)) field = 'savings';
    }
    result.push(
      candidate(
        'DOCX',
        fileName,
        `${location} · 문자 ${index + 1}`,
        label,
        match[1],
        field,
        u,
        text,
        {
          asOf: globalMeta.asOf,
          scenario: metadata(text).scenario || globalMeta.scenario,
        },
        /월/.test(label) ? '월간' : '',
        '문단 근접 추출 · 수치의 대상과 적용 시점 확인 필요',
      ),
    );
  }
  if (/재무목표|^·\s*\d.*(?:자금|상환|이동|노후)/.test(text)) {
    const name = text.split(/[：:]/)[0].slice(0, 100);
    const goal = candidate(
      'DOCX',
      fileName,
      `${location} · 목표`,
      name,
      '',
      'goal',
      '미확인',
      text,
      globalMeta,
      '',
      '목표명·목표액·재원·기한을 확인해 주세요',
    );
    result.push(goal);
    const date = text.match(/\d{4}년\s*\d{1,2}월(?:까지)?|\d{4}년\s*(?:상반기|하반기|안)/)?.[0];
    if (date)
      result.push({
        ...candidate('DOCX', fileName, `${location} · 기한`, date, '', 'deadline', '미확인', text, globalMeta, '', '기한 문맥 확인 필요'),
        period: date,
      });
    const funding = text.match(/(?:재원|자금\s*출처)은?\s*([^。\n]+?)(?:이다\.|$)/)?.[1];
    if (funding)
      result.push(
        candidate(
          'DOCX',
          fileName,
          `${location} · 재원`,
          funding,
          '',
          'fundingSource',
          '미확인',
          text,
          globalMeta,
          '',
          '자금 출처 문맥 확인 필요',
        ),
      );
  }
  return result;
}
/** Word의 표 헤더와 본문 단위 선언을 이용하고 반복되는 원본 후보를 모두 유지한다. */
export function extractWord(doc: WordDocument): Candidate[] {
  const output: Candidate[] = [];
  let unit: Unit = '미확인',
    meta = { asOf: '', scenario: '' };
  for (const block of doc.blocks) {
    if (block.kind === 'paragraph') {
      if (/단위\s*[:：]/.test(block.text)) unit = unitOf(block.text.match(/단위\s*[:：]\s*([^·\n]+)/)?.[1] ?? '');
      const found = metadata(block.text);
      if (/기준\s*(시점|일)/.test(block.text))
        meta = {
          asOf: found.asOf || meta.asOf,
          scenario: found.scenario || meta.scenario,
        };
      output.push(...prose(block.text, block.location, doc.fileName, meta));
      continue;
    }
    const headers = block.rows[0] ?? [];
    let category = '';
    block.rows.forEach((row, ri) => {
      if (ri === 0 && row.some((c) => /^(항목|금액|월|구분|내용)$/.test(c.text))) return;
      const first = row.findIndex((c) => numeric.test(c.text.trim()) || c.text.split('/').every((x) => numeric.test(x.trim())));
      if (first < 0) {
        const name = row
          .slice(0, 2)
          .map((c) => c.text)
          .join(' · ');
        const missingField = classify(name);
        if (missingField && row.length > 1 && row.slice(1).some((c) => /^(?:\s*|—|-|미정|미확인)$/.test(c.text))) {
          output.push(
            candidate(
              'DOCX',
              doc.fileName,
              `${block.location} · ${ri + 1}행`,
              name,
              '',
              missingField,
              unit,
              row.map((c) => c.text).join(' | '),
              meta,
              '',
              '값 없음 · 원문 확인 필요',
            ),
          );
        }
        for (const c of row) for (const p of c.paragraphs) output.push(...prose(p.text, p.location, doc.fileName, meta));
        return;
      }
      const labels = row
        .slice(0, first)
        .map((c) => c.text)
        .filter(Boolean);
      if (row[0]?.text && /^(고정지출|변동지출|저축·투자)$/.test(row[0].text)) category = row[0].text;
      const label = labels.join(' · '),
        field = classify(label) ?? classify(`${category} ${label}`);
      if (!field) return;
      for (const c of row.slice(first)) {
        const header = headers.find((h) => h.column === c.column)?.text ?? '';
        if (/대비|비중|비율|비고/.test(header)) continue;
        const parts = c.text.split('/').map((x) => x.trim());
        if (!parts.every((x) => numeric.test(x))) continue;
        for (const [partIndex, part] of parts.entries()) {
          const splitLabels = (labels.at(-1) ?? '').split('/').map((x) => x.trim());
          const partLabel = parts.length > 1 && splitLabels.length === parts.length ? splitLabels[partIndex] : label;
          const partField = parts.length > 1 ? (classify(partLabel) ?? classify(`${category} ${partLabel}`) ?? 'unknown') : field;
          const u = unitOf(part) === '미확인' ? unit : unitOf(part);
          if (u === '%' && partField !== 'loanRate') continue;
          output.push(
            candidate(
              'DOCX',
              doc.fileName,
              `${block.location} · ${ri + 1}행 ${c.column}열 · 값 ${partIndex + 1}`,
              partLabel,
              part,
              partField,
              u,
              row.map((x) => x.text).join(' | '),
              {
                asOf: meta.asOf,
                scenario: metadata(header).scenario || meta.scenario,
              },
              header === '월' ? '월간' : header === '연' ? '연간' : (header.match(/\d{4}/)?.[0] ?? ''),
              parts.length > 1 ? '복수 값 · 세부 항목을 확인해 주세요' : '',
            ),
          );
        }
      }
    });
  }
  return output;
}
