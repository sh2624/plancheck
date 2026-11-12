import { analyzeContext } from '../server/analyzeContext.js';
/** 키는 Vercel 서버 환경에서만 읽는다. */
export default {
  fetch(request: Request) {
    return analyzeContext(request, process.env);
  },
};
