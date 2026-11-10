import { FileCheck2, LockKeyhole } from "lucide-react";
import { DocumentPanel } from "./components/DocumentPanel";
import { WorkbookView } from "./components/WorkbookView";
import { WordView } from "./components/WordView";
import { parseXlsx } from "./parsers/xlsx";
import { parseDocx } from "./parsers/docx";
/** 로컬 문서 추출 작업 화면. */
export default function App() {
  return (
    <>
      <header>
        <div className="brand">
          <FileCheck2 aria-hidden />
          <strong>PlanCheck</strong>
          <span>문서 검수 작업 공간</span>
        </div>
        <span className="privacy">
          <LockKeyhole size={14} aria-hidden />
          브라우저 내 처리
        </span>
      </header>
      <main>
        <div className="intro">
          <h1>문서 추출</h1>
          <p>Excel 재무표와 Word 보고서를 선택하고 추출된 값과 위치를 확인합니다.</p>
        </div>
        <div className="scope">
          파일은 외부 서버로 전송하지 않습니다. 현재 단계에서는 데이터를 추출하며, 계산 검증이나 문서 간 비교는 수행하지
          않습니다.
        </div>
        <div className="workspace">
          <DocumentPanel extension="xlsx" title="Excel 재무표" parse={parseXlsx}>
            {(data) => <WorkbookView data={data} />}
          </DocumentPanel>
          <DocumentPanel extension="docx" title="Word 보고서" parse={parseDocx}>
            {(data) => <WordView data={data} />}
          </DocumentPanel>
        </div>
      </main>
      <footer>PlanCheck · XLSX / DOCX 원본 추출</footer>
    </>
  );
}
