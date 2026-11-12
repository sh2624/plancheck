import { useState } from 'react';
import type { Candidate, Unit } from '../normalization/types';
import { bulkUnitIds, unitRangeKey } from '../normalization/bulkUnits';
import { Button } from './ui/button';
/** 표·열 범위 단위를 명시적으로 지정한다. 기존 원문은 보존하고 사용자 확인·관련 승인은 해제된다. */
export function BulkUnits({ items, onEdit }: { items: Candidate[]; onEdit: (id: string, patch: Partial<Candidate>) => void }) {
  const ranges = [...new Map(items.filter((c) => c.unitEvidence && !c.excluded).map((c) => [unitRangeKey(c), c])).entries()];
  const [key, setKey] = useState(''),
    [column, setColumn] = useState(''),
    [unit, setUnit] = useState<Unit>('미확인'),
    [message, setMessage] = useState('');
  const members = items.filter((c) => unitRangeKey(c) === key),
    columns = [...new Set(members.map((c) => c.unitEvidence?.column).filter(Boolean))];
  if (!ranges.length) return null;
  const ids = bulkUnitIds(items, key, column, unit);
  return (
    <details className="bulk-units">
      <summary>표·열 단위 일괄 지정</summary>
      <p>선택한 범위의 단위를 직접 확인해 지정합니다. 셀에 명시된 단위는 유지하며, 변경된 값과 관련 연결은 다시 확인해야 합니다.</p>
      <div className="recommendation-filters">
        <label>
          단위를 지정할 표
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setColumn('');
              setMessage('');
            }}
          >
            <option value="">선택</option>
            {ranges.map(([value, c]) => (
              <option key={value} value={value}>
                {c.source} · {c.fileName} · {c.unitEvidence!.region}
              </option>
            ))}
          </select>
        </label>
        <label>
          단위를 지정할 열
          <select value={column} onChange={(e) => setColumn(e.target.value)}>
            <option value="">표 전체</option>
            {columns.map((v) => (
              <option key={v} value={v}>
                {v}열
              </option>
            ))}
          </select>
        </label>
        <label>
          범위에 적용할 단위
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {['미확인', '원', '만 원', '억 원', '%', '개월', '년'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={!key || unit === '미확인' || !ids.length}
          onClick={() => {
            for (const id of ids) {
              const c = items.find((c) => c.id === id)!;
              onEdit(id, { unit, unitEvidence: { ...c.unitEvidence!, userOverride: true } });
            }
            setMessage(`${ids.length}개 항목에 단위를 적용했습니다. 값과 연결을 다시 확인해 주세요.`);
          }}
        >
          선택 범위에 단위 적용
        </Button>
      </div>
      <p role="status">{message}</p>
    </details>
  );
}
