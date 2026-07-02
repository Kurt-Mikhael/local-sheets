# Deployment Localsheet

## Requirements

VPS Linux (Ubuntu 22.04+ / Debian 12+) — rekomendasi 1 CPU, 1 GB RAM minimum

- Domain yang sudah diarahkan ke IP VPS (lewat Cloudflare atau DNS provider)
- Akses root / sudo

---

## 1. Install Software di Server

Login ke VPS lewat SSH, lalu jalankan:

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

---

## 2. Setup Database PostgreSQL

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

---

## 3. Clone & Setup Kode

```bash
sudo mkdir -p /var/www/localsheet
sudo chown -R $USER:$USER /var/www/localsheet
cd /var/www/localsheet
git clone https://github.com/USERNAME/REPO-KAMU.git .
cp .env.example .env
```

Edit file `.env`:

```bash
nano .env
```

Ubah isinya jadi:

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

Buat `CURSOR_SIGNING_SECRET` random:

```bash
openssl rand -base64 48
```

Copy hasilnya ke `.env`. Simpan file (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 4. Install Dependensi & Build

```bash
cd /var/www/localsheet
pnpm install --frozen-lockfile
```

Jalankan migration database (membuat semua tabel):

```bash
pnpm db:migrate
```

Buat akun admin pertama (ikuti prompt username & password):

```bash
pnpm seed:admin
```

Build Frontend:

```bash
pnpm build
```

Build Backend TypeScript:

```bash
cd packages/be && pnpm build && cd ../..
```

Output build:

- FE: `/var/www/localsheet/packages/fe/dist`
- BE: `/var/www/localsheet/packages/be/dist`

---

## 5. Run Backend sebagai Service

Supaya BE otomatis nyala tiap server restart.

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
ExecStart=/usr/bin/node --env-file=/var/www/localsheet/.env dist/index.js
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

---

## 6. Setup Nginx

```bash
sudo nano /etc/nginx/sites-available/localsheet
```

Isi (ganti `sheet.domainkamu.com` dengan domain kamu):

```nginx
server {
  listen 80;
  server_name sheet.domainkamu.com;

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

  # Backend API
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 6m;
  }

  # WebSocket (kolaborasi)
  location /ws/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/localsheet /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. HTTPS Gratis (Let's Encrypt)

```bash
sudo certbot --nginx -d sheet.domainkamu.com
```

Ikuti prompt, pilih redirect HTTP ke HTTPS. Sertifikat auto-renew, test dengan:

```bash
sudo certbot renew --dry-run
```

---

## 8. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 9. Tes

Buka browser, akses `https://sheet.domainkamu.com`. Login dengan akun admin yang dibuat di langkah 4. Kalau muncul halaman login, deploy berhasil.

Cek log kalau ada masalah:

```bash
sudo journalctl -u localsheet-be -f
sudo tail -f /var/log/nginx/error.log
```

---

## Update Kode (Nanti)

```bash
cd /var/www/localsheet
git pull
pnpm install --frozen-lockfile
pnpm db:migrate          # kalau ada migration baru
pnpm build               # FE
cd packages/be && pnpm build && cd ../..
sudo systemctl restart localsheet-be
```

---

## Backup Database

Backup:

```bash
sudo -u postgres pg_dump localsheet > backup-$(date +%F).sql
```

Restore:

```bash
sudo -u postgres psql localsheet < backup-2026-07-02.sql
```

Simpan file backup di tempat aman (S3, Google Drive, dll).

---

## Troubleshooting

| Masalah                              | Solusi                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm install` gagal di `argon2` | Pastikan`build-essential` & `python3` terinstall (langkah 1)             |
| `502 Bad Gateway`                  | Cek`systemctl status localsheet-be`                                        |
| Login gagal                          | Cek`APP_ORIGIN` di `.env` sama persis dengan domain (pakai `https://`) |
| WebSocket tidak konek                | Pastikan Nginx config blok`/ws/` ada & certbot tidak menghapus             |
| Database connection error            | Cek`DATABASE_URL` password sama dengan yang dibuat di langkah 2            |
