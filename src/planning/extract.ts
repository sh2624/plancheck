import type { Workbook, WordDocument } from '../parsers/types';
import type { EvidenceRef } from '../validation/types';
import type { Candidate } from '../normalization/types';
import { unitOf } from '../normalization/values';
import { newRecord } from './types';
import type { Planning, PlanAction, ConditionalFund, RecordBase } from './types';
import { textContext } from './textContext';
import { reflectedFunds } from './fundText';
/** XLSX의 행과 DOCX 문단·표 행을 위치가 있는 원본 문맥으로 제공한다. */
export function workbookReferences(book: Workbook): EvidenceRef[] {
  return book.sheets.flatMap((sheet) => {
    const rows = new Map<string, typeof sheet.cells>();
    for (const cell of sheet.cells) {
      const r = cell.address.match(/\d+/)?.[0] ?? cell.address;
      rows.set(r, [...(rows.get(r) ?? []), cell]);
    }
    return [...rows.values()]
      .filter((cells) => cells.some((c) => c.value.trim()))
      .map((cells) => ({
        source: 'XLSX' as const,
        fileName: book.fileName,
        location: `${sheet.name}!${cells.map((c) => c.address).join(',')}`,
        originalText: cells
          .map((c) => c.value)
          .filter(Boolean)
          .join(' | '),
      }));
  });
}
/** DOCX 문단과 표 행의 원문 및 원본 행·열 위치를 보존한다. */
export function wordReferences(doc: WordDocument): EvidenceRef[] {
  return doc.blocks
    .flatMap((block) =>
      block.kind === 'paragraph'
        ? [
            {
              source: 'DOCX' as const,
              fileName: doc.fileName,
              location: block.location,
              originalText: block.text,
            },
          ]
        : block.rows.map((row, i) => ({
            source: 'DOCX' as const,
            fileName: doc.fileName,
            location: `${block.location} · ${i + 1}행 (${row.map((c) => `${c.column}열`).join(',')})`,
            originalText: row.map((c) => c.text).join(' | '),
          })),
    )
    .filter((r) => r.originalText.trim());
}
/** 중단 설명을 유지로 추론하지 않으며 부정·복수 행동은 미확인으로 남긴다. */
export function actionOf(text: string): PlanAction['action'] {
  if (/(?:중단|중지|유지|시작|재개|증액|감액)\s*(?:하지|하지는|하지도|안|하지말)|(?:않|말아|말고)/.test(text)) return '미확인';
  const found = new Set<PlanAction['action']>();
  if (/중단|중지|멈춘/.test(text)) found.add('중단');
  if (/유지|계속\s*(?:납입|이체|적립)/.test(text)) found.add('유지');
  if (/시작|재개|개시/.test(text)) found.add('시작');
  if (/증액|늘린/.test(text)) found.add('증액');
  if (/감액|줄인/.test(text)) found.add('감액');
  return found.size === 1 ? [...found][0] : '미확인';
}
/** 제한된 어휘는 후보 탐색에만 사용한다. 대상 ID·행동·시점은 사용자 확인이 필요하다. */
export function extractPlanning(refs: EvidenceRef[]): Pick<Planning, 'actions' | 'funds'> {
  const actions: PlanAction[] = [],
    funds: ConditionalFund[] = [];
  let side: PlanAction['side'] = '미확인';
  let sourceKey = '',
    inherited = textContext(''),
    globalContext = textContext('');
  for (const ref of refs) {
    const key = `${ref.source}:${ref.fileName}`;
    if (key !== sourceKey) {
      side = '미확인';
      inherited = textContext('');
      globalContext = textContext('');
      sourceKey = key;
    }
    if (/^\s*\d+\s*단계/.test(ref.originalText)) inherited = globalContext;
    const own = textContext(ref.originalText);
    const context = Object.fromEntries(Object.entries(own).map(([k, v]) => [k, v || inherited[k as keyof typeof own]])) as typeof own;
    if (/문서\s*(?:전체|공통)|전체\s*문서/.test(ref.originalText)) globalContext = context;
    if (/기간|시나리오/.test(ref.originalText) && !/적립|자동이체|배정|충당|포함|합산/.test(ref.originalText)) inherited = context;
    if (/실행\s*(계획|내용|일정)|5단계|실행은/.test(ref.originalText)) side = '실행';
    else if (/4단계|설계안|제안|권고/.test(ref.originalText)) side = '제안';
    const clauses = ref.originalText.split(/(?<=[다요])\.\s+|[;\n]|→/).filter(Boolean);
    clauses.forEach((text, i) => {
      const key = `${ref.source}:${ref.fileName}:${ref.location}:${i}`;
      if (/중단|중지|유지|시작|재개|증액|감액|늘린|줄인/.test(text)) {
        const withoutAmount = text.replace(/(?:월\s*)?\d[\d,]*(?:\.\d+)?\s*(?:억\s*원|만\s*원|원)/g, ' ');
        const target =
          withoutAmount.match(
            /([A-Za-z가-힣][A-Za-z0-9가-힣·&_-]*(?:\s+(?:ETF|ISA))?)\s*(?:월\s*)?(?:신규\s*)?(?:적립|자동이체|투자|저축)/,
          )?.[1] ??
          text.match(/ETF|ISA|퇴직연금|연금저축|적금|예금/)?.[0] ??
          '';
        if (target && !/^(?:원|월|신규|해당|금액)$/.test(target)) {
          const action = actionOf(text);
          const amounts = [...text.matchAll(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(억\s*원|만\s*원|원)/g)];
          actions.push({
            ...newRecord('action', `auto:action:${key}`),
            label: text.trim().slice(0, 80),
            origin: '자동 후보',
            targetId: target,
            side: /제안|권고/.test(text)
              ? '제안'
              : /실행/.test(text)
                ? '실행'
                : side !== '미확인'
                  ? side
                  : /자동이체/.test(text)
                    ? '실행'
                    : side,
            action,
            amount: amounts.length === 1 ? amounts[0][1] : '',
            unit: amounts.length === 1 ? unitOf(amounts[0][2]) : '미확인',
            start: context.start,
            end: context.end,
            scenario: context.scenario,
            relation: { kind: 'action', timing: context.timing, explicit: true },
            references: [ref],
            note:
              action === '미확인'
                ? '부정 또는 복수 행동·문맥을 확인하세요.'
                : '대상 동일성·행동·적용 기간·제안/실행 구분을 확인하세요. 자동 추출은 확정되지 않습니다.',
          });
        }
      }
      if (/지원금|지원|세액공제|정부기여금|기여금|보험금|환급/.test(text)) {
        const reflected = reflectedFunds(text);
        if (reflected.length) {
          for (const [fi, value] of reflected.entries())
            funds.push({
              ...newRecord('fund', `auto:fund:${key}:${fi}`),
              ...value,
              origin: '자동 후보',
              references: [ref],
              certainty: /조건부|선정\s*시|확정\s*시/.test(text)
                ? '조건부'
                : /예상|미확정/.test(text)
                  ? '가정'
                  : /(?:^|[·\s])확정(?:[·\s]|$)/.test(text) && reflected.length === 1
                    ? '확정'
                    : '미확인',
              approval:
                reflected.length !== 1
                  ? '미확인'
                  : /미승인|승인\s*전/.test(text)
                    ? '미승인'
                    : /승인\s*완료|승인됨/.test(text)
                      ? '승인'
                      : '미확인',
              received:
                reflected.length !== 1
                  ? '미확인'
                  : /미수령|수령\s*전/.test(text)
                    ? '미수령'
                    : /수령\s*완료|수령됨/.test(text)
                      ? '수령'
                      : '미확인',
              destination: /예상\s*시나리오|참고\s*시나리오/.test(text)
                ? '예상 시나리오'
                : /현재\s*(?:확정\s*)?자산/.test(text)
                  ? '현재 자산'
                  : /확정\s*수입/.test(text)
                    ? '확정 수입'
                    : '미확인',
              scenario: context.scenario,
              reflectedAt: text.match(/반영일\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? '',
              relation: { kind: 'reflection', timing: context.timing, explicit: true },
              note: '원문에 자산·수입 반영 관계가 있습니다. 지급 조건·승인·수령 및 반영 시점은 별도로 확인하세요.',
            });
          return;
        }
        const amounts = [...text.matchAll(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(억\s*원|만\s*원|원)/g)];
        const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, '');
        const ambiguousAmount = /\d[\d,.]*\s*[~～–-]\s*\d|억\s*(?:원\s*)?\d/.test(withoutDates);
        const value = amounts.length === 1 && !ambiguousAmount ? amounts[0] : undefined;
        funds.push({
          ...newRecord('fund', `auto:fund:${key}`),
          label: text.trim().slice(0, 80),
          origin: '자동 후보',
          references: [ref],
          amount: value?.[1] ?? '',
          unit: value ? unitOf(value[2]) : '미확인',
          certainty: /조건부|선정\s*시|확정\s*시/.test(text) ? '조건부' : '미확인',
          note: '승인·수령·현재 반영 여부는 추론하지 않습니다. 복수 금액은 직접 선택·입력하세요.',
        });
      }
    });
  }
  return { actions, funds };
}
/** 파일 교체·초기화 시 해당 원본에 의존하는 구조화 항목을 제거한다. */
export function replacePlanningSource(
  state: Planning,
  source: Candidate['source'],
  removedIds: Set<string>,
  refs: EvidenceRef[],
): Planning {
  const affected = (r: RecordBase) => r.references.some((ref) => ref.source === source) || r.candidateIds.some((id) => removedIds.has(id));
  const next = extractPlanning(refs);
  return {
    ...state,
    allocations: state.allocations.filter((r) => !affected(r) && !removedIds.has(r.assetId) && !removedIds.has(r.goalId)),
    funds: [...state.funds.filter((r) => !affected(r)), ...next.funds],
    actions: [...state.actions.filter((r) => !affected(r)), ...next.actions],
  };
}
