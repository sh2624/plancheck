import type { Workbook, WordDocument } from '../parsers/types';
import type { Candidate, Field, Unit } from './types';
import { classify, normalize, unitOf } from './values';
import { isDateTimeFormat } from '../parsers/numberFormat';
import { declaredUnits, isHeader, isDateText, resolveUnit, periodOf, type UnitHint } from './unitContext';
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
const columnIndex = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const temporalCell = (c: Workbook['sheets'][number]['cells'][number]) =>
  c.type === 'd' || c.isDateTime || isDateText(c.value) || isDateTimeFormat(c.numberFormatId, c.numberFormat);
/** 숫자와 항목명이 같은 행에 있는 셀을 열 제목·명시 단위와 함께 후보화한다. */
export function extractWorkbook(book: Workbook): Candidate[] {
  const output: Candidate[] = [];
  for (const sheet of book.sheets) {
    const rows = new Map<number, typeof sheet.cells>();
    for (const cell of sheet.cells) rows.set(rowNumber(cell.address), [...(rows.get(rowNumber(cell.address)) ?? []), cell]);
    let sheetHint: UnitHint | undefined, tableHint: UnitHint | undefined;
    let meta = { asOf: '', scenario: '' },
      previousRow = 0,
      region = `${sheet.name}:1`,
      title = '',
      titleRow = 0;
    const headers = new Map<string, string>();
    const columnHints = new Map<string, UnitHint>();
    const sheetPeriods = new Map<string, string>();
    let headerPending = false;
    for (const cells of rows.values()) {
      const row = rowNumber(cells[0].address);
      if (previousRow && row > previousRow + 1) {
        headers.clear();
        columnHints.clear();
        tableHint = undefined;
        title = '';
        headerPending = false;
        region = `${sheet.name}:${row}`;
      }
      previousRow = row;
      const text = cells
        .map((c) => c.value)
        .filter(Boolean)
        .join(' | ');
      const units = declaredUnits(text.match(/단위\s*[:：]\s*([^·|\n]+)/)?.[1] ?? '');
      if (units.length && !cells.some((c) => isHeader(c.value))) {
        const hint: UnitHint = {
          units,
          location: `${sheet.name}!${cells[0].address}`,
          level:
            /시트\s*단위/.test(text) ||
            (!/표|현황|명세|내역/.test(text) && !headers.size && !output.some((c) => c.location.startsWith(sheet.name + '!')))
              ? 'sheet'
              : 'table',
        };
        if (hint.level === 'sheet') sheetHint = hint;
        else tableHint = hint;
      }
      const found = metadata(text);
      meta = {
        asOf: found.asOf || meta.asOf,
        scenario: found.scenario || meta.scenario,
      };
      const hasNumbers = cells.some((c) => numeric.test(c.value.trim()));
      if (!hasNumbers && cells.some((c) => isHeader(c.value))) {
        if (row !== titleRow + 1) tableHint = undefined;
        if (!headerPending) {
          headers.clear();
          columnHints.clear();
          region = `${sheet.name}:${row}`;
        }
        for (const c of cells)
          if (c.value)
            headers.set(
              column(c.address),
              headerPending && headers.has(column(c.address)) ? `${c.value.trim()} · ${headers.get(column(c.address))}` : c.value.trim(),
            );
        if (sheetHint) for (const c of cells) if (/^(월|연)$/.test(c.value.trim())) sheetPeriods.set(column(c.address), c.value.trim());
        for (const c of cells)
          if (declaredUnits(c.value).length) {
            const merge = sheet.merges.find((m) => m.startsWith(c.address + ':'));
            const covered = merge
              ? [...new Set(sheet.cells.map((x) => column(x.address)))].filter(
                  (col) =>
                    columnIndex(col) >= columnIndex(column(c.address)) && columnIndex(col) <= columnIndex(column(merge.split(':')[1])),
                )
              : [column(c.address)];
            for (const col of covered)
              columnHints.set(col, { units: declaredUnits(c.value), location: `${sheet.name}!${c.address}`, level: 'column' });
          }
        headerPending = true;
        continue;
      }
      if (!hasNumbers && cells.length === 1 && /표|현황|명세|내역/.test(text)) {
        headers.clear();
        columnHints.clear();
        region = `${sheet.name}:${row}`;
        title = text;
        titleRow = row;
        tableHint = declaredUnits(text).length
          ? { units: declaredUnits(text), location: `${sheet.name}!${cells[0].address}`, level: 'table' }
          : undefined;
        continue;
      }
      const firstNumeric = cells.findIndex((c) => numeric.test(c.value.trim()) && !temporalCell(c));
      headerPending = false;
      const labels = cells
        .slice(0, firstNumeric < 0 ? cells.length : firstNumeric)
        .filter((c) => c.value.trim() && !numeric.test(c.value.trim()) && !temporalCell(c));
      const label = labels.map((c) => c.value).join(' · ');
      const field =
        classify(label) ??
        (/^(합계|총계)$/.test(label) ? (/부채/.test(title) ? 'totalDebt' : /자산/.test(title) ? 'totalAssets' : null) : null);
      if (/단위|기준|※/.test(label)) continue;
      const values = firstNumeric < 0 ? [] : cells.slice(firstNumeric).filter((c) => numeric.test(c.value.trim()) || c.formula);
      let emitted = false;
      for (const c of values) {
        const header = headers.get(column(c.address)) ?? '';
        if (/대비|비율|비중|비고|상태|확정|기준일|일자|날짜/.test(header) || temporalCell(c)) continue;
        const valueField = field ?? classify(header);
        if (!valueField) continue;
        const valueLabel = field ? label : `${label} · ${header}`;
        const isPercent = !!c.numberFormat?.includes('%');
        if (isPercent && valueField !== 'loanRate') continue;
        const labelUnit = unitOf(valueLabel.match(/[（(]\s*(억\s*원|만\s*원|원|%|개월|년)\s*[）)]/)?.[1] ?? '');
        const explicit = isPercent ? '%' : unitOf(c.value) !== '미확인' ? unitOf(c.value) : labelUnit;
        const resolved = resolveUnit(
          explicit,
          [sheetHint, tableHint, columnHints.get(column(c.address))].filter((h): h is UnitHint => !!h),
          region,
          column(c.address),
        );
        const valueUnit = resolved.unit;
        const flowField = ['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(valueField);
        const period = periodOf(header || (flowField ? sheetPeriods.get(column(c.address)) : '') || '', valueLabel, flowField);
        const raw = c.review ? '' : isPercent ? String(Number(c.value) * 100) : c.value;
        const item = candidate(
          'XLSX',
          book.fileName,
          `${sheet.name}!${c.address}`,
          valueLabel,
          raw,
          valueField,
          valueUnit,
          text,
          meta,
          period,
          c.review
            ? '원본 수식/값 확인 필요'
            : resolved.evidence.level === 'conflict'
              ? '단위 선언 충돌 · 원문 범위를 확인하세요'
              : valueField === 'loanRate' && !isPercent
                ? '금리 표시 단위 확인 필요'
                : '',
        );
        item.originalNumber = c.value || null;
        item.unitEvidence = {
          ...resolved.evidence,
          locations: resolved.evidence.level === 'cell' ? [`${sheet.name}!${c.address}`] : resolved.evidence.locations,
        };
        output.push(item);
        emitted = true;
      }
      if (!emitted && !values.length && field)
        output.push(
          candidate(
            'XLSX',
            book.fileName,
            `${sheet.name}!${labels.at(-1)?.address ?? ''}`,
            label,
            '',
            field,
            resolveUnit(
              '미확인',
              [sheetHint, tableHint].filter((h): h is UnitHint => !!h),
              region,
              '',
            ).unit,
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
        /월\s*실수령(?:\s*소득)?|월\s*(?:소득|수입)|월\s*지출|월\s*저축(?:\s*[·ㆍ/]\s*투자)?|고정지출|변동지출|월\s*잉여금?|미배분\s*잉여|여유\s*자금|총자산|자산\s*합계|총부채|부채\s*합계|순자산|예금(?:·적금)?|적금|청약저축|ETF|퇴직연금(?:\(DC\))?|보증금|목표액|결혼자금|비상자금|의료비\s*예비비|전세자금|자금\s*출처|재원/g,
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
    if (key && !/loan/.test(field) && index - (key.index! + before.lastIndexOf(local) + Math.max(0, index - 45)) > 35) continue;
    if (key && !/loan/.test(field)) {
      const gap = local.slice(key.index! + key[0].length);
      if (!/^(?:[\s()·:：]|평가액|적립금|잔액|은|는|이|가|약|합계|총액|금액|적립|월|현재|일부|DC)*$/.test(gap)) continue;
      if (/월/.test(gap) && ['deposit', 'etf', 'pension'].includes(field)) field = 'savings';
    }
    const future = /(?:\d+\s*(?:년|개월)\s*후)/.exec(before)?.[0];
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
        future ?? (/월/.test(label) || (field === 'savings' && /월/.test(before)) ? '월간' : ''),
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
    let headers = block.rows[0] ?? [];
    const columnUnits = new Map<number, UnitHint>();
    let previousHeader = false;
    let category = '';
    block.rows.forEach((row, ri) => {
      if (row.some((c) => isHeader(c.text)) && !row.some((c) => numeric.test(c.text.trim()))) {
        if (!previousHeader) columnUnits.clear();
        const old = headers;
        headers = previousHeader
          ? row.map((c) => ({ ...c, text: `${c.text} · ${old.find((p) => p.column === c.column)?.text ?? ''}` }))
          : row;
        for (const c of row)
          if (declaredUnits(c.text).length)
            for (let col = c.column; col < c.column + c.span; col++)
              columnUnits.set(col, {
                units: declaredUnits(c.text),
                location: `${block.location} · ${ri + 1}행 ${c.column}열`,
                level: 'column',
              });
        previousHeader = true;
        return;
      }
      previousHeader = false;
      const first = row.findIndex(
        (c) => !isDateText(c.text) && (numeric.test(c.text.trim()) || c.text.split('/').every((x) => numeric.test(x.trim()))),
      );
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
      for (const c of row.slice(first)) {
        const header = headers.find((h) => h.column === c.column)?.text ?? '';
        if (/대비|비중|비율|비고|기준일|일자|날짜/.test(header) || isDateText(c.text)) continue;
        const parts = c.text.split('/').map((x) => x.trim());
        if (!parts.every((x) => numeric.test(x))) continue;
        for (const [partIndex, part] of parts.entries()) {
          const splitLabels = (labels.at(-1) ?? '').split('/').map((x) => x.trim());
          const partLabel =
            parts.length > 1 && splitLabels.length === parts.length ? splitLabels[partIndex] : field ? label : `${label} · ${header}`;
          const partField =
            parts.length > 1 ? (classify(partLabel) ?? classify(`${category} ${partLabel}`) ?? 'unknown') : (field ?? classify(header));
          if (!partField) continue;
          const hints: UnitHint[] = [
            ...(unit !== '미확인' ? [{ units: [unit], location: '본문 단위 선언', level: 'sheet' as const }] : []),
            ...(columnUnits.has(c.column) ? [columnUnits.get(c.column)!] : []),
          ];
          const resolved = resolveUnit(unitOf(part), hints, block.location, String(c.column));
          const u = resolved.unit;
          if (u === '%' && partField !== 'loanRate') continue;
          const item = candidate(
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
            periodOf(
              header,
              partLabel,
              ['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(partField) &&
                /월|매월/.test(partLabel),
            ),
            resolved.evidence.level === 'conflict'
              ? '단위 선언 충돌 · 원문 범위를 확인하세요'
              : parts.length > 1
                ? '복수 값 · 세부 항목을 확인해 주세요'
                : '',
          );
          item.unitEvidence = {
            ...resolved.evidence,
            locations: resolved.evidence.level === 'cell' ? [item.location] : resolved.evidence.locations,
          };
          output.push(item);
        }
      }
    });
  }
  return output;
}
