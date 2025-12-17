/*
  Fase 4 - Cashback/MMN
  Mudanças registradas manualmente:
  - TransactionSource: adiciona WELCOME_BONUS
  - CashbackTransaction: adiciona coluna expiresAt + index
  - Payment: adiciona coluna dueAt + index
  - Cria tabela ReferralLevelConfig (níveis do MMN até 9)
*/

-- ============================================================
-- 1) ENUM: TransactionSource -> adiciona WELCOME_BONUS
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'TransactionSource'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'TransactionSource'
        AND e.enumlabel = 'WELCOME_BONUS'
    ) THEN
ALTER TYPE "public"."TransactionSource" ADD VALUE 'WELCOME_BONUS';
END IF;
END IF;
END $$;

-- ============================================================
-- 2) CashbackTransaction: expiresAt + index
-- ============================================================
ALTER TABLE "public"."CashbackTransaction"
    ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CashbackTransaction_expiresAt_idx"
    ON "public"."CashbackTransaction" ("expiresAt");

-- ============================================================
-- 3) Payment: dueAt + index
-- ============================================================
ALTER TABLE "public"."Payment"
    ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Payment_dueAt_idx"
    ON "public"."Payment" ("dueAt");

-- ============================================================
-- 4) ReferralLevelConfig (MMN até 9 níveis)
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."ReferralLevelConfig" (
                                                              "id"        SERIAL       PRIMARY KEY,
                                                              "level"     INTEGER      NOT NULL,
                                                              "amount"    DOUBLE PRECISION NOT NULL,
                                                              "isActive"  BOOLEAN      NOT NULL DEFAULT true,
                                                              "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- Unique em level (evita duplicar nível)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReferralLevelConfig_level_key'
  ) THEN
ALTER TABLE "public"."ReferralLevelConfig"
    ADD CONSTRAINT "ReferralLevelConfig_level_key" UNIQUE ("level");
END IF;
END $$;

-- (Opcional) Seed de 1..9 (deixe valores 0.0 e ajuste depois)
-- Se você já sabe os valores por nível, eu coloco certinho aqui.
DO $$
DECLARE
i INT;
BEGIN
FOR i IN 1..9 LOOP
    INSERT INTO "public"."ReferralLevelConfig" ("level", "amount", "isActive")
    VALUES (i, 0.0, true)
    ON CONFLICT ("level") DO NOTHING;
END LOOP;
END $$;
