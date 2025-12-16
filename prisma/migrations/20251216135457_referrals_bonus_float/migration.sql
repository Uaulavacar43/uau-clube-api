-- ---------------------------------------------------------------------
-- 1) ENUM PaymentChannel (Fase 4 - Float)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'PaymentChannel' AND n.nspname = 'public') THEN
CREATE TYPE public."PaymentChannel" AS ENUM ('PIX','CARD','BOLETO','TRANSFER','UNKNOWN');
END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2) Payment: campos de float + canal
-- ---------------------------------------------------------------------
ALTER TABLE public."Payment"
    ADD COLUMN IF NOT EXISTS "channel" public."PaymentChannel" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "expectedSettlementAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "feeAmount" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "netAmount" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON public."Payment" ("status");
CREATE INDEX IF NOT EXISTS "Payment_paidAt_idx" ON public."Payment" ("paidAt");
CREATE INDEX IF NOT EXISTS "Payment_settledAt_idx" ON public."Payment" ("settledAt");
CREATE INDEX IF NOT EXISTS "Payment_status_paidAt_settledAt_idx"
    ON public."Payment" ("status","paidAt","settledAt");

-- ---------------------------------------------------------------------
-- 3) CashbackTransaction: eventKey + meta (idempotência)
-- ---------------------------------------------------------------------
ALTER TABLE public."CashbackTransaction"
    ADD COLUMN IF NOT EXISTS "eventKey" TEXT,
    ADD COLUMN IF NOT EXISTS "meta" JSONB;

-- Unique para eventKey (nullable é OK; Postgres permite múltiplos NULL)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='CashbackTransaction_eventKey_key'
  ) THEN
CREATE UNIQUE INDEX "CashbackTransaction_eventKey_key"
    ON public."CashbackTransaction" ("eventKey");
END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CashbackTransaction_userId_idx" ON public."CashbackTransaction" ("userId");
CREATE INDEX IF NOT EXISTS "CashbackTransaction_createdAt_idx" ON public."CashbackTransaction" ("createdAt");

-- ---------------------------------------------------------------------
-- 4) ReferralBonus: updatedAt + eventKey + competence + paymentId
--    + FKs de payer/receiver + FK opcional com Payment
-- ---------------------------------------------------------------------
ALTER TABLE public."ReferralBonus"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "eventKey" TEXT,
    ADD COLUMN IF NOT EXISTS "competenceYearMonth" TEXT,
    ADD COLUMN IF NOT EXISTS "paymentId" INTEGER;

-- Backfill updatedAt para linhas antigas (se houver)
UPDATE public."ReferralBonus"
SET "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "updatedAt" IS NULL;

-- Unique para eventKey (nullable)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='ReferralBonus_eventKey_key'
  ) THEN
CREATE UNIQUE INDEX "ReferralBonus_eventKey_key"
    ON public."ReferralBonus" ("eventKey");
END IF;
END $$;

-- Índices úteis
CREATE INDEX IF NOT EXISTS "ReferralBonus_payerId_idx" ON public."ReferralBonus" ("payerId");
CREATE INDEX IF NOT EXISTS "ReferralBonus_receiverId_idx" ON public."ReferralBonus" ("receiverId");
CREATE INDEX IF NOT EXISTS "ReferralBonus_createdAt_idx" ON public."ReferralBonus" ("createdAt");
CREATE INDEX IF NOT EXISTS "ReferralBonus_paymentStatus_idx" ON public."ReferralBonus" ("paymentStatus");
CREATE INDEX IF NOT EXISTS "ReferralBonus_competenceYearMonth_idx" ON public."ReferralBonus" ("competenceYearMonth");
CREATE INDEX IF NOT EXISTS "ReferralBonus_paymentId_idx" ON public."ReferralBonus" ("paymentId");

-- FK payerId -> User(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema='public'
      AND table_name='ReferralBonus'
      AND constraint_name='ReferralBonus_payerId_fkey'
  ) THEN
ALTER TABLE public."ReferralBonus"
    ADD CONSTRAINT "ReferralBonus_payerId_fkey"
        FOREIGN KEY ("payerId") REFERENCES public."User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
END IF;
END $$;

-- FK receiverId -> User(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema='public'
      AND table_name='ReferralBonus'
      AND constraint_name='ReferralBonus_receiverId_fkey'
  ) THEN
ALTER TABLE public."ReferralBonus"
    ADD CONSTRAINT "ReferralBonus_receiverId_fkey"
        FOREIGN KEY ("receiverId") REFERENCES public."User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
END IF;
END $$;

-- FK paymentId -> Payment(id) (opcional)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema='public'
      AND table_name='ReferralBonus'
      AND constraint_name='ReferralBonus_paymentId_fkey'
  ) THEN
ALTER TABLE public."ReferralBonus"
    ADD CONSTRAINT "ReferralBonus_paymentId_fkey"
        FOREIGN KEY ("paymentId") REFERENCES public."Payment"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
END IF;
END $$;
