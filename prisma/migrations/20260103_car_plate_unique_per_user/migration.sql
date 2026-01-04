-- remove índice único global por placa (ativo)
DROP INDEX IF EXISTS "public"."Car_plate_unique_active";

-- (se existir algum outro UNIQUE por plate)
DROP INDEX IF EXISTS "public"."Car_plate_key";
DROP INDEX IF EXISTS "public"."Car_licensePlate_key";

-- garante unicidade por usuário
ALTER TABLE "public"."Car"
DROP CONSTRAINT IF EXISTS "Car_licensePlate_userId_key";

ALTER TABLE "public"."Car"
    ADD CONSTRAINT "Car_licensePlate_userId_key"
        UNIQUE ("plate", "userId");
