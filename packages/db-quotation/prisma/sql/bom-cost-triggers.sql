-- BOM / FullItem cost triggers. Re-runnable: drops everything first, then reinstalls.
-- Run: pnpm --filter @gmd/db-quotation db:triggers   (rerun after `prisma migrate reset`)
--
-- Rules:
--   BOM cost      = SUM(RawMaterial.cost of every RM component) + SUM(FullItem.cost of every FullItem component),
--                   quantity ignored. NULL unless every majorMarking='true' RM in the BOM has a cost.
--                   Stored on every "BomItem".cost row of that BOM ("Bom"."bomCost" is deprecated, untouched).
--   FullItem cost = MAX of its BOM costs. FullItems with no BOMs keep their own cost.
-- Changes ripple upward: RM cost -> BOM -> FullItem -> parent BOMs (via the FullItem trigger) -> ...
--
-- Every identifier is double-quoted and every function pins search_path, so the triggers resolve
-- tables no matter which client/session fires them.

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

-- ---------------------------------------------------------------- functions
CREATE FUNCTION recalc_full_item(p_full_item_id text) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v numeric;
BEGIN
  IF p_full_item_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM "Bom" WHERE "fullItemId" = p_full_item_id) THEN
    RETURN;
  END IF;

  SELECT MAX(bi."cost") INTO v
  FROM "Bom" b JOIN "BomItem" bi ON bi."bomId" = b."id"
  WHERE b."fullItemId" = p_full_item_id;

  -- Fires trg_full_item_cost when the value changes, which recalcs parent BOMs.
  UPDATE "FullItem" SET "cost" = v
  WHERE "id" = p_full_item_id AND "cost" IS DISTINCT FROM v;
END $$;

CREATE FUNCTION recalc_bom(p_bom_id text) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v numeric;
BEGIN
  -- Each nesting level adds trigger depth; a cyclic BOM would recurse forever.
  IF pg_trigger_depth() > 50 THEN
    RAISE EXCEPTION 'BOM cost recursion too deep at Bom % (cyclic BOM?)', p_bom_id;
  END IF;

  SELECT CASE
           WHEN bool_and(rm."id" IS NULL
                         OR lower(trim(coalesce(rm."majorMarking", ''))) <> 'true'
                         OR rm."cost" IS NOT NULL)
           THEN SUM(coalesce(rm."cost", fi."cost", 0))
         END
  INTO v
  FROM "BomItem" bi
  LEFT JOIN "RawMaterial" rm ON rm."id" = bi."rawMaterialId"
  LEFT JOIN "FullItem" fi ON fi."id" = bi."fullItemId"
  WHERE bi."bomId" = p_bom_id;

  UPDATE "BomItem" SET "cost" = v
  WHERE "bomId" = p_bom_id AND "cost" IS DISTINCT FROM v;

  PERFORM recalc_full_item((SELECT "fullItemId" FROM "Bom" WHERE "id" = p_bom_id));
END $$;

-- ---------------------------------------------------------------- trigger functions
CREATE FUNCTION trg_raw_material_cost() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM recalc_bom(x."bomId")
  FROM (SELECT DISTINCT "bomId" FROM "BomItem" WHERE "rawMaterialId" = NEW."id") x;
  RETURN NULL;
END $$;

CREATE FUNCTION trg_full_item_cost() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM recalc_bom(x."bomId")
  FROM (SELECT DISTINCT "bomId" FROM "BomItem" WHERE "fullItemId" = NEW."id") x;
  RETURN NULL;
END $$;

CREATE FUNCTION trg_bom_item_change() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM recalc_bom(OLD."bomId"); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."bomId" IS DISTINCT FROM OLD."bomId") THEN
    PERFORM recalc_bom(NEW."bomId");
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION trg_bom_owner_change() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM recalc_full_item(OLD."fullItemId");
  IF TG_OP = 'UPDATE' THEN PERFORM recalc_full_item(NEW."fullItemId"); END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------- triggers
CREATE TRIGGER trg_raw_material_cost
AFTER UPDATE OF "cost", "majorMarking" ON "RawMaterial"
FOR EACH ROW
WHEN (OLD."cost" IS DISTINCT FROM NEW."cost" OR OLD."majorMarking" IS DISTINCT FROM NEW."majorMarking")
EXECUTE FUNCTION trg_raw_material_cost();

CREATE TRIGGER trg_full_item_cost
AFTER UPDATE OF "cost" ON "FullItem"
FOR EACH ROW
WHEN (OLD."cost" IS DISTINCT FROM NEW."cost")
EXECUTE FUNCTION trg_full_item_cost();

-- Not on "cost": recalc_bom writes that column itself.
CREATE TRIGGER trg_bom_item_change
AFTER INSERT OR DELETE OR UPDATE OF "bomId", "rawMaterialId", "fullItemId" ON "BomItem"
FOR EACH ROW
EXECUTE FUNCTION trg_bom_item_change();

CREATE TRIGGER trg_bom_owner_change
AFTER DELETE OR UPDATE OF "fullItemId" ON "Bom"
FOR EACH ROW
EXECUTE FUNCTION trg_bom_owner_change();

-- ---------------------------------------------------------------- backfill
SELECT recalc_bom("id") FROM "Bom";
