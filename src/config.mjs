export const SERVICE_NAMES = { neo4j: 'Neo4j', nosana: 'Nosana', daytona: 'Daytona' };
export function missingSettings(id, env) {
  const required = {
    neo4j: ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'],
    nosana: ['NOSANA_MODEL'],
    daytona: ['DAYTONA_API_KEY', 'DAYTONA_SANDBOX_ID'],
  }[id];
  const missing = required.filter((key) => !env[key]?.trim());
  if (id === 'nosana') {
    const urlKey = env.NOSANA_API_STYLE === 'ollama' ? 'NOSANA_ENDPOINT' : 'NOSANA_CHAT_COMPLETIONS_URL';
    if (!env[urlKey]?.trim()) missing.push(urlKey);
    if (!(env.NOSANA_API_KEY || env.NOSANA_INFERENCE_API_KEY)?.trim() && env.NOSANA_ALLOW_UNAUTHENTICATED !== 'true') missing.push('NOSANA_API_KEY（認証なしの場合はNOSANA_ALLOW_UNAUTHENTICATED=true）');
  }
  return missing;
}

// No provider exception, connection URL, or credential ever crosses the API boundary.
export function safeError(stage, code) {
  const known = {
    CONFIG_MISSING: '接続情報が不足しています。接続設定の詳細を確認し、専用フォルダの .env に入力してサーバーを再起動してください。',
    CHECK_REQUIRED: '先に「接続を確認」を実行してください。Nosanaの短文応答を含む接続確認が必要です。',
    RUN_NOT_FOUND: 'この修正案の有効期限が切れたか、サーバーが再起動されました。変更ボタンからやり直してください。',
    ORDER_INVALID: '操作の順序が正しくありません。変更ボタンからやり直してください。',
    VALIDATION_REQUIRED: 'Daytonaの形式検査に合格していないため、採用できません。',
    GRAPH_UNEXPECTED: 'Neo4jの検索結果が、このデモの場面3・4・5と一致しません。グラフの依存関係を確認してください。',
    BUSY: '処理中です。完了してからもう一度操作してください。',
    INVALID_REQUEST: 'リクエストの形式が正しくありません。',
    FORBIDDEN: 'この操作は同じパソコン上のアプリ画面から実行してください。',
    NOSANA_AUTH_FAILED: 'Nosanaの推論認証に失敗しました。管理画面のキーと推論用キーが異なる場合があります。専用 .env の認証設定を確認してください。',
    NOSANA_TIMEOUT: 'Nosanaから45秒以内に応答がありませんでした。既存モデルの稼働状態を確認して再試行してください。',
    NOSANA_TRUNCATED: 'Nosanaの応答が長さの上限で途切れました。この修正案は採用していません。',
    NOSANA_INVALID_JSON: 'Nosanaが指定したJSON形式を返しませんでした。実モデルのJSON出力対応を確認してください。',
    NOSANA_EMPTY_RESPONSE: 'Nosanaから文章が返りませんでした。モデルの稼働状態を確認してください。',
    NOSANA_INCOMPLETE_RESPONSE: 'Nosanaの文章生成が正常に終了したことを確認できませんでした。',
    NOSANA_INVALID_PROPOSAL: 'Nosanaの修正案に必要なデータ項目がありませんでした。',
    NOSANA_INVALID_API_STYLE: 'NOSANA_API_STYLE は openai または ollama を指定してください。',
    NOSANA_INVALID_URL: 'Nosanaの接続先を、本人の稼働中モデルの正確なHTTPS推論URLに設定してください。',
    NOSANA_HTTP_FAILED: 'Nosanaがリクエストを受け付けませんでした。エンドポイントのパスとモデルの設定を確認してください。',
    NOSANA_RESPONSE_TOO_LARGE: 'Nosanaの応答が100KBの上限を超えました。',
    DAYTONA_SANDBOX_NOT_RUNNING: 'Daytonaの指定Sandboxが起動中ではありません。既存Sandboxの稼働状態を確認してください。アプリからの作成・起動は行いません。',
    DAYTONA_CHECK_FAILED: 'Daytonaの既存Sandboxで確認コードが正常終了しませんでした。Python 3の有無と実行権限を確認してください。',
    DAYTONA_TIMEOUT: 'Daytonaから時間内に応答がありませんでした。Sandboxの稼働状態を確認してください。',
    DAYTONA_INVALID_VALIDATION: 'Daytonaの検査結果を読み取れませんでした。採用はできません。',
    DAYTONA_EXECUTION_FAILED: 'Daytonaの検査コードが正常に完了しませんでした。Python 3とSandboxの状態を確認してください。',
    NEO4J_INVALID_GRAPH_RESULT: 'Neo4jの依存関係検索が、この物語の修正対象と一致しませんでした。',
  };
  const generic = {
    neo4j: 'Neo4jの接続または検索に失敗しました。URI・認証・データベースへの権限を確認してください。',
    nosana: 'Nosanaの生成に失敗しました。既存エンドポイント・モデル・認証・応答形式を確認してください。サンプルへの置き換えは行っていません。',
    daytona: 'Daytonaで検査を完了できませんでした。既存Sandboxが起動中で、Python 3を実行できるか確認してください。',
  };
  return { code: Object.hasOwn(known, code) ? code : 'SERVICE_FAILED', message: known[code] || generic[stage] || '処理に失敗しました。サーバーを確認してください。', stage };
}
