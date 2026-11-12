import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const destination = path.join(root, '.cache', 'ai-diagnostic-app');
mkdirSync(destination, { recursive: true });
for (const name of [
  'src',
  'server',
  'api',
  'public',
  'package.json',
  'package-lock.json',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tsconfig.server.json',
  'vercel.json',
  '.vercelignore',
])
  cpSync(path.join(root, name), path.join(destination, name), { recursive: true });
mkdirSync(path.join(destination, '.vercel'), { recursive: true });
cpSync(path.join(root, '.vercel', 'project.json'), path.join(destination, '.vercel', 'project.json'));
for (const name of ['server/analyzeContext.ts', 'src/ai/contract.ts']) {
  const target = path.join(destination, 'baseline', name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `d710037:${name}`], { cwd: root }),
  );
}
const cases = JSON.parse(readFileSync(path.join(root, 'tests/ai-diagnostic-cases.json'), 'utf8')).map(({ id, sources }) => ({
  id,
  sources,
}));
/** 임시 핸들러에는 고정 비식별 입력만 넣고 기대값은 모델에 보내지 않는다. */
writeFileSync(
  path.join(destination, 'api/analyze-context.ts'),
  `
import { analyzeContext } from '../server/analyzeContext.js';
import { analyzeContext as baseline } from '../baseline/server/analyzeContext.js';
const cases = ${JSON.stringify(cases)};
export default { async fetch(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview' || request.method !== 'POST') return Response.json({error:'DIAGNOSTIC_ONLY'}, {status:403});
  const body = await request.json();
  const entry = cases.find(c => c.id === body.caseId);
  if (!entry || !['baseline','candidate'].includes(body.mode) || Object.keys(body).some(k => !['caseId','mode'].includes(k))) return Response.json({error:'FIXED_SYNTHETIC_CASE_REQUIRED'}, {status:400});
  let raw: unknown = null;
  const capture: typeof fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (response.ok) {
      const result = await response.clone().json();
      const text = (result.output ?? []).flatMap((o: {content?: {type:string;text?:string}[]}) => o.content ?? []).filter((c:{type:string}) => c.type === 'output_text').map((c:{text:string}) => c.text).join('');
      try { raw = JSON.parse(text); } catch { raw = {invalidJson:true}; }
    }
    return response;
  };
  const input = new Request(request.url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,sources:entry.sources})});
  const result = await (body.mode === 'baseline' ? baseline : analyzeContext)(input, process.env, capture);
  return Response.json({caseId:entry.id,mode:body.mode,status:result.status,result:await result.json(),raw},{headers:{'Cache-Control':'no-store'}});
} };
`,
);
console.log('Prepared fixed-synthetic Preview diagnostics in .cache/ai-diagnostic-app. No key or local document copied.');
