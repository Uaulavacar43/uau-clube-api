-- 1) Remove UNIQUE constraints antigas relacionadas à coluna plate (se existirem)
DO $$
DECLARE
r record;
BEGIN
FOR r IN
SELECT c.conname
FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'Car'
  AND c.contype = 'u'
  AND pg_get_constraintdef(c.oid) ILIKE '%(plate)%'
  LOOP
    EXECUTE format('ALTER TABLE "public"."Car" DROP CONSTRAINT IF EXISTS %I', r.conname);
END LOOP;
END $$;

-- 2) Remove índices únicos antigos com nomes comuns (se existirem)
DROP INDEX IF EXISTS "public"."Car_plate_key";
DROP INDEX IF EXISTS "public"."Car_licensePlate_key";
DROP INDEX IF EXISTS "public"."Car_plate_unique";
DROP INDEX IF EXISTS "public"."Car_plate_unique_active";

-- 3) Cria o índice único parcial: placa só é única para carros ATIVOS (deletedAt IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "Car_plate_unique_active"
    ON "public"."Car" ("plate")
    WHERE "deletedAt" IS NULL;
