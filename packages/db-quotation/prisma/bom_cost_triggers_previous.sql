-- Trigger and function definitions that were live in the database before
-- migration 20261011130000_rebuild_bom_cost_triggers replaced them.
-- Reference and rollback only; nothing runs this file.

CREATE OR REPLACE FUNCTION public.recalculate_bom_cost(p_bom_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE "BomItem" bi
    SET cost =
        CASE
            WHEN bi."rawMaterialId" IS NOT NULL
                THEN rm.cost
            WHEN bi."fullItemId" IS NOT NULL
                THEN fi.cost
            ELSE NULL
        END
    FROM "RawMaterial" rm
    FULL OUTER JOIN "FullItem" fi
        ON fi.id = bi."fullItemId"
    WHERE bi.id IN (
        SELECT id
        FROM "BomItem"
        WHERE "bomId" = p_bom_id
    )
    AND (
        bi."rawMaterialId" = rm.id
        OR bi."fullItemId" = fi.id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_bom_item_costs(p_bom_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_full_item_cost(p_full_item_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trigger_recalculate_bom_from_bom_item()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN

    -- --------------------------------------------------------
    -- DELETE
    -- --------------------------------------------------------

    IF TG_OP = 'DELETE' THEN

        PERFORM recalculate_bom_cost(OLD."bomId");

        RETURN OLD;

    END IF;


    -- --------------------------------------------------------
    -- UPDATE
    --
    -- If the component moves from one BOM to another,
    -- recalculate both BOMs.
    -- --------------------------------------------------------

    IF TG_OP = 'UPDATE' THEN

        IF OLD."bomId" IS DISTINCT FROM NEW."bomId" THEN

            PERFORM recalculate_bom_cost(OLD."bomId");

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- INSERT / UPDATE
    --
    -- Recalculate the current BOM.
    -- --------------------------------------------------------

    PERFORM recalculate_bom_cost(NEW."bomId");

    RETURN NEW;

END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_recalculate_boms_for_full_item()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_bom_id TEXT;
BEGIN

    FOR v_bom_id IN
        SELECT DISTINCT bi."bomId"
        FROM "BomItem" bi
        WHERE bi."fullItemId" = NEW.id
    LOOP

        PERFORM recalculate_bom_cost(v_bom_id);

    END LOOP;

    RETURN NEW;

END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_recalculate_boms_for_raw_material()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_bom_id TEXT;
BEGIN

    FOR v_bom_id IN
        SELECT DISTINCT bi."bomId"
        FROM "BomItem" bi
        WHERE bi."rawMaterialId" = NEW.id
    LOOP

        PERFORM recalculate_bom_cost(v_bom_id);

    END LOOP;

    RETURN NEW;

END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_update_bom_item_cost()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trigger_update_bom_items_from_full_item()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trigger_update_bom_items_from_raw_material()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trigger_update_full_item_cost_from_bom()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE TRIGGER bom_item_bom_cost_trigger AFTER INSERT OR DELETE OR UPDATE OF "bomId", "rawMaterialId", "fullItemId" ON public."BomItem" FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_bom_from_bom_item();
CREATE TRIGGER bom_item_cost_trigger AFTER INSERT OR DELETE OR UPDATE OF "bomId", "rawMaterialId", "fullItemId" ON public."BomItem" FOR EACH ROW EXECUTE FUNCTION trigger_update_bom_item_cost();
CREATE TRIGGER full_item_cost_from_bom_trigger AFTER INSERT OR DELETE OR UPDATE OF cost, "bomId" ON public."BomItem" FOR EACH ROW EXECUTE FUNCTION trigger_update_full_item_cost_from_bom();
CREATE TRIGGER full_item_bom_cost_trigger AFTER UPDATE OF cost ON public."FullItem" FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_boms_for_full_item();
CREATE TRIGGER full_item_bom_item_cost_trigger AFTER UPDATE OF cost ON public."FullItem" FOR EACH ROW EXECUTE FUNCTION trigger_update_bom_items_from_full_item();
CREATE TRIGGER raw_material_bom_cost_trigger AFTER UPDATE OF cost, "majorMarking" ON public."RawMaterial" FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_boms_for_raw_material();
CREATE TRIGGER raw_material_bom_item_cost_trigger AFTER UPDATE OF cost, "majorMarking" ON public."RawMaterial" FOR EACH ROW EXECUTE FUNCTION trigger_update_bom_items_from_raw_material();
