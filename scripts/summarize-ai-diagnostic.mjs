import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const root = process.cwd();
const output = path.join(root, '.cache', 'ai-diagnostic-eval');
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'package.json'), '{"type":"commonjs"}');
/** 순수 처리 모듈을 로컬 재생용으로 컴파일한다. */
function compile(folder, relative = '') {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) compile(path.join(folder, entry.name), name);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      const target = path.join(output, name.replace(/\.ts$/, '.js'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(
        target,
        ts.transpileModule(readFileSync(path.join(folder, entry.name), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
        }).outputText,
      );
    }
  }
}
compile(path.join(root, 'src'));
const baselineSource = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', 'd710037:src/ai/contract.ts'], {
  encoding: 'utf8',
});
writeFileSync(
  path.join(output, 'baseline.js'),
  ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText,
);
const require = createRequire(import.meta.url);
const currentContract = require(path.join(output, 'ai/contract.js'));
const baselineContract = require(path.join(output, 'baseline.js'));
const { readProposals } = currentContract;
const { readProposals: readBaseline } = baselineContract;
for (const [commit, name, sourcePath] of [
  ['bf6157d', 'initial', 'src/ai/contract.ts'],
  ['d710037', 'baseline-import', 'src/ai/import.ts'],
  ['bf6157d', 'initial-import', 'src/ai/import.ts'],
]) {
  const source = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `${commit}:${sourcePath}`], {
    encoding: 'utf8',
  });
  writeFileSync(
    path.join(output, 'ai', `${name}.js`),
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText,
  );
}
const { readProposals: readInitial } = require(path.join(output, 'ai/initial.js'));
const { importProposal: importBaseline } = require(path.join(output, 'ai/baseline-import.js'));
const { importProposal: importInitial } = require(path.join(output, 'ai/initial-import.js'));
const { importProposal } = require(path.join(output, 'ai/import.js'));
const { emptyPlanning } = require(path.join(output, 'planning/types.js'));
const { validatePlanning } = require(path.join(output, 'planning/engine.js'));
const { extractPlanning } = require(path.join(output, 'planning/extract.js'));
const cases = JSON.parse(readFileSync('tests/ai-diagnostic-cases.json', 'utf8'));
const compact = (s) => String(s ?? '').replace(/\s/g, '');
/** 같은 실제 응답을 각 검증기에 재생하며 API를 호출하지 않는다. */
function validation(reader, raw, sources) {
  try {
    return { passed: true, proposals: reader(raw, sources) };
  } catch (error) {
    return { passed: false, issue: error.issue ?? { code: error.message } };
  }
}
/** 기준 버전의 첫 문자열 거부 필드를 원문과 대조한다. */
function baselineField(raw, sources, issue) {
  if (issue?.code !== 'UNSUPPORTED_LITERAL') return issue;
  for (let p = 0; p < (raw?.proposals ?? []).length; p++)
    for (let e = 0; e < raw.proposals[p].evidence.length; e++) {
      const evidence = raw.proposals[p].evidence[e];
      if (!sources.some((s) => s.id === evidence.sourceId && s.text.includes(evidence.quote))) continue;
      for (const field of ['number', 'unit', 'action', 'timing'])
        if (evidence[field] !== null && !evidence.quote.includes(evidence[field]))
          return { code: issue.code, path: `proposals[${p}].evidence[${e}].${field}` };
    }
  return issue;
}
/** 기대값은 결과 평가에만 사용한다. 모델 입력이나 앱 판정에는 사용하지 않는다. */
function relationCorrect(entry, raw) {
  if (entry.kind === null) return raw?.proposals?.length === 0;
  const proposals = raw?.proposals ?? [];
  if (!proposals.length || proposals.some((p) => p.kind !== entry.kind)) return false;
  const evidence = proposals.flatMap((p) => p.evidence);
  const required = entry.kind === 'allocation' ? entry.sources.slice(1) : entry.sources;
  return (
    required.every((s) => evidence.some((e) => e.sourceId === s.id)) &&
    evidence.every((e) => entry.targets.some((t) => compact(t) === compact(e.target))) &&
    (entry.kind !== 'action_conflict' || (evidence.some((e) => e.action === '중단') && evidence.some((e) => e.action === '유지')))
  );
}
/** 원문은 input에 한 번만 보존하고 엔진 근거는 위치로 연결한다. */
function planView(planning) {
  return {
    ...planning,
    ...Object.fromEntries(
      ['allocations', 'funds', 'actions'].map((kind) => [
        kind,
        planning[kind].map(({ references, ...row }) => ({
          ...row,
          references: references.map(({ source, fileName, location }) => ({ source, fileName, location })),
        })),
      ]),
    ),
  };
}
/** 실제 엔진 출력과 모의 확인 상태 실험을 구분한다. */
function engineView(results) {
  return results.map(({ code, status, actual, expected, difference, needs, basis, references }) => ({
    code,
    status,
    actual,
    expected,
    difference,
    needs,
    basis,
    locations: references?.map((r) => r.location),
  }));
}
const records = [];
for (const entry of cases) {
  const references = entry.sources.map((s) => ({ source: 'DOCX', fileName: 'synthetic.docx', location: s.id, originalText: s.text }));
  const rules = { ...emptyPlanning(), ...extractPlanning(references) };
  for (const mode of ['baseline', 'initial', 'candidate']) {
    const actual = JSON.parse(readFileSync(`.cache/diagnostic-${mode}-${entry.id}.json`, 'utf8'));
    const original = validation(readBaseline, actual.raw, entry.sources);
    const revised = validation(readProposals, actual.raw, entry.sources);
    original.issue = baselineField(actual.raw, entry.sources, original.issue);
    const used = mode === 'baseline' ? original : mode === 'initial' ? validation(readInitial, actual.raw, entry.sources) : revised;
    let planning = emptyPlanning();
    if (used.passed)
      for (const [i, p] of used.proposals.entries())
        planning = (mode === 'baseline' ? importBaseline : mode === 'initial' ? importInitial : importProposal)(
          planning,
          p,
          references,
          `diagnostic-${i}`,
        );
    const engine = validatePlanning([], planning);
    records.push({
      caseId: entry.id,
      mode,
      input: entry.sources,
      expectedKind: entry.kind,
      raw: actual.raw,
      relationCorrect: relationCorrect(entry, actual.raw),
      originalValidation: { passed: original.passed, issue: original.issue },
      revisedValidation: { passed: revised.passed, issue: revised.issue },
      applicationValidation: used,
      actualStatus: actual.status,
      actualDiagnostics: actual.result.diagnostics,
      metrics: actual.result.metrics,
      engineInput: planView(planning),
      engineEvaluation: 'Offline replay of actual AI output; no actual user approval or automatic app import.',
      adapterRevision: mode === 'baseline' ? 'd710037' : mode === 'initial' ? 'bf6157d' : 'f727a2f',
      engineResults: engineView(engine),
      ruleOnlyInput: planView(rules),
      ruleOnlyResults: engineView(validatePlanning([], rules)),
    });
  }
}
const summary = {};
for (const mode of ['baseline', 'initial', 'candidate']) {
  const rows = records.filter((r) => r.mode === mode);
  const positives = rows.filter((r) => r.expectedKind !== null),
    negatives = rows.filter((r) => r.expectedKind === null);
  const valid = (r) => r.applicationValidation.passed;
  summary[mode] = {
    calls: rows.length,
    positiveCases: positives.length,
    correctRelations: positives.filter((r) => r.relationCorrect).length,
    acceptedCorrectRelations: positives.filter((r) => valid(r) && r.relationCorrect).length,
    sourceValidationPass: rows.filter(valid).length,
    rawFalsePositives: negatives.filter((r) => r.raw?.proposals?.length > 0).length,
    acceptedFalsePositives: negatives.filter((r) => valid(r) && r.raw?.proposals?.length > 0).length,
    completedEngineCases: positives.filter((r) => r.engineResults.some((e) => e.status === '오류' || e.status === '검증 통과')).length,
    costUsd: rows.reduce((sum, r) => sum + (r.metrics?.estimatedUsd ?? 0), 0),
    elapsedMs: rows.map((r) => r.metrics?.elapsedMs),
  };
}
/** 실제 전송한 지침만 추출하며 환경변수나 키는 읽지 않는다. */
function promptOf(source) {
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.ES2023, true);
  for (const statement of ast.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.name.getText(ast) === 'PROMPT' && declaration.initializer && ts.isStringLiteral(declaration.initializer))
          return declaration.initializer.text;
  throw new Error('PROMPT_NOT_FOUND');
}
const originalServer = execFileSync(
  'git',
  ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', 'd710037:server/analyzeContext.ts'],
  { encoding: 'utf8' },
);
const report = {
  syntheticOnly: true,
  model: 'gpt-4o-mini',
  baselineCommit: 'd710037',
  requestSettings: { model: 'gpt-4o-mini', max_output_tokens: 1600, store: false, automaticRetries: 0, temperature: 'not supplied' },
  prompts: { baseline: promptOf(originalServer), candidate: promptOf(readFileSync('server/analyzeContext.ts', 'utf8')) },
  schemas: { baseline: baselineContract.outputSchema, candidate: currentContract.outputSchema },
  relationCriterion:
    'Expected kind, literal asset/product/benefit target, coverage of both relevant source sentences; action conflict must contain stop and maintain. Numeric grounding measured separately. No automatic user approval.',
  summary,
  records,
};
writeFileSync('docs/ai-diagnostic-evidence.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
