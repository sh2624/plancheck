import { useRef, useState } from 'react';
import { FileSpreadsheet, FileText, X } from 'lucide-react';
import { Button } from './ui/button';
import { validateFile } from '../parsers/package';
import { digest } from '../session/checkpoint';
type Props<T> = {
  compact?: boolean;
  extension: 'xlsx' | 'docx';
  title: string;
  parse: (data: ArrayBuffer, name: string) => Promise<T>;
  children: (data: T) => React.ReactNode;
  summary?: (data: T) => React.ReactNode;
  onData?: (data: T | undefined, fingerprint?: string) => void;
};
/** 파일 변경 시 결과를 비우고 원본 지문과 최신 파싱 응답만 전달한다. */
export function DocumentPanel<T>({ extension, title, parse, children, onData, summary, compact = false }: Props<T>) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState('');
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  function reset() {
    generation.current++;
    setData(undefined);
    onData?.(undefined);
    setError('');
    setName('');
    setBusy(false);
    /** 같은 파일을 다시 등록해도 변경 이벤트가 발생하도록 입력을 비운다. */
    if (input.current) input.current.value = '';
  }
  async function upload(file?: File) {
    reset();
    if (!file) return;
    const version = generation.current;
    setName(file.name);
    try {
      validateFile(file, extension);
      setBusy(true);
      const bytes = await file.arrayBuffer();
      const result = await parse(bytes, file.name);
      let fingerprint: string | undefined;
      try {
        if (crypto.subtle) fingerprint = await digest(bytes);
      } catch {
        /* 파싱은 유지하고 세션 복원만 제한한다. */
      }
      if (version === generation.current) {
        setData(result);
        onData?.(result, fingerprint);
      }
    } catch (err) {
      if (version === generation.current) setError(err instanceof Error ? err.message : '문서를 읽을 수 없습니다.');
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  const Icon = extension === 'xlsx' ? FileSpreadsheet : FileText;
  return (
    <section className={`document-panel${compact ? ' document-panel-compact' : ''}`} aria-label={title}>
      <div className="panel-heading">
        <h2>
          <Icon size={20} aria-hidden />
          {title}
        </h2>
        <span className="muted">.{extension}</span>
      </div>
      <div className="upload">
        <label htmlFor={extension}>
          검토할 {title} 파일 선택 <span className="muted">· 최대 30MB</span>
        </label>
        <input
          ref={input}
          id={extension}
          aria-describedby={`${extension}-status`}
          type="file"
          accept={`.${extension}`}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        {name && (
          <div className="file-line">
            <span>{name}</span>
            <Button variant="outline" onClick={reset} aria-label={`${title} 초기화`}>
              <X size={14} />
              초기화
            </Button>
          </div>
        )}
      </div>
      <div aria-live="polite">
        <p id={`${extension}-status`} className="registration-status">
          {busy ? '등록 중' : error ? '등록 실패' : data ? '등록 완료 · 추출됨' : '미등록'}
        </p>
        {busy && <p role="status">파일을 추출하고 있습니다…</p>}
        {error && (
          <p role="alert" className="error">
            추출 실패: {error}
          </p>
        )}
      </div>
      {data && compact ? (
        <details className="document-advanced">
          <summary>추출 요약·원본 보기 · {title}</summary>
          {summary?.(data)}
          <details className="original-details">
            <summary>원본 상세 보기 · {title}</summary>
            {children(data)}
          </details>
        </details>
      ) : data ? (
        summary ? (
          <>
            {summary(data)}
            <details className="original-details" key={name}>
              <summary>원본 상세 보기 · {title}</summary>
              {children(data)}
            </details>
          </>
        ) : (
          children(data)
        )
      ) : (
        !compact &&
        !busy &&
        !error && (
          <div className="empty">
            <p>선택한 문서가 없습니다.</p>
            <p className="muted">파일을 선택하면 원본 내용과 위치를 표시합니다.</p>
          </div>
        )
      )}
    </section>
  );
}
