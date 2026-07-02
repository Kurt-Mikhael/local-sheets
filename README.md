# LocalSheet — Next.js Offline-First Spreadsheet

Starter web spreadsheet berbasis Next.js yang selalu menyimpan perubahan ke IndexedDB terlebih dahulu. Ketika koneksi tersedia dan pengguna sudah login, Outbox menyinkronkan perubahan ke PostgreSQL melalui API yang tervalidasi dan idempotent.

## Ruang lingkup yang benar

Univer Sheets menyediakan editor, styling, formula engine, number formatting, freeze pane, filter, data validation, dan conditional formatting. Starter ini mengaktifkan fitur inti tersebut. Klaim “100% sama dengan Microsoft Excel” tidak realistis untuk implementasi open-source biasa: VBA/macro, Power Query, add-in Excel, kolaborasi real-time, chart tingkat lanjut, dan fidelity impor/ekspor `.xlsx` tertentu membutuhkan modul tambahan, layanan konversi, atau Univer Pro.

## Arsitektur

- **UI / Framework:** Next.js 16 App Router + React 19.
- **Spreadsheet engine:** Univer Sheets.
- **Local database:** IndexedDB melalui Dexie.
- **Global database:** PostgreSQL melalui driver `pg` dan repository ber-query parameterized.
- **Offline shell:** Web App Manifest + service worker.
- **Authentication:** session cookie HttpOnly dan password Argon2id.
- **Synchronization:** Outbox Pattern + Repository Pattern + Adapter Pattern + Application Service + Optimistic Concurrency Control.

Alur perubahan:

1. Pengguna mengubah workbook.
2. Snapshot terbaru disimpan ke IndexedDB dan record Outbox dibuat/dikompaksi per workbook.
3. Saat online, `SyncService` mengirim batch maksimal 25 perubahan.
4. Server memvalidasi session, origin, ukuran body, dan schema request.
5. Server memproses operation idempotent dalam transaksi serializable dan membandingkan `baseVersion`.
6. Jika versi cocok, server menaikkan `version`. Jika tidak, server mengembalikan konflik tanpa menimpa data.
7. Klien memilih “gunakan lokal” atau “gunakan server”.

## Menjalankan lokal

Prasyarat: Node.js 20.9+, Docker, dan pnpm 10.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Buka `http://localhost:3000`. Daftar akun, buka workbook, kemudian uji mode offline melalui DevTools → Network → Offline. Edit beberapa sel, kembalikan koneksi, lalu tekan **Sinkronkan**.

## Perilaku offline

- Aplikasi harus pernah dibuka online setidaknya sekali agar app shell dan asset tersimpan oleh service worker.
- Workbook disimpan di IndexedDB dan tetap bisa diedit tanpa internet.
- Login/daftar memerlukan internet.
- Sinkronisasi berjalan ketika event `online` diterima, saat tombol ditekan, dan setiap 60 detik selama browser menganggap koneksi tersedia.
- `navigator.onLine` bukan bukti server dapat dijangkau; kegagalan jaringan tidak menghapus Outbox.

## Keamanan request sinkronisasi

Endpoint `/api/sync` menerapkan:

- autentikasi session dan authorization per user;
- pengabaian total terhadap `userId` dari payload;
- pengikatan IndexedDB ke akun pertama untuk mencegah sinkronisasi silang pada browser yang sama;
- Zod strict schema dan pembacaan body streaming dengan batas ukuran request;
- maksimal 25 perubahan per request;
- rate limit;
- idempotency melalui `operationId`;
- update atomik `id + userId + version`;
- transaksi PostgreSQL `SERIALIZABLE`;
- cursor pull bertanda tangan HMAC dan terikat ke user;
- response error yang tidak membocorkan stack.

Lihat `SECURITY.md` untuk hardening production.

## Pengembangan berikutnya

Prioritas yang rasional setelah starter berjalan:

1. Tambahkan Redis rate limiter dan observability.
2. Tambahkan export/import CSV open-source atau layanan `.xlsx` terisolasi.
3. Ubah snapshot-level conflict menjadi cell-operation log atau CRDT jika banyak pengguna mengedit workbook yang sama secara bersamaan.
4. Tambahkan RBAC, share workbook, audit trail, version history, dan soft-delete retention.
5. Tambahkan quota snapshot, compression, chunk upload, dan object storage untuk workbook besar.
6. Tambahkan automated tests untuk API authorization, replay/idempotency, payload fuzzing, dan conflict race.

## Catatan dependensi

Versi package mengikuti ekosistem Juni 2026. Seluruh package dalam namespace `@univerjs/*` harus dipertahankan pada versi minor yang sama agar facade dan plugin tetap kompatibel.