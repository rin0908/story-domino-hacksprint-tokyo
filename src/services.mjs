import neo4j from 'neo4j-driver';
import { Daytona } from '@daytona/sdk';
import { STORY } from './story.mjs';
import { buildValidationCode } from './validation.mjs';

const MAX_RESPONSE_BYTES = 100 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const EXECUTION_TIMEOUT_SECONDS = 20;
const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scenes', 'reason', 'ending'],
  properties: {
    scenes: { type: 'array', minItems: 5, maxItems: 5, items: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'text'],
      properties: {
        id: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        title: { type: 'string', minLength: 1 },
        text: { type: 'string', minLength: 1 },
      },
    } },
    reason: { type: 'string', minLength: 1 },
    ending: { type: 'string', minLength: 1 },
  },
};
const SECRET_FIELDS = [
  'NEO4J_PASSWORD', 'NEO4J_URI', 'NEO4J_USERNAME', 'NOSANA_API_KEY',
  'NOSANA_INFERENCE_API_KEY', 'NOSANA_CHAT_COMPLETIONS_URL', 'NOSANA_ENDPOINT',
  'DAYTONA_API_KEY', 'DAYTONA_API_URL', 'DAYTONA_SANDBOX_ID',
];

// Never attach provider errors as causes: SDK errors can contain request secrets.
export class ServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

export function redactSecrets(value, config = {}) {
  const secrets = SECRET_FIELDS.map(key => config[key])
    .filter(value => typeof value === 'string' && value.length > 0)
    .sort((a, b) => b.length - a.length);
  const redact = item => {
    if (typeof item === 'string') {
      let safe = item;
      for (const secret of secrets) safe = safe.split(secret).join('[非表示]');
      return safe.replace(/https?:\/\/[^\s"'<>]+/gi, '[接続先は非表示]');
    }
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, redact(child)]));
    }
    return item;
  };
  return redact(value);
}

function fail(code, message) { throw new ServiceError(code, message); }
function present(config, key) { return typeof config[key] === 'string' && config[key].trim() !== ''; }
function requireFields(config, keys, service) {
  if (keys.some(key => !present(config, key))) {
    fail(`${service}_NOT_CONFIGURED`, '接続設定が不足しています。ローカルの .env を確認してください。');
  }
}

function configuredUrl(raw, service, { httpsOnly = false } = {}) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    if (httpsOnly && url.protocol !== 'https:') throw new Error();
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
    return url;
  } catch {
    fail(`${service}_INVALID_URL`, '接続先の設定が不正です。HTTPS の実際の API URL を確認してください。');
  }
}

async function guarded(service, action) {
  try { return await action(); }
  catch (error) {
    if (error instanceof ServiceError) throw error;
    // Inspect only a provider's error classification, never its potentially secret message.
    if (/timeout|timedout|timed_out/i.test(`${error?.name || ''} ${error?.code || ''}`)) {
      fail(`${service}_TIMEOUT`, 'サービスの応答が時間内に届きませんでした。稼働状態を確認して、もう一度お試しください。');
    }
    fail(`${service}_REQUEST_FAILED`, 'サービスへの接続または処理に失敗しました。接続設定とサービスの稼働状態を確認してください。');
  }
}

function parseJson(text, service) {
  try { return JSON.parse(text); }
  catch { fail(`${service}_INVALID_JSON`, 'サービスが正しい JSON を返しませんでした。結果は採用されていません。'); }
}

async function readBounded(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    fail('NOSANA_RESPONSE_TOO_LARGE', '生成サービスの応答が上限を超えました。');
  }
  if (!response.body) fail('NOSANA_EMPTY_RESPONSE', '生成サービスから本文が返りませんでした。');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail('NOSANA_RESPONSE_TOO_LARGE', '生成サービスの応答が上限を超えました。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!total) fail('NOSANA_EMPTY_RESPONSE', '生成サービスから本文が返りませんでした。');
  return Buffer.concat(chunks, total).toString('utf8');
}

const GRAPH_SEED_QUERY = `
MERGE (story:StoryDominoStory {namespace: $namespace, id: $storyId})
ON CREATE SET story.title = $title
MERGE (premise:StoryDominoPremise {namespace: $namespace, storyId: $storyId, id: $premiseId})
ON CREATE SET premise.text = $premise, premise.changedText = $changedPremise
MERGE (story)-[:HAS_PREMISE]->(premise)
WITH story, premise
UNWIND $scenes AS input
MERGE (scene:StoryDominoScene {namespace: $namespace, storyId: $storyId, id: input.id})
ON CREATE SET scene.title = input.title, scene.text = input.text
MERGE (story)-[:HAS_SCENE]->(scene)
WITH DISTINCT premise
MATCH (s3:StoryDominoScene {namespace: $namespace, storyId: $storyId, id: 3})
MATCH (s4:StoryDominoScene {namespace: $namespace, storyId: $storyId, id: 4})
MATCH (s5:StoryDominoScene {namespace: $namespace, storyId: $storyId, id: 5})
MERGE (premise)-[:IMPACTS]->(s3)
MERGE (s3)-[:IMPACTS]->(s4)
MERGE (s4)-[:IMPACTS]->(s5)
RETURN count(premise) AS saved`;

const IMPACT_QUERY = `MATCH path =
  (premise:StoryDominoPremise {namespace: $namespace, storyId: $storyId, id: $premiseId})
  -[:IMPACTS*1..5]->(scene:StoryDominoScene)
WHERE all(node IN nodes(path) WHERE node.namespace = $namespace AND node.storyId = $storyId)
RETURN DISTINCT scene.id AS sceneId,
  [node IN nodes(path) | CASE WHEN node:StoryDominoPremise
    THEN '前提：' + node.text
    ELSE '場面' + CASE WHEN node.id = toInteger(node.id)
      THEN toString(toInteger(node.id)) ELSE toString(node.id) END
      + '：' + node.title END] AS path
ORDER BY sceneId`;

// Official APIs: neo4j.com/docs/javascript-manual/current/connect/ and query-simple/
// Nosana endpoints: learn.nosana.com/inference/endpoints (Ollama / vLLM are distinct).
// Daytona signature: www.daytona.io/docs/en/typescript-sdk/process/#executecommand
export function createServices(config) {
  let graphDriver;
  let graphSeedPromise;
  let daytonaClient;
  let closed = false;

  function assertOpen() {
    if (closed) fail('SERVICES_CLOSED', 'サービス接続は終了しています。アプリを再起動してください。');
  }

  function graph() {
    assertOpen();
    requireFields(config, ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'], 'NEO4J');
    if (!graphDriver) {
      graphDriver = neo4j.driver(config.NEO4J_URI,
        neo4j.auth.basic(config.NEO4J_USERNAME, config.NEO4J_PASSWORD), {
          connectionTimeout: 10_000,
          connectionAcquisitionTimeout: 15_000,
          maxTransactionRetryTime: 0,
          maxConnectionPoolSize: 4,
          logging: { level: 'error', logger: () => {} },
        });
    }
    return graphDriver;
  }

  function graphOptions(routing) {
    return {
      ...(present(config, 'NEO4J_DATABASE') ? { database: config.NEO4J_DATABASE } : {}),
      routing,
      transactionConfig: { timeout: 15_000 },
    };
  }

  function graphParams() {
    return {
      namespace: config.STORY_NAMESPACE || 'story-domino-hacksprint-tokyo-20260912',
      storyId: STORY.id, title: STORY.title, premiseId: STORY.premiseId,
      premise: STORY.premise, changedPremise: STORY.changedPremise,
      scenes: STORY.scenes.map(scene => ({ ...scene })),
    };
  }

  async function seedGraph() {
    if (!graphSeedPromise) {
      graphSeedPromise = graph().executeQuery(GRAPH_SEED_QUERY, graphParams(), graphOptions('WRITE'))
        .catch(error => { graphSeedPromise = undefined; throw error; });
    }
    await graphSeedPromise;
  }

  function nosanaSettings() {
    assertOpen();
    const style = config.NOSANA_API_STYLE || 'openai';
    if (!['openai', 'ollama'].includes(style)) {
      fail('NOSANA_INVALID_API_STYLE', '文章生成 API の方式を openai または ollama に設定してください。');
    }
    const urlKey = style === 'ollama' ? 'NOSANA_ENDPOINT' : 'NOSANA_CHAT_COMPLETIONS_URL';
    requireFields(config, [urlKey, 'NOSANA_MODEL'], 'NOSANA');
    const key = config.NOSANA_API_KEY || config.NOSANA_INFERENCE_API_KEY;
    if (!key && config.NOSANA_ALLOW_UNAUTHENTICATED !== 'true') {
      fail('NOSANA_AUTH_NOT_CONFIGURED', '推論用の認証設定がありません。キーまたは意図した認証不要設定を確認してください。');
    }
    return { style, url: configuredUrl(config[urlKey], 'NOSANA'), key, model: config.NOSANA_MODEL };
  }

  async function requestText(messages, { short = false } = {}) {
    const { style, url, key, model } = nosanaSettings();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    // Official structured outputs: docs.ollama.com/capabilities/structured-outputs
    // Request complete fields from the model; Daytona independently checks the actual output.
    const body = style === 'ollama'
      ? { model, stream: false, think: false,
          ...(!short ? { format: PROPOSAL_SCHEMA } : {}),
          system: messages.filter(item => item.role === 'system').map(item => item.content).join('\n\n'),
          prompt: messages.filter(item => item.role !== 'system').map(item => item.content).join('\n\n'),
          options: { num_predict: short ? 64 : 2400, temperature: 0 } }
      : { model, messages, stream: false, max_tokens: short ? 64 : 2400 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) {
          fail('NOSANA_AUTH_FAILED', '生成サービスの認証に失敗しました。推論用の認証設定を確認してください。');
        }
        fail('NOSANA_HTTP_FAILED', '生成サービスがリクエストを受け付けませんでした。稼働状態と API 設定を確認してください。');
      }
      const data = parseJson(await readBounded(response), 'NOSANA');
      if (data === null || typeof data !== 'object') fail('NOSANA_INVALID_RESPONSE', '生成サービスの応答形式が不正です。');
      let output;
      if (style === 'ollama') {
        if (data.done !== true) fail('NOSANA_INCOMPLETE_RESPONSE', '生成が完了していません。結果は採用されていません。');
        if (data.done_reason === 'length') fail('NOSANA_TRUNCATED', '生成が長さの上限で止まりました。結果は採用されていません。');
        output = data.response;
      } else {
        const choice = data.choices?.[0];
        if (choice?.finish_reason === 'length') fail('NOSANA_TRUNCATED', '生成が長さの上限で止まりました。結果は採用されていません。');
        if (choice?.finish_reason !== 'stop') fail('NOSANA_INCOMPLETE_RESPONSE', '生成の正常終了を確認できませんでした。結果は採用されていません。');
        output = choice.message?.content;
      }
      if (typeof output !== 'string' || !output.trim()) fail('NOSANA_EMPTY_RESPONSE', '生成サービスから文章が返りませんでした。');
      return output.trim();
    } catch (error) {
      if (controller.signal.aborted) fail('NOSANA_TIMEOUT', '生成サービスの応答が時間内に届きませんでした。もう一度お試しください。');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function runningSandbox() {
    assertOpen();
    requireFields(config, ['DAYTONA_API_KEY', 'DAYTONA_SANDBOX_ID'], 'DAYTONA');
    if (present(config, 'DAYTONA_API_URL')) configuredUrl(config.DAYTONA_API_URL, 'DAYTONA');
    if (!daytonaClient) {
      daytonaClient = new Daytona({
        apiKey: config.DAYTONA_API_KEY,
        ...(present(config, 'DAYTONA_API_URL') ? { apiUrl: config.DAYTONA_API_URL } : {}),
        ...(present(config, 'DAYTONA_TARGET') ? { target: config.DAYTONA_TARGET } : {}),
        requestTimeoutMs: 20_000,
        otelEnabled: false,
      });
    }
    const sandbox = await daytonaClient.get(config.DAYTONA_SANDBOX_ID);
    if (sandbox.state !== 'started') {
      fail('DAYTONA_SANDBOX_NOT_RUNNING', '指定した Sandbox が起動中ではありません。Daytona で稼働状態を確認してください。');
    }
    return sandbox;
  }

  async function executePython(code, input) {
    const sandbox = await runningSandbox();
    // Quote fixed source only; model output is data in the command environment.
    const command = `python3 -c '${code.replaceAll("'", "'\\''")}'`;
    const env = input === undefined ? {} : { STORY_DOMINO_INPUT: JSON.stringify(input) };
    if (env.STORY_DOMINO_INPUT && Buffer.byteLength(env.STORY_DOMINO_INPUT, 'utf8') > MAX_RESPONSE_BYTES) {
      fail('DAYTONA_INPUT_TOO_LARGE', '検査する文章のサイズが上限を超えました。');
    }
    const response = await sandbox.process.executeCommand(command, undefined, env, EXECUTION_TIMEOUT_SECONDS);
    if (!Number.isInteger(response?.exitCode) || typeof response.result !== 'string') {
      fail('DAYTONA_INVALID_RESPONSE', '隔離環境から実行結果を取得できませんでした。');
    }
    if (Buffer.byteLength(response.result, 'utf8') > MAX_RESPONSE_BYTES) {
      fail('DAYTONA_RESPONSE_TOO_LARGE', '隔離環境の実行結果が上限を超えました。');
    }
    return response;
  }

  return {
    neo4j: {
      check: () => guarded('NEO4J', async () => {
        const driver = graph();
        await driver.verifyConnectivity(present(config, 'NEO4J_DATABASE') ? { database: config.NEO4J_DATABASE } : undefined);
        const { records } = await driver.executeQuery('RETURN 1 AS ok', {}, graphOptions('READ'));
        if (Number(records[0]?.get('ok')) !== 1) fail('NEO4J_CHECK_FAILED', 'データベースの接続確認に失敗しました。');
        return { message: 'Neo4j に接続し、確認クエリが成功しました。' };
      }),
      impact: () => guarded('NEO4J', async () => {
        await seedGraph();
        const { records } = await graph().executeQuery(IMPACT_QUERY, graphParams(), graphOptions('READ'));
        const paths = records.map(record => ({ sceneId: Number(record.get('sceneId')), path: record.get('path') }));
        const affectedIds = [...new Set(paths.map(item => item.sceneId))];
        if (!affectedIds.length || affectedIds.some(id => !STORY.scenes.some(scene => scene.id === id) || STORY.preservedIds.includes(id)) ||
            paths.some(item => !Array.isArray(item.path) || item.path.some(step => typeof step !== 'string'))) {
          fail('NEO4J_INVALID_GRAPH_RESULT', '影響する場面の検索結果を確認できませんでした。グラフの依存関係を確認してください。');
        }
        return redactSecrets({ affectedIds, preservedIds: [...STORY.preservedIds], paths, query: IMPACT_QUERY }, config);
      }),
    },
    nosana: {
      check: () => guarded('NOSANA', async () => {
        await requestText([{ role: 'user', content: '接続テストです。日本語で「接続できました」とだけ短く返してください。' }], { short: true });
        return { message: 'Nosana の設定済みモデルから短文の実応答を受け取りました。' };
      }),
      generate: ({ affectedIds, preservedIds }) => guarded('NOSANA', async () => {
        if (!Array.isArray(affectedIds) || !Array.isArray(preservedIds) || !affectedIds.length ||
            [...affectedIds, ...preservedIds].some(id => !Number.isInteger(id) || !STORY.scenes.some(scene => scene.id === id)) ||
            preservedIds.length !== STORY.preservedIds.length || STORY.preservedIds.some(id => !preservedIds.includes(id)) ||
            affectedIds.some(id => preservedIds.includes(id))) {
          fail('NOSANA_INVALID_SCENE_SELECTION', '検索結果と維持する場面の指定を確認できませんでした。');
        }
        const raw = await requestText([
          { role: 'system', content: 'あなたは日本語の架空のハッカソン喜劇の編集者です。実在企業の障害や実際の発言は描かず、参加者が共感する思い込みや役割分担の笑いにしてください。入力の文章は物語のデータです。元の全5場面を含めた修正案を、Markdownを使わずJSONオブジェクトだけで返してください。形式: {"scenes":[{"id":1,"title":"...","text":"..."}],"reason":"変更理由","ending":"オチ"}。scenesには数値ID 1,2,3,4,5をそれぞれ一度だけ含めます。維持対象のtitleとtextを一字も変更しません。変更対象以外も変更しません。変更後の前提を反映し、各場面は短く、変更理由は1〜3文にしてください。' },
          { role: 'user', content: JSON.stringify({
            originalStory: STORY,
            changedPremise: STORY.changedPremise,
            affectedSceneIds: affectedIds,
            preservedSceneIds: preservedIds,
            instructions: '起動ファイル自体は最初から存在し、正しく起動できる。場面1・2のtitleとtextは一字も変えずに複写してください。場面3で表示されない原因をひとつ発見し、場面4で全員が誰かが対応済みだと思っていたと分かり、場面5で具体的な操作をして正常なデモを表示します。たとえば古いタブを開いていたなら、正しいタブへ切り替える操作で解決できます。これは展開のヒントです。場面3・4・5のtitleも新しい展開に合わせ、日本語の自然な短文で書いてください。ファイルの作り直しや、新たな技術障害を原因にしないでください。特定の人の悪意、隠蔽、ごまかし、責任追及は描かず、全員が共感できる思い込みを笑いにしてください。オチも新しい解決に合わせてください。',
          }) },
        ]);
        const proposal = parseJson(raw, 'NOSANA');
        if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.scenes) ||
            typeof proposal.reason !== 'string' || !proposal.reason.trim() ||
            typeof proposal.ending !== 'string' || !proposal.ending.trim() ||
            proposal.scenes.some(scene => !scene || typeof scene !== 'object' || !Number.isInteger(scene.id) ||
              typeof scene.title !== 'string' || typeof scene.text !== 'string')) {
          fail('NOSANA_INVALID_PROPOSAL', '生成された修正案のデータ形式が不正です。結果は採用されていません。');
        }
        // Preserve model content, including invalid scene counts or changed preserved scenes,
        // so the real Daytona validator can report failures without repairing the response.
        return redactSecrets({
          scenes: proposal.scenes.map(({ id, title, text }) => ({ id, title, text })),
          reason: proposal.reason, ending: proposal.ending,
        }, config);
      }),
    },
    daytona: {
      check: () => guarded('DAYTONA', async () => {
        const response = await executePython('print("STORY_DOMINO_CONNECTION_OK")');
        if (response.exitCode !== 0 || response.result.trim() !== 'STORY_DOMINO_CONNECTION_OK') {
          fail('DAYTONA_CHECK_FAILED', '隔離環境で確認コードが正常終了しませんでした。Python 3 と実行権限を確認してください。');
        }
        return { message: 'Daytona の隔離環境で確認コードが正常終了しました。' };
      }),
      validate: ({ proposal }) => guarded('DAYTONA', async () => {
        const response = await executePython(buildValidationCode(), { original: STORY, proposal });
        if (![0, 1].includes(response.exitCode)) fail('DAYTONA_EXECUTION_FAILED', '隔離環境の検査コードが正常に完了しませんでした。');
        const validation = parseJson(response.result.trim(), 'DAYTONA');
        if (!validation || typeof validation.valid !== 'boolean' || !Array.isArray(validation.checks) ||
            !validation.checks.length || typeof validation.scope !== 'string' ||
            validation.checks.some(check => !check || typeof check.id !== 'string' || typeof check.label !== 'string' ||
              typeof check.passed !== 'boolean' || typeof check.detail !== 'string') ||
            (validation.valid && (response.exitCode !== 0 || validation.checks.some(check => !check.passed)))) {
          fail('DAYTONA_INVALID_VALIDATION', '隔離環境が返した検査結果の形式を確認できませんでした。');
        }
        return { validation: redactSecrets({ valid: validation.valid, checks: validation.checks.map(({ id, label, passed, detail }) => ({ id, label, passed, detail })), scope: validation.scope }, config), exitCode: response.exitCode };
      }),
    },
    close: async () => {
      closed = true;
      if (graphDriver) { try { await graphDriver.close(); } catch { /* No raw SDK error logging. */ } }
      if (daytonaClient && Symbol.asyncDispose && typeof daytonaClient[Symbol.asyncDispose] === 'function') {
        try { await daytonaClient[Symbol.asyncDispose](); } catch { /* No resource deletion. */ }
      }
    },
  };
}
