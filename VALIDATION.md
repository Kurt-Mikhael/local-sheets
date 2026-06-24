# Validation Record

Proyek telah diperiksa pada 23 Juni 2026 dengan Node.js 22 dan pnpm 10.

```text
pnpm lint   -> passed
pnpm build  -> passed
pnpm start  -> HTTP 200 untuk / dan manifest.webmanifest
```

Build menghasilkan route statis untuk UI serta route dinamis untuk autentikasi dan sinkronisasi. Pengujian integrasi database memerlukan PostgreSQL aktif melalui `docker compose up -d`, kemudian `pnpm db:migrate`.
