# Security Notes

## Kontrol yang udah aman

- Session token acak disimpan sebagai hash SHA-256 di database; browser hanya menerima cookie `HttpOnly`, `Secure` pada production, dan `SameSite=Strict`.
- Cookie `__Host-` di production dengan `Secure; Path=/`; cookie name fallback ke `localsheet_session` di development.
- Password di-hash memakai Argon2id.
- Dummy-hash fallback saat login user tak ditemukan untuk mencegah user-enumeration via timing.
- Rate limit per-IP dan per-email (5/15 menit untuk auth, 60/menit untuk sync, 100/menit global).
- Endpoint mutasi memeriksa Origin/Referer, Fetch Metadata, header anti-CSRF, content type, ukuran body, schema Zod strict, dan rate limit.
- API sinkronisasi tidak menerima atau mempercayai `userId` dari klien. Kepemilikan workbook selalu dibatasi oleh user dari session.
- Setiap operasi sinkronisasi memiliki `operationId` unik untuk idempotency (cek duplikat sebelum proses).
- IndexedDB diikat ke akun pertama sehingga sesi akun lain tidak dapat menyerap data lokal tersebut.
- Cursor pull ditandatangani HMAC dan diikat ke user; secret wajib ≥32 char, tidak ada fallback dev.
- `version` menjadi concurrency token. Update menggunakan `SELECT ... FOR UPDATE` dalam transaksi `SERIALIZABLE` untuk mencegah lost update.
- Semua perubahan batch diproses dalam transaksi PostgreSQL `SERIALIZABLE` dengan `withTransaction()` helper.
- Snapshot divalidasi rekursif: key whitelist regex + blocklist `__proto__`/`constructor`/`prototype`; maks 1MB dan 10.000 elemen per array.
- Title divalidasi tanpa karakter kontrol.
- Seluruh SQL memakai parameter binding; nilai dari request tidak pernah diinterpolasikan ke query.
- `statement_timeout` dan `query_timeout` di pool PostgreSQL.
- Pool diinisialisasi lazy; auto-migrate dihapus dari runtime, dipindah ke script `pnpm db:migrate`.
- TLS PostgreSQL (`DB_SSL=true`) dengan `rejectUnauthorized` (default true) untuk mencegah MITM.
- Response error production tidak membocorkan stack trace.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (production).
- CSP via `vercel.json` di production: `default-src 'self'`, no `unsafe-eval`, `frame-ancestors 'none'`.
- `trust proxy` configurable via `TRUST_PROXY` env (default `loopback`).
- `docker-compose` membaca password dari env (gagal-fast jika kosong) dan tidak hardcode.
- Tidak ada user demo dengan password hardcoded; gunakan `pnpm seed:demo` untuk generate on-the-fly.

## Yang wajib diganti sebelum skala production

1. Ganti rate limiter in-memory dengan Redis/Upstash atau gateway rate limit yang terdistribusi.
2. Terapkan CSP berbasis nonce jika organisasi melarang inline script/style. Konfigurasi starter mengutamakan kompatibilitas Univer (`'unsafe-inline'` untuk style).
3. Tambahkan audit log, device/session management, alerting, database backup, key rotation, dan job penghapusan session/operation idempotency yang kedaluwarsa.
4. Letakkan aplikasi di belakang HTTPS, reverse proxy tepercaya, WAF, dan connection pool PostgreSQL yang managed.
5. Lakukan dependency scanning, SAST, DAST, dan penetration test sebelum menyimpan data sensitif.
6. Enkripsi data sensitif di tingkat aplikasi jika snapshot memuat PII bernilai tinggi.
7. Tambah email verification, password reset, dan session invalidation saat ganti password.
8. Pertimbangkan `workbox.runtimeCaching` yang lebih ketat untuk service worker.

## Pelaporan

Jangan memasukkan secret, cookie, password, atau isi workbook pengguna ke issue publik.