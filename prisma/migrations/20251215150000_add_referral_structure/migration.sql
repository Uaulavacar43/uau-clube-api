-- 1) Enum ReferralSource (se ainda não existir)
DO $$
BEGIN
  CREATE TYPE public."ReferralSource" AS ENUM ('LINK','COUPON','LANDING','UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Coluna referralCode no User (nullable nesta fase)
ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS "referralCode" TEXT;

-- 3) Index/Unique do referralCode (Postgres permite múltiplos NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key"
  ON public."User"("referralCode");

-- 4) Garantir index do referrerId (se o schema já pede @@index([referrerId]))
CREATE INDEX IF NOT EXISTS "User_referrerId_idx"
  ON public."User"("referrerId");

-- 5) Tabela de auditoria da indicação: UserReferral
CREATE TABLE IF NOT EXISTS public."UserReferral" (
  "id" SERIAL PRIMARY KEY,
  "referrerId" INTEGER NOT NULL,
  "referredId" INTEGER NOT NULL,
  "source" public."ReferralSource" NOT NULL DEFAULT 'UNKNOWN',
  "deviceId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6) referredId único (1 usuário só pode ser indicado uma vez)
DO $$
BEGIN
  ALTER TABLE public."UserReferral"
    ADD CONSTRAINT "UserReferral_referredId_key" UNIQUE ("referredId");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 7) FKs (auditoria: não deletar hard; usamos RESTRICT)
DO $$
BEGIN
  ALTER TABLE public."UserReferral"
    ADD CONSTRAINT "UserReferral_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public."UserReferral"
    ADD CONSTRAINT "UserReferral_referredId_fkey"
    FOREIGN KEY ("referredId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 8) Índices úteis
CREATE INDEX IF NOT EXISTS "UserReferral_referrerId_idx"
  ON public."UserReferral"("referrerId");

CREATE INDEX IF NOT EXISTS "UserReferral_createdAt_idx"
  ON public."UserReferral"("createdAt");
