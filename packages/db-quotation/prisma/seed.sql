-- ============================================================
-- DROP OLD TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS raw_material_bom_item_cost_trigger
ON "RawMaterial";

DROP TRIGGER IF EXISTS full_item_bom_item_cost_trigger
ON "FullItem";

DROP TRIGGER IF EXISTS bom_item_cost_trigger
ON "BomItem";

DROP TRIGGER IF EXISTS full_item_cost_from_bom_trigger
ON "BomItem";


-- ============================================================
-- DROP OLD FUNCTIONS
-- ============================================================

DROP FUNCTION IF EXISTS trigger_update_bom_items_from_raw_material();

DROP FUNCTION IF EXISTS trigger_update_bom_items_from_full_item();

DROP FUNCTION IF EXISTS trigger_update_bom_item_cost();

DROP FUNCTION IF EXISTS trigger_update_full_item_cost_from_bom();

DROP FUNCTION IF EXISTS recalculate_bom_item_costs(TEXT);

DROP FUNCTION IF EXISTS recalculate_full_item_cost(TEXT);


-- ============================================================
-- 1. RECALCULATE ALL BOM ITEM COSTS FOR A BOM
-- ============================================================
--
-- The cost of a BOM is the sum of all its components:
-- RawMaterial.cost for raw-material components and FullItem.cost
-- for sub-assembly components. That BOM total is written onto
-- every BomItem of the BOM, so any row of a BOM carries the same
-- BOM cost and FullItem.cost can be the highest of them (section 2).
--
-- Gate: the sum is only calculated and written when EVERY
-- raw-material component of the BOM has majorMarking = 'true'.
-- If any of them is not 'true', BomItem.cost is left untouched.
--
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_bom_item_costs(
    p_bom_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_bom_cost DECIMAL;
BEGIN

    -- Only roll up when every raw-material component is marked major.
    IF EXISTS (
        SELECT 1
        FROM "BomItem" b
        JOIN "RawMaterial" rm
            ON rm.id = b."rawMaterialId"
        WHERE b."bomId" = p_bom_id
          AND LOWER(COALESCE(rm."majorMarking", '')) <> 'true'
    ) THEN
        RETURN;
    END IF;


    SELECT SUM(
               CASE
                   WHEN b."rawMaterialId" IS NOT NULL
                       THEN rm.cost

                   WHEN b."fullItemId" IS NOT NULL
                       THEN fi.cost

                   ELSE NULL
               END
           )
    INTO v_bom_cost
    FROM "BomItem" b
    LEFT JOIN "RawMaterial" rm
        ON rm.id = b."rawMaterialId"
    LEFT JOIN "FullItem" fi
        ON fi.id = b."fullItemId"
    WHERE b."bomId" = p_bom_id;


    UPDATE "BomItem" bi
    SET cost = v_bom_cost
    WHERE bi."bomId" = p_bom_id
      AND bi.cost IS DISTINCT FROM v_bom_cost;

END;
$$;


-- ============================================================
-- 2. RECALCULATE FULL ITEM COST FROM ITS BOMS
-- ============================================================
--
-- FullItem.cost = highest BomItem.cost across all BOMs
-- belonging to that FullItem.
--
-- If the FullItem has no BOMs, nothing is changed.
--
-- If BOMs exist but all BomItem.cost values are NULL,
-- FullItem.cost becomes NULL.
--
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_full_item_cost(
    p_full_item_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_max_cost DECIMAL;
    v_has_bom BOOLEAN;
BEGIN

    SELECT EXISTS (
        SELECT 1
        FROM "Bom"
        WHERE "fullItemId" = p_full_item_id
    )
    INTO v_has_bom;


    -- Only derive cost when the FullItem actually has a BOM.
    IF NOT v_has_bom THEN
        RETURN;
    END IF;


    SELECT MAX(bi.cost)
    INTO v_max_cost
    FROM "Bom" b
    JOIN "BomItem" bi
        ON bi."bomId" = b.id
    WHERE b."fullItemId" = p_full_item_id;


    -- Prevent unnecessary UPDATEs and trigger recursion.
    UPDATE "FullItem"
    SET cost = v_max_cost
    WHERE id = p_full_item_id
      AND cost IS DISTINCT FROM v_max_cost;

END;
$$;


-- ============================================================
-- 3. RAW MATERIAL -> BOM COST
-- ============================================================
--
-- When RawMaterial.cost or majorMarking changes, every BOM that
-- uses this RawMaterial is recalculated, so its BOM total picks
-- up the new component cost.
--
-- majorMarking is included because the previous business logic
-- treats it as relevant to the BOM component.
--
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_update_bom_items_from_raw_material()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_bom_id TEXT;
BEGIN

    FOR v_bom_id IN
        SELECT DISTINCT bi."bomId"
        FROM "BomItem" bi
        WHERE bi."rawMaterialId" = NEW.id
    LOOP
        PERFORM recalculate_bom_item_costs(v_bom_id);
    END LOOP;

    RETURN NEW;

END;
$$;


CREATE TRIGGER raw_material_bom_item_cost_trigger
AFTER UPDATE OF cost, "majorMarking"
ON "RawMaterial"
FOR EACH ROW
EXECUTE FUNCTION trigger_update_bom_items_from_raw_material();


-- ============================================================
-- 4. FULL ITEM -> BOM COST
-- ============================================================
--
-- When FullItem.cost changes, every BOM that uses this FullItem
-- as a component is recalculated, so its BOM total picks up the
-- new component cost.
--
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_update_bom_items_from_full_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_bom_id TEXT;
BEGIN

    FOR v_bom_id IN
        SELECT DISTINCT bi."bomId"
        FROM "BomItem" bi
        WHERE bi."fullItemId" = NEW.id
    LOOP
        PERFORM recalculate_bom_item_costs(v_bom_id);
    END LOOP;

    RETURN NEW;

END;
$$;


CREATE TRIGGER full_item_bom_item_cost_trigger
AFTER UPDATE OF cost
ON "FullItem"
FOR EACH ROW
EXECUTE FUNCTION trigger_update_bom_items_from_full_item();


-- ============================================================
-- 5. BOM ITEM CHANGE -> UPDATE BOM COST
-- ============================================================
--
-- Handles:
--
-- INSERT
-- DELETE
-- UPDATE bomId
-- UPDATE rawMaterialId
-- UPDATE fullItemId
--
-- After a BomItem relationship changes, the owning BOM's total
-- cost is recomputed and written to all of its BomItems.
--
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_update_bom_item_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    -- DELETE
    IF TG_OP = 'DELETE' THEN

        PERFORM recalculate_bom_item_costs(OLD."bomId");

        PERFORM recalculate_full_item_cost(
            (
                SELECT b."fullItemId"
                FROM "Bom" b
                WHERE b.id = OLD."bomId"
            )
        );

        RETURN OLD;
    END IF;


    -- INSERT / UPDATE

    PERFORM recalculate_bom_item_costs(NEW."bomId");

    PERFORM recalculate_full_item_cost(
        (
            SELECT b."fullItemId"
            FROM "Bom" b
            WHERE b.id = NEW."bomId"
        )
    );


    -- If the BomItem was moved from one BOM to another,
    -- the old BOM's total and its FullItem also need recalculation.
    IF TG_OP = 'UPDATE'
       AND OLD."bomId" IS DISTINCT FROM NEW."bomId"
    THEN

        PERFORM recalculate_bom_item_costs(OLD."bomId");

        PERFORM recalculate_full_item_cost(
            (
                SELECT b."fullItemId"
                FROM "Bom" b
                WHERE b.id = OLD."bomId"
            )
        );

    END IF;


    RETURN NEW;

END;
$$;


CREATE TRIGGER bom_item_cost_trigger
AFTER INSERT
    OR DELETE
    OR UPDATE OF "bomId", "rawMaterialId", "fullItemId"
ON "BomItem"
FOR EACH ROW
EXECUTE FUNCTION trigger_update_bom_item_cost();


-- ============================================================
-- 6. BOM ITEM COST CHANGE -> UPDATE PARENT FULL ITEM
-- ============================================================
--
-- This is separate because RawMaterial/FullItem changes can
-- cause BomItem.cost to change.
--
-- Whenever BomItem.cost changes, find the FullItem that owns
-- its BOM and recalculate that FullItem's cost.
--
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_update_full_item_cost_from_bom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_full_item_id TEXT;
    v_old_full_item_id TEXT;
BEGIN

    -- New/current BOM owner
    IF TG_OP <> 'DELETE' THEN

        SELECT b."fullItemId"
        INTO v_full_item_id
        FROM "Bom" b
        WHERE b.id = NEW."bomId";

        IF v_full_item_id IS NOT NULL THEN
            PERFORM recalculate_full_item_cost(v_full_item_id);
        END IF;

    END IF;


    -- Old BOM owner
    --
    -- Needed when a BomItem is deleted or moved between BOMs.

    IF TG_OP = 'DELETE'
       OR (
           TG_OP = 'UPDATE'
           AND OLD."bomId" IS DISTINCT FROM NEW."bomId"
       )
    THEN

        SELECT b."fullItemId"
        INTO v_old_full_item_id
        FROM "Bom" b
        WHERE b.id = OLD."bomId";

        IF v_old_full_item_id IS NOT NULL
           AND v_old_full_item_id IS DISTINCT FROM v_full_item_id
        THEN
            PERFORM recalculate_full_item_cost(v_old_full_item_id);
        END IF;

    END IF;


    RETURN COALESCE(NEW, OLD);

END;
$$;


CREATE TRIGGER full_item_cost_from_bom_trigger
AFTER INSERT
    OR DELETE
    OR UPDATE OF cost, "bomId"
ON "BomItem"
FOR EACH ROW
EXECUTE FUNCTION trigger_update_full_item_cost_from_bom();

