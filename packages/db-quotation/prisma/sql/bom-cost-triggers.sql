-- BOM / FullItem cost triggers: cleanup half of `db:triggers`.
-- Run: pnpm --filter @gmd/db-quotation db:triggers   (rerun after `prisma migrate reset`)
--
-- Drops every cost trigger and leftover trigger function, including older hand-written ones.
-- `db:triggers` then reinstalls the current rules from
-- prisma/migrations/20261011130000_rebuild_bom_cost_triggers/migration.sql, the single source
-- of truth for the trigger logic.

-- ---------------------------------------------------------------- cleanup
-- Drop every user trigger on the cost tables (including any older hand-written ones).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, c.relname
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal
      AND c.relnamespace = current_schema()::regnamespace
      AND c.relname IN ('RawMaterial', 'FullItem', 'Bom', 'BomItem')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t.tgname, t.relname);
  END LOOP;
END $$;

-- Drop trigger functions in this schema that no trigger uses anymore (leftovers from older versions).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = current_schema()::regnamespace
      AND p.prorettype = 'trigger'::regtype
      AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgfoid = p.oid)
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', f.sig);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS recalc_bom(text);
DROP FUNCTION IF EXISTS recalc_full_item(text);
