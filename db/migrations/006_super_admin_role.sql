-- =====================================================
-- 006: tambahkan role 'super_admin'
-- Super admin bisa melihat & mengedit semua workbook dan
-- promote user lain (hanya super_admin yang bisa promote).
-- =====================================================

-- Drop constraint lama (baik yang dari 003 maupun constraint up-to-date)
-- dan pasang ulang dengan nilai baru. Idempotent.
DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check_legacy;
  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'admin', 'super_admin'));
END
$$;

-- Seed super_admin pertama berdasarkan GUC 'app_super_admin_email'
-- (di-supply saat deploy lewat env APP_GUC_APP_SUPER_ADMIN_EMAIL=...
-- yang di-forward oleh scripts/migrate.mjs ke session Postgres).
-- Migration ini idempotent: kalau user belum ada, dilewati; kalau
-- sudah ada, di-promote.
DO $$
DECLARE
  target_email TEXT := current_setting('app_super_admin_email', true);
  target_id    UUID;
BEGIN
  IF target_email IS NULL OR target_email = '' THEN
    RAISE NOTICE 'app_super_admin_email tidak di-set, lewati seed super_admin';
    RETURN;
  END IF;

  SELECT id INTO target_id FROM users WHERE email = lower(target_email) LIMIT 1;
  IF target_id IS NULL THEN
    RAISE NOTICE 'user dengan email % belum ada, lewati seed super_admin (buat dulu lewat register)', target_email;
    RETURN;
  END IF;

  UPDATE users SET role = 'super_admin' WHERE id = target_id;
  RAISE NOTICE 'user % di-promote ke super_admin', target_email;
END
$$;
