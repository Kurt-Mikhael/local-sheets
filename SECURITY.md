# Security Notes

## Kontrol yang sudah diterapkan

- Session token acak disimpan sebagai hash SHA-256 di database; browser hanya menerima cookie `HttpOnly`, `Secure` pada production, dan `SameSite=Strict`.
- Password di-hash memakai Argon2id.
- Endpoint mutasi memeriksa origin, Fetch Metadata, header anti-CSRF, content type, ukuran body, schema Zod yang strict, dan rate limit.
- API sinkronisasi tidak menerima atau mempercayai `userId` dari klien. Kepemilikan workbook selalu dibatasi oleh user dari session.
- Setiap operasi sinkronisasi memiliki `operationId` unik untuk idempotency.
- IndexedDB diikat ke akun pertama sehingga sesi akun lain tidak dapat menyerap data lokal tersebut.
- Cursor pull ditandatangani HMAC dan diikat ke user agar tidak dapat dimanipulasi untuk melewati perubahan.
- `version` menjadi concurrency token. Update dilakukan dengan kondisi `id + userId + version` agar lost update terdeteksi.
- Semua perubahan batch diproses dalam transaksi PostgreSQL `SERIALIZABLE`.
- Seluruh SQL memakai parameter binding; nilai dari request tidak pernah diinterpolasikan ke query.
- Response error production tidak membocorkan stack trace.

## Yang wajib diganti sebelum skala production

1. Ganti rate limiter in-memory dengan Redis/Upstash atau gateway rate limit yang terdistribusi.
2. Terapkan CSP berbasis nonce jika organisasi melarang inline script/style. Konfigurasi starter mengutamakan kompatibilitas Next.js dan Univer.
3. Tambahkan audit log, device/session management, alerting, database backup, key rotation, dan job penghapusan session/operation idempotency yang kedaluwarsa.
4. Letakkan aplikasi di belakang HTTPS, reverse proxy tepercaya, WAF, dan connection pool PostgreSQL.
5. Lakukan dependency scanning, SAST, DAST, dan penetration test sebelum menyimpan data sensitif.
6. Enkripsi data sensitif di tingkat aplikasi jika snapshot memuat PII bernilai tinggi.

## Pelaporan

Jangan memasukkan secret, cookie, password, atau isi workbook pengguna ke issue publik.
