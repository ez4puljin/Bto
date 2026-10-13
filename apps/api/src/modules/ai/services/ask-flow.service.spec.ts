import type { LlmClient, LlmRequest, LlmResult } from '../../../integrations/llm';
import { LlmError } from '../../../integrations/llm';
import type { AuthContext } from '../../identity';
import type { AiReaderService, AiResult } from '../sql/ai-reader.service';
import { AiQueryError } from '../sql/ai-reader.service';
import { AskFlowService } from './ask-flow.service';
import type { ConversationsService, QuestionRecord } from './conversations.service';

const actor = { userId: 7 } as AuthContext;
const ROWS: AiResult = {
  columns: [{ name: 'n', kind: 'number' }],
  rows: [['1']],
  truncated: false,
};

/** The flow's decisions with stubs: which failures end a question and which go back to the model. */
describe('AskFlowService', () => {
  let answers: (string | Error)[];
  let calls: LlmRequest[];
  let runs: (AiResult | AiQueryError)[];
  let logged: QuestionRecord[];
  let flow: AskFlowService;

  beforeEach(() => {
    answers = [];
    calls = [];
    runs = [];
    logged = [];
    const llm: LlmClient = {
      provider: 'openai',
      model: 'stub',
      complete(request: LlmRequest): Promise<LlmResult> {
        calls.push(request);
        const next = answers.shift();
        if (next === undefined) return Promise.reject(new Error('no answer'));
        if (next instanceof Error) return Promise.reject(next);
        return Promise.resolve({
          text: next,
          model: 'stub',
          usage: { inputTokens: 1, outputTokens: 1 },
        });
      },
    };
    const reader = {
      configured: true,
      run: () => {
        const next = runs.shift();
        if (!next) return Promise.reject(new Error('no run'));
        return next instanceof AiQueryError ? Promise.reject(next) : Promise.resolve(next);
      },
    } as unknown as AiReaderService;
    const conversations = {
      history: () => Promise.resolve([]),
      record: (_actor: AuthContext, record: QuestionRecord) => {
        logged.push(record);
        return Promise.resolve({ conversationId: 1, question: { id: 1, status: record.status } });
      },
    } as unknown as ConversationsService;
    flow = new AskFlowService(llm, reader, conversations);
  });

  const query = (sql: string) => JSON.stringify({ kind: 'query', sql, explanation: 'x' });

  it('never asks the model to repair a timeout', async () => {
    answers.push(query('SELECT 1'));
    runs.push(new AiQueryError('DATABASE', '57014', 'canceling statement', false));
    await flow.ask(actor, { question: 'Удаан?' });
    expect(calls).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 'FAILED', errorCode: '57014', repaired: false });
  });

  it('keeps the first failure when the repair call itself fails', async () => {
    answers.push(query('SELECT nope'), new LlmError('TIMEOUT', 'no answer'));
    runs.push(new AiQueryError('DATABASE', '42703', 'column "nope" does not exist', true));
    await flow.ask(actor, { question: 'Засах?' });
    expect(calls).toHaveLength(2);
    expect(logged[0]).toMatchObject({ status: 'FAILED', errorCode: '42703', sql: 'SELECT nope' });
  });

  it('answers without a summary when the summary call fails', async () => {
    answers.push(query('SELECT 1'), new LlmError('HTTP', 'overloaded', { status: 529 }));
    runs.push(ROWS);
    const answer = await flow.ask(actor, { question: 'Нэг?' });
    expect(answer.result).toEqual(ROWS);
    expect(logged[0]).toMatchObject({ status: 'ANSWERED', summary: null, rowCount: 1 });
  });

  it('asks for no summary of an empty result', async () => {
    answers.push(query('SELECT 1 WHERE false'));
    runs.push({ ...ROWS, rows: [] });
    await flow.ask(actor, { question: 'Хоосон?' });
    expect(calls).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 'ANSWERED', rowCount: 0, summary: null });
  });

  it('turns an answer outside the schema into a provider failure', async () => {
    answers.push('{"kind":"query","sql":""}');
    await expect(flow.ask(actor, { question: 'Буруу?' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_FAILED',
      params: { reason: 'INVALID_RESPONSE' },
    });
    expect(logged).toEqual([]);
  });
});
