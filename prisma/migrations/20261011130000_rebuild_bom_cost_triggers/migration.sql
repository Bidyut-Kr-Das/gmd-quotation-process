-- Rebuild the BOM cost triggers.
--
-- The triggers and functions below were created directly in the database and
-- were never part of a migration. One of them, recalculate_bom_cost(), joined
-- "FullItem" to the UPDATE target inside FROM, which Postgres rejects, so every
-- BomItem insert/update/delete and every cost change on a RawMaterial or
-- FullItem used in a BOM failed.
--
-- This drops all of them and recreates the same rules in one place:
--
--   1. BomItem.cost
--        - BOM has a raw material whose majorMarking is not 'true':
--            each item gets the cost of its own component.
--        - otherwise: every item gets the BOM total (sum of component costs).
--   2. FullItem.cost = highest BomItem.cost across the BOMs it owns.
--
-- One deliberate change: a full item listed as a component of its own BOM is
-- left out of rule 1's total and of rule 2. Before, such a BOM with other
-- components fed its own total back into itself and recursed without end.
--
-- The previous definitions are kept in prisma/bom_cost_triggers_previous.sql.

-- Old triggers
DROP TRIGGER IF EXISTS bom_item_bom_cost_trigger ON "BomItem";
DROP TRIGGER IF EXISTS bom_item_cost_trigger ON "BomItem";
DROP TRIGGER IF EXISTS full_item_cost_from_bom_trigger ON "BomItem";
DROP TRIGGER IF EXISTS full_item_bom_cost_trigger ON "FullItem";
DROP TRIGGER IF EXISTS full_item_bom_item_cost_trigger ON "FullItem";
DROP TRIGGER IF EXISTS raw_material_bom_cost_trigger ON "RawMaterial";
DROP TRIGGER IF EXISTS raw_material_bom_item_cost_trigger ON "RawMaterial";
-- New trigger whose name is not in the list above (keeps this file re-runnable)
DROP TRIGGER IF EXISTS bom_item_full_item_cost_trigger ON "BomItem";

-- Old functions
DROP FUNCTION IF EXISTS trigger_recalculate_bom_from_bom_item();
DROP FUNCTION IF EXISTS trigger_update_bom_item_cost();
DROP FUNCTION IF EXISTS trigger_update_full_item_cost_from_bom();
DROP FUNCTION IF EXISTS trigger_recalculate_boms_for_full_item();
DROP FUNCTION IF EXISTS trigger_update_bom_items_from_full_item();
DROP FUNCTION IF EXISTS trigger_recalculate_boms_for_raw_material();
DROP FUNCTION IF EXISTS trigger_update_bom_items_from_raw_material();
DROP FUNCTION IF EXISTS recalculate_bom_item_costs(text);
DROP FUNCTION IF EXISTS recalculate_bom_cost(text);
DROP FUNCTION IF EXISTS recalculate_full_item_cost(text);

-- Rule 1: cost of every BomItem in one BOM.
CREATE OR REPLACE FUNCTION recalculate_bom_cost(p_bom_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_total DECIMAL;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "BomItem" b
        JOIN "RawMaterial" rm ON rm.id = b."rawMaterialId"
        WHERE b."bomId" = p_bom_id
          AND LOWER(COALESCE(rm."majorMarking", '')) <> 'true'
    ) THEN
        UPDATE "BomItem" bi
        SET cost = c.own_cost
        FROM (
            SELECT b.id,
                   CASE
                       WHEN b."rawMaterialId" IS NOT NULL THEN rm.cost
                       WHEN b."fullItemId" IS NOT NULL THEN fi.cost
                       ELSE NULL
                   END AS own_cost
            FROM "BomItem" b
            LEFT JOIN "RawMaterial" rm ON rm.id = b."rawMaterialId"
            LEFT JOIN "FullItem" fi ON fi.id = b."fullItemId"
            WHERE b."bomId" = p_bom_id
        ) c
        WHERE bi.id = c.id
          AND bi.cost IS DISTINCT FROM c.own_cost;
        RETURN;
    END IF;

    SELECT SUM(
               CASE
                   WHEN b."rawMaterialId" IS NOT NULL THEN rm.cost
                   -- The BOM's own full item never counts toward its total.
                   WHEN b."fullItemId" IS DISTINCT FROM owner."fullItemId" THEN fi.cost
                   ELSE NULL
               END
           )
    INTO v_total
    FROM "BomItem" b
    JOIN "Bom" owner ON owner.id = b."bomId"
    LEFT JOIN "RawMaterial" rm ON rm.id = b."rawMaterialId"
    LEFT JOIN "FullItem" fi ON fi.id = b."fullItemId"
    WHERE b."bomId" = p_bom_id;

    UPDATE "BomItem" bi
    SET cost = v_total
    WHERE bi."bomId" = p_bom_id
      AND bi.cost IS DISTINCT FROM v_total;
END;
$function$;

-- Rule 2: cost of a FullItem from the BOMs it owns.
CREATE OR REPLACE FUNCTION recalculate_full_item_cost(p_full_item_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_max_cost DECIMAL;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "Bom" WHERE "fullItemId" = p_full_item_id) THEN
        RETURN;
    END IF;

    -- BOMs that list only the full item itself say nothing about its cost.
    IF EXISTS (
           SELECT 1
           FROM "Bom" b
           JOIN "BomItem" bi ON bi."bomId" = b.id
           WHERE b."fullItemId" = p_full_item_id
       )
       AND NOT EXISTS (
           SELECT 1
           FROM "Bom" b
           JOIN "BomItem" bi ON bi."bomId" = b.id
           WHERE b."fullItemId" = p_full_item_id
             AND bi."fullItemId" IS DISTINCT FROM p_full_item_id
       )
    THEN
        RETURN;
    END IF;

    SELECT MAX(bi.cost)
    INTO v_max_cost
    FROM "Bom" b
    JOIN "BomItem" bi ON bi."bomId" = b.id
    WHERE b."fullItemId" = p_full_item_id
      AND bi."fullItemId" IS DISTINCT FROM p_full_item_id;

    UPDATE "FullItem"
    SET cost = v_max_cost
    WHERE id = p_full_item_id
      AND cost IS DISTINCT FROM v_max_cost;
END;
$function$;

-- A BomItem was added, removed, or points at another BOM/component:
-- recalculate the BOM it is in (and the one it left).
CREATE OR REPLACE FUNCTION trigger_bom_item_recalculate_bom()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalculate_bom_cost(OLD."bomId");
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD."bomId" IS DISTINCT FROM NEW."bomId" THEN
            PERFORM recalculate_bom_cost(OLD."bomId");
        END IF;
    END IF;

    PERFORM recalculate_bom_cost(NEW."bomId");
    RETURN NEW;
END;
$function$;

-- A BomItem's cost or BOM changed: recalculate the full item that owns the BOM
-- (and the previous owner when the item was deleted or moved).
CREATE OR REPLACE FUNCTION trigger_bom_item_recalculate_full_item()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_full_item_id TEXT;
    v_old_full_item_id TEXT;
BEGIN
    IF TG_OP <> 'DELETE' THEN
        SELECT b."fullItemId" INTO v_full_item_id FROM "Bom" b WHERE b.id = NEW."bomId";
        IF v_full_item_id IS NOT NULL THEN
            PERFORM recalculate_full_item_cost(v_full_item_id);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        SELECT b."fullItemId" INTO v_old_full_item_id FROM "Bom" b WHERE b.id = OLD."bomId";
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD."bomId" IS DISTINCT FROM NEW."bomId" THEN
            SELECT b."fullItemId" INTO v_old_full_item_id FROM "Bom" b WHERE b.id = OLD."bomId";
        END IF;
    END IF;

    IF v_old_full_item_id IS NOT NULL AND v_old_full_item_id IS DISTINCT FROM v_full_item_id THEN
        PERFORM recalculate_full_item_cost(v_old_full_item_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- A RawMaterial or FullItem changed cost: recalculate every BOM that uses it
-- as a component.
CREATE OR REPLACE FUNCTION trigger_component_recalculate_boms()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_bom_id TEXT;
BEGIN
    FOR v_bom_id IN
        SELECT DISTINCT bi."bomId"
        FROM "BomItem" bi
        WHERE (TG_TABLE_NAME = 'RawMaterial' AND bi."rawMaterialId" = NEW.id)
           OR (TG_TABLE_NAME = 'FullItem' AND bi."fullItemId" = NEW.id)
    LOOP
        PERFORM recalculate_bom_cost(v_bom_id);
    END LOOP;
    RETURN NEW;
END;
$function$;

-- Triggers on one table fire in name order: bom_item_cost_trigger runs before
-- bom_item_full_item_cost_trigger, so the BOM is costed before its owner.
CREATE TRIGGER bom_item_cost_trigger
AFTER INSERT OR DELETE OR UPDATE OF "bomId", "rawMaterialId", "fullItemId" ON "BomItem"
FOR EACH ROW EXECUTE FUNCTION trigger_bom_item_recalculate_bom();

CREATE TRIGGER bom_item_full_item_cost_trigger
AFTER INSERT OR DELETE OR UPDATE OF cost, "bomId" ON "BomItem"
FOR EACH ROW EXECUTE FUNCTION trigger_bom_item_recalculate_full_item();

CREATE TRIGGER raw_material_bom_cost_trigger
AFTER UPDATE OF cost, "majorMarking" ON "RawMaterial"
FOR EACH ROW EXECUTE FUNCTION trigger_component_recalculate_boms();

CREATE TRIGGER full_item_bom_cost_trigger
AFTER UPDATE OF cost ON "FullItem"
FOR EACH ROW EXECUTE FUNCTION trigger_component_recalculate_boms();
