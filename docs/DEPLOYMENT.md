root@svr-localsheet:/# sudo -u postgres psql
psql (16.14 (Ubuntu 16.14-0ubuntu0.24.04.1))
Type "help" for help.

postgres=# sudo -u postgres psql
postgres-# CREATE USER localsheet WITH PASSWORD 'rahasia123';
CREATE DATABASE localsheet OWNER localsheet;
GRANT ALL PRIVILEGES ON DATABASE localsheet TO localsheet;
\q
ERROR:  syntax error at or near "sudo"
LINE 1: sudo -u postgres psql
        ^
ERROR:  role "localsheet" does not exist
ERROR:  database "localsheet" does not exist

# Deploy LocalSheet ke Server Sendiri

Dua pilihan cara deploy:

- **Cara A — Docker (disarankan)**: Postgres + app + Nginx dalam container. Lebih portable & konsisten.
- **Cara B — Manual (tanpa Docker)**: Install Postgres, Node, pnpm, Nginx langsung di server.

---

## Yang Dibutuhkan (kedua cara)

- VPS Linux (Ubuntu 22.04+ / Debian 12+) — minimum 1 CPU, 1 GB RAM
- Domain yang sudah diarahkan ke IP VPS (atau langsung pakai IP)
- Akses root / sudo

---

# Cara A — Docker (Disarankan)

Lebih simpel: satu command untuk jalanin semua service.

## A1. Install Docker

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## A2. Clone & Setup Env

```bash
sudo mkdir -p /var/www/localsheet
sudo chown -R $USER:$USER /var/www/localsheet
cd /var/www/localsheet
git clone https://github.com/Kurt-Mikhael/local-sheets.git .

# Folder ini sekarang berisi isi repo (package.json, docs/, packages/, dll)
cp .env.example .env
nano .env
```

Isi `.env`:

```env
POSTGRES_DB=localsheet
POSTGRES_USER=localsheet
POSTGRES_PASSWORD=rahasia123
POSTGRES_PORT=5432

NODE_ENV=production
APP_ORIGIN=https://sheet.domainkamu.com
APP_ORIGIN_EXTRA=
DATABASE_URL=postgresql://localsheet:rahasia123@postgres:5432/localsheet?schema=public
DB_SSL=false
TRUST_PROXY=1
CURSOR_SIGNING_SECRET=GANTI-DENGAN-32-KARAKTER-RANDOM
SESSION_TTL_DAYS=30
MAX_SYNC_BODY_BYTES=5242880
```

`CURSOR_SIGNING_SECRET` random:

```bash
openssl rand -base64 48
```

> Catatan: `DATABASE_URL` di container mengarah ke hostname `postgres` (bukan `localhost`), karena Postgres & app berada di container berbeda dalam network `localsheet`.

## A3. Build & Jalanin

```bash
docker compose up -d --build
```

Tunggu sampai semua container `healthy` / `running`:

```bash
docker compose ps
docker compose logs -f app
```

Cek log dengan `Ctrl+C` setelah `Server running on http://localhost:4000` muncul.

## A4. Migrasi Database & Seed Admin

```bash
docker compose exec app sh -c "pnpm db:migrate && pnpm seed:admin"
```

## A5. HTTPS (Opsional tapi Disarankan)

Masuk ke host (bukan container):

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d sheet.domainkamu.com
```

Copy sertifikat ke folder yang di-mount oleh Nginx container:

```bash
sudo mkdir -p /var/www/localsheet/docker/certs
sudo cp /etc/letsencrypt/live/sheet.domainkamu.com/fullchain.pem /var/www/localsheet/docker/certs/
sudo cp /etc/letsencrypt/live/sheet.domainkamu.com/privkey.pem /var/www/localsheet/docker/certs/
```

Tambah blok `server { listen 443 ssl; ... }` di `docker/nginx.conf` (lihat dokumentasi Nginx ssl).

Restart:

```bash
docker compose restart nginx
```

## A6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## A7. Tes

Buka `https://sheet.domainkamu.com` (atau `http://IP-VPS`). Login dengan akun admin.

---

# Cara B — Manual (Tanpa Docker)

Install Postgres, Node, pnpm, Nginx langsung di server, jalankan BE via systemd.

## B1. Install Software

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx postgresql postgresql-contrib certbot python3-certbot-nginx build-essential python3
```

Install Node.js 20 & pnpm:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm@10
```

Cek versi:

```bash
node -v    # harus v20.x ke atas
pnpm -v    # harus 10.x
```

## B2. Setup Database PostgreSQL

```bash
sudo -u postgres psql
```

Di dalam prompt `postgres=#`, ketik (ganti `rahasia123` dengan password kuat):

```sql
CREATE USER localsheet WITH PASSWORD 'rahasia123';
CREATE DATABASE localsheet OWNER localsheet;
GRANT ALL PRIVILEGES ON DATABASE localsheet TO localsheet;
\q
```

## B3. Clone & Setup Env

```bash
sudo mkdir -p /var/www/localsheet
sudo chown -R $USER:$USER /var/www/localsheet
cd /var/www/localsheet
git clone https://github.com/Kurt-Mikhael/local-sheets.git .

# Folder ini sekarang berisi isi repo (package.json, docs/, packages/, dll)
cp .env.example .env
nano .env
```

Isi `.env`:

```env
NODE_ENV=production
APP_ORIGIN=https://sheet.domainkamu.com
APP_ORIGIN_EXTRA=
DATABASE_URL=postgresql://localsheet:rahasia123@localhost:5432/localsheet?schema=public
DB_SSL=false
TRUST_PROXY=1
CURSOR_SIGNING_SECRET=GANTI-DENGAN-32-KARAKTER-RANDOM
SESSION_TTL_DAYS=30
MAX_SYNC_BODY_BYTES=5242880
```

`CURSOR_SIGNING_SECRET` random:

```bash
openssl rand -base64 48
```

> Catatan: `DATABASE_URL` pakai `localhost` karena Postgres & app di server yang sama.

## B4. Install Dependensi & Build

```bash
cd /var/www/localsheet
pnpm install --frozen-lockfile
```

Jalankan migration database (membuat semua tabel):

```bash
pnpm db:migrate
```

Buat akun admin pertama:

```bash
pnpm seed:admin
```

Build Frontend & Backend:

```bash
pnpm --filter shared build
pnpm --filter be build
pnpm --filter fe build
```

Atau sekaligus (root `pnpm build` udah mencakup ketiganya):

```bash
pnpm build
```

Output:

- shared: `/var/www/localsheet/packages/shared/dist`
- BE: `/var/www/localsheet/packages/be/dist/be/src/index.js`
- FE: `/var/www/localsheet/packages/fe/dist`

## B5. Jalankan Backend sebagai Service

```bash
sudo nano /etc/systemd/system/localsheet-be.service
```

Isi file:

```ini
[Unit]
Description=LocalSheet Backend
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/localsheet/packages/be
ExecStart=/usr/bin/node --env-file=/var/www/localsheet/.env dist/be/src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Simpan, lalu:

```bash
sudo chown -R www-data:www-data /var/www/localsheet
sudo systemctl daemon-reload
sudo systemctl enable --now localsheet-be
sudo systemctl status localsheet-be
```

Pastikan status `active (running)`. Kalau error, lihat log:

```bash
sudo journalctl -u localsheet-be -n 50
```

## B6. Setup Nginx (Reverse Proxy)

```bash
sudo nano /etc/nginx/sites-available/localsheet
```

Isi (ganti `sheet.domainkamu.com` dengan domain kamu, atau pakai `_` untuk akses via IP):

```nginx
server {
  listen 80;
  server_name sheet.domainkamu.com _;

  root /var/www/localsheet/packages/fe/dist;
  index index.html;

  # Security headers
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  # Frontend static
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Service worker: jangan di-cache
  location = /sw.js {
    add_header Cache-Control "no-cache";
  }

  # Backend API + WebSocket (kolaborasi lewat /api/collab)
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
    client_max_body_size 6m;
  }
}
```

> **Catatan**: WebSocket kolab memakai path `/api/collab/...`, jadi `Upgrade`/`Connection` headers HARUS ada di blok `location /api/`. Blok `location /ws/` yang lama (path salah) sudah dihapus.

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/localsheet /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## B7. HTTPS Gratis (Let's Encrypt)

```bash
sudo certbot --nginx -d sheet.domainkamu.com
```

Sertifikat auto-renew, test dengan:

```bash
sudo certbot renew --dry-run
```

## B8. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## B9. Tes

Buka `https://sheet.domainkamu.com`. Login dengan akun admin.

---

# Update Kode (Nanti)

## Cara A (Docker)

```bash
cd /var/www/localsheet
git pull
docker compose up -d --build
docker compose exec app sh -c "pnpm db:migrate"
```

## Cara B (Manual)

```bash
cd /var/www/localsheet
git pull
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
sudo systemctl restart localsheet-be
```

---

# Backup Database

```bash
# Cara A
docker compose exec -T postgres pg_dump -U localsheet localsheet > backup-$(date +%F).sql

# Cara B
sudo -u postgres pg_dump localsheet > backup-$(date +%F).sql
```

Restore:

```bash
# Cara A
cat backup-2026-07-02.sql | docker compose exec -T postgres psql -U localsheet -d localsheet

# Cara B
sudo -u postgres psql localsheet < backup-2026-07-02.sql
```

---

# Troubleshooting

| Masalah                              | Solusi                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `pnpm install` gagal di `argon2` | Install`build-essential python3`, lalu `pnpm rebuild argon2`                                      |
| `502 Bad Gateway`                  | Cara A:`docker compose logs app`. Cara B: `systemctl status localsheet-be`                        |
| Login loop / "invalid origin"        | `APP_ORIGIN` di `.env` harus sama persis dengan domain (pakai `https://`, tanpa trailing slash) |
| WebSocket tidak konek                | Pastikan `Upgrade`/`Connection "upgrade"` ada di blok `location /api/` Nginx config                  |
| ServiceWorker gagal register (HTTPS self-signed) | Set `VITE_PWA_PRODUCTION=false` di `.env` saat build, atau pakai cert valid (Let's Encrypt) |
| Database connection error            | Cek`DATABASE_URL`. Cara A: hostname `postgres`. Cara B: hostname `localhost`                    |
| `tsx: command not found` (Cara B)  | `pnpm install` di folder repo, lalu cek `node_modules/.bin/tsx`                                   |
| Certbot gagal                        | DNS domain belum propagate. Tunggu 5–30 menit lalu ulangi                                            |
| Port 4000 bentrok                    | Cek`lsof -i :4000` atau `docker compose ps`                                                       |

---

# Catatan Penting

- **Cara A lebih direkomendasikan** untuk pemula: konsisten, sekali `docker compose up` jadi.
- **Backup database rutin**. File `.sql` hasil `pg_dump` aman disimpan offline / cloud.
- **Update OS berkala**: `sudo apt update && sudo apt upgrade`.
- **Cek log berkala**:
  - Cara A: `docker compose logs --since "1 day ago"`
  - Cara B: `sudo journalctl -u localsheet-be --since "1 day ago"`
- **Struktur penting di server**:
  ```
  /var/www/localsheet/
  ├── .env
  ├── docker-compose.yml
  ├── Dockerfile
  ├── docker/nginx.conf
  ├── packages/fe/dist/         # FE static (Cara B)
  └── ...
  ```
