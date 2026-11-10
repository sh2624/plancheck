import { useState, useRef, useEffect } from 'react';
import type { Candidate, Link } from '../normalization/types';
import { checkpointKey, createCheckpoint, parseCheckpoint, restoreCheckpoint, documentsMatch } from '../session/checkpoint';
import type { Documents } from '../session/checkpoint';
import { Button } from './ui/button';
type Props = {
  items: Candidate[];
  links: Link[];
  documents: Documents;
  getRevision?: () => number;
  onRestore: (value: { items: Candidate[]; links: Link[] }) => void;
};
const noRevision = () => 0;
/** 원문을 보관하지 않는 사용자 선택형 탭 세션 체크포인트. 저장과 복원 모두 명시적으로 실행한다. */
export function SessionReview({ items, links, documents, onRestore, getRevision = noRevision }: Props) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(() => {
    try {
      return parseCheckpoint(sessionStorage.getItem(checkpointKey));
    } catch {
      return null;
    }
  });
  function stillCurrent(ticket: number) {
    if (!alive.current) return false;
    if (ticket !== getRevision()) {
      setNotice('검토 내용이 변경되어 저장·복원을 취소했습니다. 현재 상태에서 다시 실행하세요.');
      return false;
    }
    return true;
  }
  async function save() {
    if (!consent) return;
    const ticket = getRevision();
    setBusy(true);
    try {
      const checkpoint = await createCheckpoint(items, links, documents);
      if (!stillCurrent(ticket)) return;
      sessionStorage.setItem(checkpointKey, JSON.stringify(checkpoint));
      setSaved(checkpoint);
      setNotice(`확인·제외 상태 ${checkpoint.entries.length}개와 승인 연결 ${checkpoint.links.length}개를 저장했습니다.`);
    } catch {
      if (alive.current) setNotice('저장할 수 없습니다. 문서 지문·브라우저 저장 허용 여부를 확인하세요.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function restore() {
    if (!consent || !saved) return;
    const ticket = getRevision();
    setBusy(true);
    try {
      const next = await restoreCheckpoint(saved, items, links, documents);
      if (!stillCurrent(ticket)) return;
      onRestore({ items: next.items, links: next.links });
      setNotice(`${next.restored}개 확인·제외 상태를 복원했습니다. 편집값이 원문과 달랐던 항목은 다시 확인해야 합니다.`);
    } catch (err) {
      if (alive.current) setNotice(err instanceof Error ? err.message : '복원하지 못했습니다.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="session-review">
      <summary>새로고침 전 확인 상태 임시 저장</summary>
      <p className="muted">
        현재 탭의 sessionStorage에 확인·제외 상태와 승인 연결의 해시만 저장합니다. 원문·금액·파일명·수정값·직접 추가한 항목·계산 범위·구조화
        계획은 저장하지 않습니다. 새로고침 후 같은 파일을 다시 올리고 복원 버튼을 눌러야 합니다.
      </p>
      <label className="scope-confirm">
        <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />이 탭에 검토 상태의 해시를
        임시 저장·복원하는 데 동의합니다.
      </label>
      <div className="steps">
        <Button
          variant="outline"
          disabled={!consent || busy || !crypto.subtle || !Object.keys(documents).length}
          onClick={() => void save()}
        >
          확인 상태 임시 저장
        </Button>
        <Button
          variant="outline"
          disabled={!consent || busy || !crypto.subtle || !saved || !documentsMatch(saved.documents, documents)}
          onClick={() => void restore()}
        >
          동일 파일의 확인 상태 복원
        </Button>
        <Button
          variant="outline"
          disabled={busy || !saved}
          onClick={() => {
            try {
              sessionStorage.removeItem(checkpointKey);
              setSaved(null);
              setNotice('저장한 검토 상태를 삭제했습니다.');
            } catch {
              setNotice('저장 상태를 삭제할 수 없습니다.');
            }
          }}
        >
          임시 저장 삭제
        </Button>
      </div>
      {saved && <p className="muted">저장된 확인 상태 {saved.entries.length}개 · 동일한 파일 지문을 확인한 뒤 복원할 수 있습니다.</p>}
      <p role="status">{notice}</p>
    </details>
  );
}
