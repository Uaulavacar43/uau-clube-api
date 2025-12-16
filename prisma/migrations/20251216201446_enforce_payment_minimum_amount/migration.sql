/*
  Warnings:

  - A unique constraint covering the columns `[paymentIdAsaas]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[subscriptionIdAsaas]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - Made the column `eventKey` on table `ReferralBonus` required. This step will fail if there are existing NULL values in that column.

*/

-- ---------------------------------------------------------------------
-- 1) Hardening: garantir que ReferralBonus.eventKey não tenha NULL
--    (antes do SET NOT NULL)
-- ---------------------------------------------------------------------
UPDATE "public"."ReferralBonus"
SET "eventKey" = CONCAT('legacy-', "id")
WHERE "eventKey" IS NULL;

-- ---------------------------------------------------------------------
-- 2) AlterTable: ajustes no ReferralBonus
-- ---------------------------------------------------------------------
ALTER TABLE "public"."ReferralBonus"
    ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "eventKey" SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3) Guard rails: abortar com erro claro se houver duplicidades
--    (evita falhar “no meio” na hora de criar os unique indexes)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."Payment"
    WHERE "paymentIdAsaas" IS NOT NULL
    GROUP BY "paymentIdAsaas"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration aborted: duplicates found in Payment.paymentIdAsaas. Please deduplicate before applying unique index.';
END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."Subscription"
    WHERE "subscriptionIdAsaas" IS NOT NULL
    GROUP BY "subscriptionIdAsaas"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration aborted: duplicates found in Subscription.subscriptionIdAsaas. Please deduplicate before applying unique index.';
END IF;

  -- (Opcional) Se você quiser ser ainda mais rigoroso:
  -- IF EXISTS (SELECT 1 FROM "public"."Payment" WHERE "amount" <= 0) THEN
  --   RAISE EXCEPTION 'Migration aborted: invalid rows found in Payment.amount <= 0.';
  -- END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4) Constraint: impedir Payment.amount <= 0 (regra de negócio)
--    - NOT VALID: cria a constraint sem validar a tabela inteira de imediato
--    - VALIDATE: valida em seguida (falha se encontrar dados inválidos)
-- ---------------------------------------------------------------------
ALTER TABLE "public"."Payment"
    ADD CONSTRAINT "Payment_amount_gt_zero_check"
        CHECK ("amount" > 0) NOT VALID;

ALTER TABLE "public"."Payment"
    VALIDATE CONSTRAINT "Payment_amount_gt_zero_check";

-- ---------------------------------------------------------------------
-- 5) Indexes
-- ---------------------------------------------------------------------

-- CreateIndex
CREATE INDEX "Car_plate_idx" ON "public"."Car"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentIdAsaas_key"
    ON "public"."Payment"("paymentIdAsaas");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "public"."Payment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionIdAsaas_key"
    ON "public"."Subscription"("subscriptionIdAsaas");

-- CreateIndex
CREATE INDEX "Subscription_installmentIdAsaas_idx"
    ON "public"."Subscription"("installmentIdAsaas");
