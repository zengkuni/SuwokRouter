<div align="center">
  <img src="./assets/BannerGithubSuwok.png" alt="Banner Suwok Router" />
  <h1 style="margin: 8px 0 0;">Suwok Router</h1>
</div>

<p align="center">
  <strong>Satu gateway. Semua model.</strong><br />
  Connect sekali, route ke mana saja.
</p>

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-README-2563EB?style=for-the-badge" alt="English README" /></a>
  <a href="./README.id.md"><img src="https://img.shields.io/badge/Bahasa_Indonesia-README.id-16A34A?style=for-the-badge" alt="Bahasa Indonesia README" /></a>
</p>

<p align="center">
  <a href="https://github.com/bolone-sengkuni/suwokrouter/stargazers"><img src="https://img.shields.io/github/stars/bolone-sengkuni/suwokrouter?style=flat" alt="GitHub stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Lisensi MIT" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-black?logo=bun" alt="Bun" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/code-TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/dashboard-React-61DAFB?logo=react&logoColor=111827" alt="React" /></a>
  <a href="https://sqlite.org"><img src="https://img.shields.io/badge/storage-PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" /></a>
</p>

<p align="center">
  <img src="./docs/media/screenshots/dashboard.png" alt="Dashboard Suwok Router" width="960" />
</p>

Suwok Router membawa semua provider AI kamu ke satu gateway yang clean, dengan
dashboard simpel untuk mengatur model, routing, dan usage.

## Daftar isi

- [Mulai cepat](#mulai-cepat)
- [Uninstall](#uninstall)
- [Requirement](#requirement)
- [HTTP API](#satu-http-api-untuk-semua-kebutuhan)
- [Dashboard](#dashboard-yang-enak-dipakai)
- [Migrasi dari 9Router](#migrasi-dari-9router)
- [Providers](#providers)
- [CLI Tools yang didukung](#cli-tools-yang-didukung)
- [Fitur lengkap](#fitur-yang-tersedia)
- [Perbandingan](#suwok-router-vs-9router-vs-omniroute)
- [Operasional dan keamanan](#operasional-dan-keamanan)
- [Tech stack](#tech-stack)
- [Konfigurasi](#konfigurasi)
- [Atribusi dan lisensi](#atribusi)

## Mulai cepat

### Global CLI — cara paling cepat

Install global lalu jalanin router:

```bash
bun install -g suwokrouter@latest
suwokrouter
```

CLI bisa start, stop, restart, dan cek status router. Saat start, CLI juga
mengecek apakah ada versi baru, tapi nggak akan update sendiri tanpa persetujuan
kamu.

### Windows — install lokal

Cara paling gampang di Windows adalah install global secara lokal. Kalau Bun
sudah terpasang, lewati langkah pertama.

1. Buka PowerShell lalu install Bun:

   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

2. Tutup dan buka lagi PowerShell, lalu cek Bun:

   ```powershell
   bun --version
   ```

3. Install dan jalankan Suwok Router:

   ```powershell
   bun install -g suwokrouter@latest
   suwokrouter start -b
   ```

4. Buka `http://127.0.0.1:1212/dashboard` di browser, lalu selesaikan setup
   pertama.

5. Cek atau stop instance lokal kapan saja:

   ```powershell
   suwokrouter status
   suwokrouter stop
   ```

Data runtime CLI disimpan di `%APPDATA%\.suwokrouter`. Untuk install lokal
biasa, kamu tidak perlu membuat file `.env`.

### Uninstall

Stop router dulu sebelum menghapus CLI global:

```powershell
suwokrouter stop
bun remove -g suwokrouter
```

Kalau install-nya memakai npm, gunakan `npm uninstall -g suwokrouter`.
Menghapus package tidak menghapus credential provider, setting, API key, atau
data usage. Kalau ingin menghapus semuanya juga, export backup JSON dulu, stop
router, lalu hapus `%APPDATA%\.suwokrouter` di Windows atau `~/.suwokrouter` di
Linux/macOS.

### Windows — jalankan dari source

Untuk contributor yang bekerja dari checkout:

```powershell
git clone https://github.com/bolone-sengkuni/suwokrouter.git
cd SuwokRouter
bun install --frozen-lockfile
Push-Location dashboard
bun install --frozen-lockfile
bun run build
Pop-Location
bun run dev
```

Buka `http://127.0.0.1:1212/dashboard`. Biarkan terminal tetap terbuka saat
development server berjalan.

### Jalanin dari source (macOS/Linux)

```bash
bun install --frozen-lockfile
cd dashboard
bun install --frozen-lockfile
bun run build
cd ..
bun run dev
```

Buka `http://127.0.0.1:1212/dashboard`, lalu tambahkan provider pertama kamu.

Kalau mau ngembangin dashboard, jalanin `bun run dev` di dalam folder
`dashboard/` lewat terminal kedua.

### Docker — terisolasi dan datanya persistent

Gunakan image publik dari Docker Hub:

```bash
docker pull sengkuni/suwokrouter:latest
docker compose up -d
docker compose ps
```

Kalau ingin build image dari source, jalankan `docker build -t sengkuni/suwokrouter:latest .`
sebelum menjalankan Compose.

Docker juga membuat secret persistent di data volume. Copy `.env.example`
menjadi `.env` hanya kalau kamu ingin memberi override deployment sendiri.

Buka `http://127.0.0.1:1212/dashboard`. Untuk lihat log:

```bash
docker compose logs -f suwokrouter
```

Setup Docker memakai volume `suwokrouter-data`, bind port hanya ke localhost,
menjalankan container sebagai user non-root, memakai root filesystem read-only,
dan sudah punya readiness health check. Jangan hapus volume kalau ingin tetap
menyimpan koneksi provider, key, setting, dan data usage.

## Requirement

| Deployment | Yang dibutuhkan                                                             | Process manager                                                          |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Global CLI | Bun `1.3+`, data directory yang bisa ditulis, dan akses network ke provider | CLI untuk lokal; tambahkan supervisor untuk production                   |
| Docker     | Docker Engine dengan plugin Compose dan volume persistent                   | Docker Compose sudah menangani restart dan health check; nggak perlu PM2 |
| Native VPS | Bun `1.3+`, data directory yang bisa ditulis, dan akses network ke provider | `systemd` direkomendasikan; PM2 opsional                                 |

Untuk native VPS kecil, mulai dari **2 vCPU, RAM 2 GB, dan SSD 10 GB**. Komputer
lokal bisa jalan dengan resource lebih kecil. Sebelum dibuka ke internet, taruh
Suwok Router di belakang reverse proxy HTTPS.

### Native VPS dengan PM2 (opsional)

PM2 sudah mendukung Bun, tapi hanya diperlukan kalau Suwok Router dijalankan langsung
di VPS tanpa Docker atau supervisor lain:

```bash
npm install -g pm2
pm2 start src/server.ts --name suwokrouter --interpreter bun
pm2 save
pm2 startup
```

Jalankan `pm2 startup` sesuai perintah yang diberikan PM2 supaya process otomatis
balik hidup setelah reboot. Jangan menjalankan PM2 di atas Docker Compose untuk
container yang sama.

## Satu HTTP API untuk semua kebutuhan

Pakai format client yang sudah biasa kamu pakai. Suwok Router akan menerjemahkan
request dan response ke provider di belakang layar.

| Client / fitur          | Endpoint                         |
| ----------------------- | -------------------------------- |
| OpenAI Chat Completions | `POST /v1/chat/completions`      |
| OpenAI Responses        | `POST /v1/responses`             |
| Compact Responses       | `POST /v1/responses/compact`     |
| Anthropic Messages      | `POST /v1/messages`              |
| Anthropic token count   | `POST /v1/messages/count_tokens` |
| Ollama-style chat       | `POST /v1/api/chat`              |
| Image generation        | `POST /v1/images/generations`    |
| Image editing           | `POST /v1/images/edits`          |
| Daftar model            | `GET /v1/models`                 |

Streaming dan non-streaming tersedia selama provider dan model yang dipilih
mendukungnya. Alias `/codex` dan `/responses` juga tersedia untuk setup client
yang umum.

### Contoh singkat

```bash
export SUWOK_API_KEY="swy-your_gateway_key"
curl http://127.0.0.1:1212/v1/chat/completions \
  --oauth2-bearer "${SUWOK_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-active-model-id",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

Gateway key Suwok Router berbeda dari credential provider di belakangnya. Secret
provider tetap tersimpan di server.

## Dashboard yang enak dipakai

Dashboard Suwok Router bukan sekadar halaman admin. Ini jadi control room yang fokus
buat ngatur provider, model, akun, kuota, usage, log, dan routing. Ada compact
card, status badge yang jelas, search dan filter, layout responsive, serta
loading/refresh state yang smooth supaya semuanya tetap gampang dipantau di
desktop, tablet, dan mobile.

| Dashboard                                                        | Providers                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| ![Dashboard Suwok Router](./docs/media/screenshots/dashboard.png) | ![Pengelolaan provider](./docs/media/screenshots/providers.png)  |
| Model provider                                                   | Custom provider                                                  |
| ![Model provider](./docs/media/screenshots/provider-models.png)  | ![Custom provider](./docs/media/screenshots/custom-provider.png) |
| Usage & cost                                                     | Monitor kuota                                                    |
| ![Usage dan cost](./docs/media/screenshots/usage.png)            | ![Monitor kuota](./docs/media/screenshots/quota.png)             |
| Settings                                                         | CLI Tools                                                        |
| ![Settings](./docs/media/screenshots/settings.png)               | ![CLI Tools](./docs/media/screenshots/cli-tools.png)             |

[Lihat showcase UI lengkap](./docs/SHOWCASE.md)

### Menu utama

| Menu              | Isinya                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| **Dashboard**     | Jumlah request, total token, cost, latency, aktivitas provider, dan status sistem   |
| **API Keys**      | Buat, lihat, copy, rotate, enable, revoke, dan hapus gateway key                    |
| **Providers**     | Tambah koneksi, pilih auth, test akun, kelola model, dan atur routing               |
| **Combos**        | Buat fallback berurutan untuk model/provider dan pilih strateginya                  |
| **Proxy**         | Buat/test proxy pool, pasang koneksi, dan deploy relay opsional                     |
| **Usage**         | Chart, breakdown token, estimasi cost, history, filter, sorting, dan detail request |
| **Quota Monitor** | Ketersediaan provider/akun, status kuota, diagnostik, dan refresh manual            |
| **CLI Tools**     | Atur coding tools yang didukung, pilih model, dan copy config otomatis              |
| **Suwok Chat**     | Chat lewat router dengan pemilihan model dan built-in tools opsional                |
| **Settings**      | Kontrol Preferences, General, Security, Data, dan migrasi 9Router                   |
| **Console Logs**  | Cari, filter, wrap, copy, dan cek diagnostik runtime/provider                       |

### Isi Settings

- **Preferences:** foto profil dengan crop/zoom, nama profil, dan currency
  tampilan (USD default, IDR tersedia).
- **General:** RTK token saver, Caveman, Ponytail, capture payload request, dan
  Cloudflare Tunnel.
- **Security:** wajib API key, wajib login dashboard, password dashboard,
  login protection, dan graceful shutdown.
- **Data:** lokasi database, backup/restore JSON, dan migrasi 9Router.

## Migrasi dari 9Router

Kalau mau pindah dari 9Router, buka **Settings → Data → Migrate from 9Router**.
Suwok Router mendukung dua sumber migrasi:

- **Instalasi lokal:** otomatis mencari database 9Router yang didukung di
  perangkat yang sama.
- **Backup JSON 9Router:** import backup hasil export dari perangkat ini atau
  perangkat lain.

Sebelum import, kamu bisa pilih data yang mau dibawa:

- Provider account dan credential
- Custom provider
- Custom model
- Combo
- Routing settings — default mati
- Langsung aktifkan account hasil import — default mati

Suwok Router akan menampilkan preview dulu: data yang siap diimport, sudah ada, atau
akan dilewati. Source divalidasi, referensi provider dan model disesuaikan ke
format Suwok Router, data duplikat ditangani, dan provider yang tidak kompatibel atau
tidak tersedia dilaporkan tanpa memasukkan entry yang rusak. Preview tidak
mengubah data apa pun.

Setelah kamu konfirmasi dengan password dashboard, Suwok Router membuat safety backup,
menggabungkan data yang dipilih ke database yang sudah ada, lalu me-refresh
dashboard. Data Suwok Router yang lama tidak diganti, dan account hasil import tetap
inactive kecuali kamu memilih untuk langsung mengaktifkannya. Gunakan **Import
JSON** untuk backup Suwok Router; gunakan **Migrate from 9Router** untuk backup
9Router.

## Providers

Katalog bawaan Suwok Router saat ini menampilkan **65 provider**. Daftar di bawah
diambil dari provider yang tersedia di dashboard, bukan daftar marketing.
Ketersediaan provider dan pilihan auth bisa berubah mengikuti layanan upstream.

### API key — 44

| Provider                 | ID                  |
| ------------------------ | ------------------- |
| Alibaba Coding           | `alicode-intl`      |
| Alibaba                  | `alicode`           |
| Alibaba Studio           | `alims-intl`        |
| Anthropic                | `anthropic`         |
| Azure OpenAI             | `azure`             |
| Baidu Qianfan            | `baidu`             |
| Blackbox AI              | `blackbox`          |
| BytePlus ModelArk        | `byteplus`          |
| Cerebras                 | `cerebras`          |
| Chutes AI                | `chutes`            |
| Cloudflare               | `cloudflare-ai`     |
| Command Code             | `commandcode`       |
| DeepSeek                 | `deepseek`          |
| Featherless              | `featherless`       |
| Fireworks AI             | `fireworks`         |
| Gemini                   | `gemini`            |
| GLM (China)              | `glm-cn`            |
| GLM Coding               | `glm`               |
| Groq                     | `groq`              |
| Kilo Gateway             | `kilo-gateway`      |
| Minimax (China)          | `minimax-cn`        |
| Minimax Coding           | `minimax`           |
| Mistral                  | `mistral`           |
| Morph                    | `morph`             |
| Nebius AI                | `nebius`            |
| NVIDIA NIM               | `nvidia`            |
| Ollama Local             | `ollama-local`      |
| Ollama Cloud             | `ollama`            |
| OpenAI                   | `openai`            |
| OpenCode Go              | `opencode-go`       |
| OpenRouter               | `openrouter`        |
| Perplexity AI            | `perplexity`        |
| Poolside                 | `poolside`          |
| Tencent Hunyuan          | `tencent`           |
| Together AI              | `together`          |
| Venice AI                | `venice`            |
| Vercel AI Gateway        | `vercel-ai-gateway` |
| Vertex Partner           | `vertex-partner`    |
| Vertex AI                | `vertex`            |
| Xiaomi MiMo              | `xiaomi-mimo`       |
| Xiaomi MiMo (Token Plan) | `xiaomi-tokenplan`  |
| Meta AI                  | `meta`              |
| Agent Router             | `agentrouter`       |
| SumoPod                  | `sumopod`           |

Perplexity AI memakai [Perplexity Router API resmi](https://docs.perplexity.ai/docs/router/quickstart): satu API key, satu koneksi, dan satu katalog model live untuk format OpenAI Chat Completions, OpenAI Responses, dan Anthropic Messages.

### OAuth, device code, atau token import — 19

| Provider              | ID               |
| --------------------- | ---------------- |
| Antigravity           | `antigravity`    |
| Claude Code           | `claude`         |
| Cline                 | `cline`          |
| ClinePass             | `clinepass`      |
| CodeBuddy CN          | `codebuddy-cn`   |
| CodeBuddy             | `codebuddy-intl` |
| OpenAI Codex          | `codex`          |
| Cursor IDE            | `cursor`         |
| Gemini CLI            | `gemini-cli`     |
| GitHub Copilot        | `github`         |
| Grok CLI (Grok Build) | `grok-cli`       |
| Kilo Code             | `kilocode`       |
| Kimchi                | `kimchi`         |
| Kimi                  | `kimi`           |
| Kiro AI               | `kiro`           |
| Qoder                 | `qoder`          |
| Trae                  | `trae`           |
| Windsurf              | `windsurf`       |
| xAI (Grok)            | `xai`            |

### Web cookie — 1

| Provider                | ID         |
| ----------------------- | ---------- |
| Grok Web (Subscription) | `grok-web` |

### No auth — 1

| Provider      | ID         |
| ------------- | ---------- |
| OpenCode Free | `opencode` |

## CLI Tools yang didukung

Suwok Router bisa mendeteksi dan mengatur coding tools berikut agar memakai
gateway:

- Claude Code
- Codex CLI
- OpenCode
- Hermes Agent
- Claude Cowork
- Kilo Code
- Grok Build
- OMP (oh-my-pi)

## Fitur yang tersedia

### Provider dan akun

- Hubungkan provider lewat API key, OAuth, device code, cookie/session, atau
  access/refresh token kalau flow tersebut didukung provider.
- Tambahkan banyak akun ke satu provider, lengkap dengan prioritas dan status
  enable/disable.
- Test koneksi, test model tertentu, atau test semua model dalam satu batch.
- Import katalog model secara live kalau endpoint upstream tersedia.
- Tambahkan custom provider, custom node, custom model, alias, dan pricing.
- Tandai capability model seperti vision, audio, video, search, tools, dan
  reasoning.
- Simpan ID model upstream, endpoint, header, dan aturan kompatibilitas khusus
  provider.

### Routing dan fallback

- `fill-first` untuk penggunaan akun yang predictable.
- `round-robin` untuk rotasi sederhana.
- `least-inflight` untuk membagi request aktif.
- `sticky` dan `cache-affine` saat koneksi akun perlu tetap stabil.
- Override routing per provider dan kontrol sticky.
- Combo untuk fallback model/provider secara berurutan.
- Cooldown akun, account lock, endpoint fallback, dan retry yang dibatasi.

### Translasi dan dukungan model

- Format request OpenAI, Anthropic, Responses, dan Ollama-style.
- Translasi request dan response khusus tiap provider.
- Konversi streaming lewat SSE dan response JSON biasa.
- Tool call, thinking/reasoning, vision, image input, media, dan usage sesuai
  dukungan model yang dipilih.
- Compatibility fallback untuk parameter opsional yang ditolak upstream.
- Dynamic model discovery, katalog statis, custom model, alias, disabled model,
  dan filter berdasarkan capability.

### Usage, cost, dan kuota

- History request dengan provider, model, akun, endpoint, status, dan latency.
- Tracking token input, output, cached, dan total.
- Estimasi cost dengan USD sebagai default dan IDR sebagai pilihan.
- Total per provider, chart, aktivitas terbaru, dan detail request.
- Quota monitor dengan status provider/akun dan tombol refresh.
- Optional capture request/response payload dengan kontrol retention.

### Backup dan migrasi

- Export dan restore data Suwok Router dalam format JSON.
- Migrasi dari instalasi lokal 9Router atau backup JSON 9Router.
- Pilih account, custom provider, model, combo, dan routing settings yang mau
  diimport.
- Lihat preview kompatibilitas dan duplikat sebelum ada perubahan, lalu buat
  safety backup sebelum migrasi diterapkan.

### Performa dan reliability

- Global request admission control dan queue yang dibatasi.
- Batas concurrency per provider dan per akun.
- Kapasitas adaptif berdasarkan memory dan CPU yang tersedia.
- Batas body request plus timeout upload, koneksi, stream, dan queue.
- Retry upstream dan endpoint fallback dengan jumlah percobaan terkontrol.
- Refresh OAuth otomatis dan deduplikasi refresh token.
- Penanganan aman untuk disconnect, stream yang dibatalkan, provider error, dan
  response 429.
- Graceful shutdown supaya request aktif bisa selesai dengan rapi.

### Built-in tools

- Suwok Chat dengan web search opsional lewat Tavily atau Brave.
- Shell, curl, dan router inspection tools dengan kontrol yang jelas.
- Fitur token saver RTK, Caveman, dan Ponytail.
- CLI model mapping untuk coding tools yang didukung.

## Suwok Router vs 9Router vs OmniRoute

Ketiganya menyelesaikan masalah yang mirip dan punya routing, account, fallback,
serta provider workflow. Perbandingan arsitektur sederhananya:

Suwok Router juga punya rotasi multi-account, pemilihan berbasis kuota, token saver,
retry, fallback, dan refresh token provider. Bagian ini sengaja fokus ke berat
runtime, bukan adu daftar fitur.

- **Suwok Router:** Bun + Hono + PostgreSQL, dengan dashboard React/Vite. Satu
  core server yang dirancang untuk penggunaan lokal dan VPS kecil.
- **[9Router](https://github.com/decolua/9router):** Node + Next.js/React +
  Express + PostgreSQL/Redis. Layer framework lebih banyak dan runtime CLI terpisah.
- **[OmniRoute](https://github.com/diegosouzapw/OmniRoute):** Node + Next.js/
  React + PostgreSQL, dengan layer Redis, browser, desktop, dan PWA opsional.

### Mana yang lebih ringan?

Untuk setup gateway lokal atau VPS kecil yang sebanding, **Suwok Router adalah
default yang lebih ringan**. Bun dan Hono punya overhead server yang lebih kecil
daripada aplikasi Next.js penuh, dan core Suwok Router tidak membutuhkan service
tambahan untuk berjalan.

Ini perbandingan arsitektur, bukan janji RAM tetap. Pemakaian nyata tetap
tergantung concurrent stream, ukuran request, jumlah account, layer proxy, dan
service opsional. Starting point VPS kecil Suwok Router yang didokumentasikan adalah
2 vCPU dan 2 GB RAM, dengan queue, concurrency, retry, dan request body yang
dibatasi.

### Kenapa pilih Suwok Router?

- **Footprint default lebih kecil.** Core cukup dengan server Bun dan PostgreSQL,
  tanpa Redis, hosted sync service, desktop shell, atau browser pool.
- **Dashboard yang enak dipakai harian.** Provider, account, model, routing,
  usage, quota, proxy, log, dan settings ada dalam satu control room yang clean.
- **Resource guardrail sudah built-in.** Suwok Router mendeteksi profile host dan
  menjaga concurrency, queue, request body, retry, serta background work tetap
  terbatas.
- **Gampang dikirim dan diperiksa.** Bisa dijalankan lokal, di VPS kecil, Docker,
  atau standalone binary, dengan backup/import dan API yang mudah
  diinspeksi.

Angka dan peta menu Suwok Router diambil dari [provider registry](./src/providers/registry/index.js),
[navigasi dashboard](./dashboard/src/components/Sidebar.tsx),
[route table](./src/routes/table.js), dan [package manifest](./package.json).

## Operasional dan keamanan

- Session dashboard memakai JWT dan password hashing dengan bcrypt.
- Login limiting dan admin route yang terlindungi.
- Gateway auth lewat `Authorization: Bearer ...` atau `x-api-key`.
- Default binding ke localhost dan credential provider tetap di server.
- Secret dari environment variable dan perlindungan SSRF.
- Health, readiness, version, runtime status, dan Prometheus-style metrics.
- PostgreSQL: migrasi berversi, index partial, backup JSON + restore, export, dan import.
- Docker/Compose, native source run, Bun CLI, dan standalone binary.

Suwok Router menjaga process dan account pool-nya sendiri, tapi tidak membuat kuota
provider dan tidak menjanjikan RPS tetap. Kapasitas nyata tetap tergantung limit
provider, jumlah akun, latency jaringan, ukuran prompt, dan durasi stream.

## Tech stack

- **Runtime:** Bun, dengan fallback yang kompatibel dengan Node jika diperlukan
- **Gateway:** TypeScript, Hono, native HTTP, dan SSE
- **Dashboard:** React, Vite, Tailwind CSS, React Router, dan TanStack Query
- **Storage:** PostgreSQL 17, dengan migrasi berversi, backup, dan restore
- **Auth:** JWT, bcrypt, OAuth/PKCE, dan refresh token khusus provider
- **Shipping:** Bun CLI, Docker, standalone binary, dan GitHub Actions

## Konfigurasi

Untuk satu instance lokal atau Docker, konfigurasi bersifat opsional. Saat
start pertama, Suwok Router membuat JWT secret, gateway-key secret, dan machine salt
yang kuat di data directory persistent. Pakai `.env` kalau perlu mengganti
default, bind ke host lain, atau mengelola secret dari luar:

```dotenv
PORT=1212
HOSTNAME=127.0.0.1
NODE_ENV=production
# Wajib: PostgreSQL adalah satu-satunya driver database.
DB_URL=postgres://suwok:suwok@127.0.0.1:5432/suwokrouter
# Opsional: layer cache Valkey/Redis. Tidak di-set = backend in-memory.
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
API_KEY_SECRET=replace-with-a-random-secret-at-least-32-characters
MACHINE_ID_SALT=replace-with-a-random-private-salt
```

Nyalakan stack database yang disertakan, lalu arahkan `DB_URL` ke sana:

```bash
docker compose up -d postgres valkey
```

`DB_URL` wajib: tanpa itu server menolak start. `REDIS_URL` opsional; kalau
tidak di-set, cooldown, refresh lock, dan invalidasi cache memakai backend
in-process seperti sebelumnya.

Migrasi install SQLite yang sudah ada:

```bash
bun scripts/seed-from-sqlite.mjs            # default ~/.suwokrouter/db/data.sqlite
bun scripts/seed-from-sqlite.mjs --dry-run  # laporan saja
```

Seed idempoten (upsert), menyalin semua tabel, dan memajukan sequence
`usageHistory` melewati id yang diimpor.

Jaga volume Postgres tetap persistensi. Di dalamnya ada kredensial provider,
konfigurasi, dan data usage. Jangan pernah commit `.env`, kredensial, backup,
token OAuth, cookie, atau log.

## Development checks

```bash
bun run typecheck
bun test
bun run routes:check
bun run package:check
bun run build:binary
bun run smoke:binary
bun run build:dashboard
bun run test:e2e:install
bun run test:e2e
```

## Atribusi

Suwok Router adalah project standalone. Beberapa bagian OAuth, tunnel, CLI, dan utility
diadaptasi dari [9Router](https://github.com/decolua/9router), sedangkan gateway,
routing, dashboard, storage, API, performa, dan setup release dikembangkan serta
dirawat di project ini.

Lihat [`LICENSE`](./LICENSE) untuk atribusi MIT lengkap.

## Lisensi

MIT. Lihat [`LICENSE`](./LICENSE).

Suwok Router adalah gateway dan admin tool. Kamu bertanggung jawab atas akun
provider, credential, traffic, privacy, compliance, dan keamanan deployment-mu.
