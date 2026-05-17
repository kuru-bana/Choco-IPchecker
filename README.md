# Choco-ip 位置情報チェッカー

## プロジェクト概要

**Choco-ip位置情報チェッカー**は、IPアドレスの地理情報・ASN情報を調べるWebアプリです。MaxMind GeoLite2データベースを使用して、国・都市・座標・プロバイダー情報などを取得・表示します。

---
### 主な機能
- 自分のIPアドレスを自動取得して情報表示
- 任意のIPアドレスを検索して詳細情報を表示
- ASN（自律システム番号）・組織情報の表示
- 都市探索モード（国・地域別のIPデータ可視化）
- 管理者画面（データベースの手動更新）

## 技術スタック

| 種別 | 技術 |
|------|------|
| バックエンド | Node.js + Express.js |
| フロントエンド | バニラHTML / CSS / JavaScript |
| データベース | MaxMind GeoLite2-City / GeoLite2-ASN（.mmdbファイル） |
| パッケージ管理 | npm |

## プロジェクト構成

```
├── server.js          # メインサーバー（APIルート・DB管理）
├── public/            # 静的フロントエンドファイル
│   ├── index.html         # メインページ
│   ├── city-info.html     # 都市情報ページ
│   ├── city-explore.html  # 都市探索ページ
│   ├── asn-info.html      # ASN情報ページ
│   ├── db-info.html       # DB情報ページ
│   └── admin.html         # パネルページ
├── data/              # GeoLite2 .mmdbファイル（自動生成）
├── setup.sh           # データベースダウンロードスクリプト
├── package.json
└── render.yaml        # Render.comデプロイ設定
```

## 環境変数・シークレット

| キー | 説明 | 必須 |
|------|------|------|
| `GEOLITE2_LICENSE_KEY` | MaxMindライセンスキー（GeoLite2 DBダウンロード用） | 必須 |
| `ADMIN_PASSWORD` | 管理者画面のパスワード | 任意 |

> MaxMindのライセンスキーは https://www.maxmind.com/en/geolite2/signup で無料取得できます。

## セットアップ手順

1. `GEOLITE2_LICENSE_KEY` をシークレットに設定する
2. GeoLite2データベースをダウンロードする：
   ```bash
   npm run setup
   ```
3. サーバーを起動する：
   ```bash
   npm start
   ```

## 主なAPIエンドポイント

| メソッド | パス | 説明 |
|--------|------|------|
| GET | `/api/check/light/me` | 自分のIPを簡易チェック |
| GET | `/api/check/light/{ip}` | 指定のIPを簡易チェック(geoip-country) |
| GET | `/api/check/detail/{ip}` | 指定IPの詳細情報取得(GeoLite2) |
| GET | `/api/db-info` | DBのロード状態・更新日時 |

## ユーザー設定・好み

- ドキュメント・コメントは日本語で記載する
- `replit.md` は日本語で管理する

---
# Choco-ip 位置情報チェッカー — デプロイガイド

各ホスティングサービスへのデプロイ手順をまとめています。

---

## 事前準備（共通）

すべてのプラットフォームで以下の環境変数が必要です。

| 環境変数 | 説明 | 必須 |
|----------|------|------|
| `GEOLITE2_LICENSE_KEY` | MaxMind GeoLite2 ライセンスキー | **必須** |
| `ADMIN_PASSWORD` | 管理者画面のパスワード | 任意 |

> MaxMind の無料ライセンスキー取得: https://www.maxmind.com/en/geolite2/signup

---

## 1. Render（推奨）

設定ファイル: `render.yaml`

### 手順

1. [Render.com](https://render.com) にサインアップ・ログイン
2. ダッシュボードで **New → Blueprint** を選択
3. GitHub リポジトリと連携
4. `render.yaml` が自動検出され、サービス設定が読み込まれる
5. 環境変数 `GEOLITE2_LICENSE_KEY` と `ADMIN_PASSWORD` を入力
6. **Apply** をクリックしてデプロイ開始

### ビルドコマンド
```
npm install && npm run build
```

### 起動コマンド
```
npm start
```

### 注意事項
- 無料プランはスリープあり（初回アクセスに数秒かかる場合があります）
- データベースは毎デプロイ時に再ダウンロードされます

---

## 2. Railway

設定ファイル: `railway.toml`

### 手順

1. [Railway.app](https://railway.app) にサインアップ・ログイン
2. ダッシュボードで **New Project → Deploy from GitHub repo** を選択
3. リポジトリを選択
4. **Variables** タブで環境変数を追加:
   - `GEOLITE2_LICENSE_KEY` = あなたのキー
   - `ADMIN_PASSWORD` = 任意のパスワード
5. 自動的にデプロイが開始される

### CLIを使う場合
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set GEOLITE2_LICENSE_KEY=あなたのキー
railway variables set ADMIN_PASSWORD=パスワード
```

---

## 3. Fly.io

設定ファイル: `fly.toml`

### 手順

1. [Fly.io](https://fly.io) にサインアップ・ログイン
2. [flyctl CLI](https://fly.io/docs/hands-on/install-flyctl/) をインストール:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
3. ログイン:
   ```bash
   fly auth login
   ```
4. アプリを作成（初回のみ）:
   ```bash
   fly launch --no-deploy
   ```
5. シークレットを設定:
   ```bash
   fly secrets set GEOLITE2_LICENSE_KEY=あなたのキー
   fly secrets set ADMIN_PASSWORD=パスワード
   ```
6. デプロイ:
   ```bash
   fly deploy
   ```

### 注意事項
- `fly.toml` の `app` 名は一意である必要があります（他のユーザーと重複不可）
- リージョン `nrt` は東京です。変更する場合は `fly.toml` を編集してください

---

## 4. Heroku

設定ファイル: `Procfile`

### 手順

1. [Heroku](https://heroku.com) にサインアップ・ログイン
2. [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) をインストール
3. ログイン:
   ```bash
   heroku login
   ```
4. アプリを作成:
   ```bash
   heroku create choco-ip
   ```
5. 環境変数を設定:
   ```bash
   heroku config:set GEOLITE2_LICENSE_KEY=あなたのキー
   heroku config:set ADMIN_PASSWORD=パスワード
   ```
6. デプロイ:
   ```bash
   git push heroku main
   ```

### 注意事項
- 無料プランは廃止されました（有料プランのみ）
- `Eco Dyno`（月$5〜）が最も安価なプランです

---

## 5. Docker（自己ホスティング / VPS / Cloud Run など）

設定ファイル: `Dockerfile`

### Dockerイメージのビルドと実行

```bash
# イメージをビルド
docker build -t choco-ip .

# コンテナを起動
docker run -d \
  -p 8080:8080 \
  -e GEOLITE2_LICENSE_KEY=あなたのキー \
  -e ADMIN_PASSWORD=パスワード \
  --name choco-ip \
  choco-ip
```

### docker-compose を使う場合

```yaml
version: "3.9"
services:
  choco-ip:
    build: .
    ports:
      - "8080:8080"
    environment:
      - GEOLITE2_LICENSE_KEY=あなたのキー
      - ADMIN_PASSWORD=パスワード
    restart: unless-stopped
```

### Google Cloud Run へのデプロイ

```bash
# Google Container Registry にプッシュ
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
docker tag choco-ip gcr.io/YOUR_PROJECT_ID/choco-ip
docker push gcr.io/YOUR_PROJECT_ID/choco-ip

# Cloud Run にデプロイ
gcloud run deploy choco-ip \
  --image gcr.io/YOUR_PROJECT_ID/choco-ip \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars GEOLITE2_LICENSE_KEY=あなたのキー,ADMIN_PASSWORD=パスワード
```

---

## 6. Vercel

設定ファイル: `vercel.json`

### 手順

1. [Vercel](https://vercel.com) にサインアップ・ログイン
2. ダッシュボードで **Add New → Project** を選択
3. GitHub リポジトリをインポート
4. **Environment Variables** に以下を追加:
   - `GEOLITE2_LICENSE_KEY` = あなたのキー
   - `ADMIN_PASSWORD` = 任意のパスワード
5. **Deploy** をクリック

### CLIを使う場合
```bash
npm install -g vercel
vercel login
vercel --prod
```

デプロイ中に環境変数を設定:
```bash
vercel env add GEOLITE2_LICENSE_KEY
vercel env add ADMIN_PASSWORD
vercel --prod
```

### 注意事項
- Vercel はサーバーレス環境のため、`.mmdb` ファイルは `/tmp` ディレクトリに保存されます（コールドスタート時に再ダウンロード）
- GeoLite2-City は約 70MB 以上あるため、コールドスタートに時間がかかる場合があります
- 都市探索モードのような重い処理はタイムアウト（デフォルト 10 秒）に引っかかる可能性があります。Vercel Pro 以上でタイムアウト延長を推奨します
- 継続的なサーバー処理（自己 ping・DB 自動更新）はサーバーレスでは動作しません

---

## 7. CodeSandbox

設定ファイル: `.codesandbox/tasks.json`

### 手順

1. [CodeSandbox](https://codesandbox.io) にサインアップ・ログイン
2. ダッシュボードで **New Sandbox → Import from GitHub** を選択
3. リポジトリの URL を入力してインポート
4. **Environment Variables** パネルで設定:
   - `GEOLITE2_LICENSE_KEY` = あなたのキー
   - `ADMIN_PASSWORD` = 任意のパスワード
5. ターミナルで DB セットアップを実行:
   ```bash
   npm run build
   ```
6. **Start application** タスクが自動起動し、プレビューが表示されます

### タスク一覧（自動設定済み）

| タスク | コマンド | 説明 |
|--------|----------|------|
| DBセットアップ | `npm run build` | GeoLite2 DB をダウンロード（手動実行） |
| アプリを起動 | `npm start` | サーバー起動（自動実行） |

### 注意事項
- CodeSandbox の環境変数は **Secrets** タブ（🔒アイコン）から設定してください
- 無料プランではスリープあり。一定時間操作がないと停止します

---

## 共通の注意事項

### GeoLite2 データベースについて
- 初回起動時またはデプロイ時に `npm run build`（= `setup.sh`）が実行され、MaxMind からデータベースが自動ダウンロードされます
- データベースは2週間ごとに自動更新されます（管理者画面から手動更新も可能）
- `GEOLITE2_LICENSE_KEY` がない場合、DB のダウンロードに失敗しますが、サーバー自体は起動します（IP検索機能は使えません）

### ポートについて
- デフォルトポートは `5000`（`PORT` 環境変数で変更可能）
- Fly.io / Cloud Run / Docker では `8080` に設定済み

### データ永続化について
- `.mmdb` ファイルはコンテナの `/app/data/` に保存されます
- コンテナ再起動のたびに再ダウンロードされます
- 永続化したい場合は Docker ボリュームを利用してください:
  ```bash
  docker run -d \
    -p 8080:8080 \
    -e GEOLITE2_LICENSE_KEY=あなたのキー \
    -v choco-ip-data:/app/data \
    choco-ip
  ```
---
kurubana35
