-- CreateTable
CREATE TABLE "PhysicalStock" (
    "id" TEXT NOT NULL,
    "erp_code" TEXT,
    "location" TEXT,
    "l2_valve_type" TEXT,
    "dimension" TEXT,
    "l7_dimension" TEXT,
    "l4_component" TEXT,
    "l5_material" TEXT,
    "l6_std" TEXT,
    "l8_item_category" TEXT,
    "received_qty" TEXT,
    "dispatch_qty" TEXT,
    "available_qty" TEXT,
    "remarks" TEXT,
    "sum_of_physical_stock" TEXT,
    "stock_as_per_erp" TEXT,
    "rate_unit" TEXT,
    "rate_per_pc_qty_weight" TEXT,
    "weight_per_pc" TEXT,
    "item_wise_value" TEXT,
    "moving_within_3_months" TEXT,
    "order_ag_approval_recvd" TEXT,
    "purchase_in_26_27" TEXT,
    "dispatched_in_26_27" TEXT,
    "order_in_hand_qty" TEXT,
    "shortage_qty" TEXT,
    "unnamed_aa" TEXT,
    "item_type" TEXT,
    "price" TEXT,
    "moq" TEXT,
    "if_less_than_moq_extra_charges" TEXT,
    "drawing_technical_data" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhysicalStock_erp_code_idx" ON "PhysicalStock"("erp_code");
