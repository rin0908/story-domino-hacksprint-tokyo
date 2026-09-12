# アカウント作成後の接続準備

3サービスは本人からアカウント作成・スポンサークレジット取得済みと伺っています。アカウントやクレジットがあっても、データベース・推論モデル・Sandboxが利用可能とは限りません。実利用の最新結果は [検証記録](verification.md) を参照してください。

## 値の入力方法

1. アプリ専用フォルダの `.env` をエディタで開きます。
2. 対応する `名前=` の右側へ、本人の管理画面で確認した値を入力して保存します。空白や `#` を含む値は二重引用符で囲みます。
3. チャットへキーやパスワードを貼らないでください。入力後は「入力しました」とだけ伝えれば十分です。
4. アプリを再起動し、画面で「接続を確認」を押します。設定値そのものは画面へ返しません。

## Neo4j

既存のDatabase / Auraインスタンスを開き、Connectで接続URI、ユーザー名、データベース名を確認します。パスワードは本人が保存している値を `.env` の `NEO4J_PASSWORD` に入力します。新しくDBを作成する必要がある場合は無料枠の可否を確認し、有料購入は本人確認後に行います。既存の作品のDBを使う場合も、このアプリは専用namespaceへ新しいデータだけを作成します。可能ならこの作品用のDBを使います。

必要項目：`NEO4J_URI`、`NEO4J_USERNAME`、`NEO4J_PASSWORD`。必要に応じて `NEO4J_DATABASE`。

## Nosana

本人の利用可能な稼働中ジョブ／推論サービスを開き、Service URL、実際に配置されている文章生成モデル名、API方式を確認します。管理ダッシュボードのURLではなく、推論リクエストを受け付けるAPIのURLが必要です。モデルが未配置なら「登録済み・モデル未用意」と扱い、主催者／メンターの既存の利用可能なモデル案内を確認します。アプリは有料ジョブを自動作成しません。

- OpenAI互換：`NOSANA_CHAT_COMPLETIONS_URL` に本人の完全なchat/completions URL、`NOSANA_MODEL` に実際のモデル名。
- Ollama：`NOSANA_API_STYLE=ollama` と `NOSANA_ENDPOINT` に本人の完全なapi/generate URL、`NOSANA_MODEL` に実際のモデル名。
- 必要な推論用キーを `NOSANA_API_KEY`。管理APIのキーとは別の場合があります。
- 意図的に認証不要の自分のendpointなら `NOSANA_ALLOW_UNAUTHENTICATED=true`。

最初は短文を受信し、次に物語全体の生成を試します。APIの形が違う場合はモデル名・キーを創作せず、実仕様に合わせて接続部を調整します。

## Daytona

本人の既存Sandbox一覧から、Python 3を利用できる起動中のSandboxを選びます。IDを `DAYTONA_SANDBOX_ID`、本人のAPIキーを `DAYTONA_API_KEY` に入力します。必要なら管理環境に合う `DAYTONA_API_URL` / `DAYTONA_TARGET` も設定します。

アプリは `get` と固定コードの `executeCommand` のみを使い、作成・起動・削除は行いません。まだSandboxがなければ、その準備が必要です。無料クレジットや費用を本人が確認し、購入・削除は実行直前に承認します。

## 主催者の案内リンク

クレジット取得は本人が確認済みで、Daytona・Nosanaの管理画面でも利用可能残高を確認しました。この開発でクレジットの追加購入は行っていません。受領済み・接続設定済み・実処理成功は別々に扱います。

- [Daytonaクレジット案内](https://www.theaibuilders.dev/20260912-tokyo-credits/daytona)
- [Nosanaクレジット案内](https://www.theaibuilders.dev/20260912-tokyo-credits/nosana)
- [Neo4j](https://neo4j.com/)

これらは主催者の当日投稿で案内されたリンクです。アプリにキーやモデルが自動設定されるわけではありません。
