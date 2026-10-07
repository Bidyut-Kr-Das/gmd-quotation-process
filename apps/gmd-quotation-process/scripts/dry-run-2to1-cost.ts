import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetch2to1BomRows, buildRawMaterialsCostMap } from "../lib/gmd2to1CostLookup";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function dryRun() {
  console.log("\n==========================================================================");
  console.log("            DRY RUN: 2:1 BOM COST PROPAGATION TO QUOTATION PROCESS       ");
  console.log("==========================================================================\n");

  try {
    const bomRows = await fetch2to1BomRows();
    console.log(`[Sheet] Found ${bomRows.length} rows in 'GMD Item Creation Form' with ITEM TYPE = '2:1' and valid BOM ID.\n`);

    if (bomRows.length === 0) {
      console.log("No 2:1 BOM rows found in the sheet.");
      return;
    }

    const bomMap = new Map<string, typeof bomRows[0]>();
    for (const r of bomRows) {
      bomMap.set(r.itemCode, r);
    }

    const allRmCodes = [...new Set(bomRows.flatMap((r) => r.consumptionCodes))];
    console.log(`[BOM] Extracted ${allRmCodes.length} distinct consumption codes (excluding codes starting with 'F').`);

    const rmCostMap = await buildRawMaterialsCostMap(allRmCodes);
    console.log(`[Raw Materials Table] Found numeric costs for ${rmCostMap.size} consumption codes in GMDUpdateItem.\n`);

    // Fetch items from Quotation Process dashboard
    const enquiryItems = await prisma.enquiryItem.findMany({
      where: {
        erpItemCode: { in: [...bomMap.keys()] },
      },
      select: {
        id: true,
        erpItemCode: true,
        itemName: true,
        cost: true,
        productCost: true,
        enquiry: {
          select: { docketNumber: true },
        },
      },
    });

    console.log(`[Quotation Process Dashboard] Matched ${enquiryItems.length} enquiry items with 2:1 sheet item codes.\n`);

    const dryRunResults: Array<{
      docketNumber: string;
      itemName: string;
      itemCode: string;
      bomId: string;
      currentCost: string;
      consumptionDetails: string[];
      calculatedSumCost: number;
      status: string;
    }> = [];

    for (const item of enquiryItems) {
      const bomEntry = bomMap.get(item.erpItemCode!);
      if (!bomEntry) continue;

      const existingCostNum = item.cost ? Number(item.cost) : null;
      const isBlankOrDash = existingCostNum === null || existingCostNum <= 0;

      let sumCost = 0;
      const consumptionDetails: string[] = [];

      for (const cCode of bomEntry.consumptionCodes) {
        const costVal = rmCostMap.get(cCode);
        if (costVal !== undefined && costVal !== null) {
          sumCost += costVal;
          consumptionDetails.push(`${cCode}: ₹${costVal.toLocaleString("en-IN")}`);
        } else {
          consumptionDetails.push(`${cCode}: [No cost in RM table]`);
        }
      }

      let status = "";
      if (!isBlankOrDash) {
        status = "SKIPPED (Cost already populated)";
      } else if (sumCost > 0) {
        status = "WOULD PROPAGATE TO COST COLUMN";
      } else {
        status = "SKIPPED (No valid RM costs)";
      }

      dryRunResults.push({
        docketNumber: item.enquiry.docketNumber,
        itemName: item.itemName,
        itemCode: item.erpItemCode!,
        bomId: bomEntry.bomId || "-",
        currentCost: item.cost ? `₹${Number(item.cost).toLocaleString("en-IN")}` : "null / '-'",
        consumptionDetails,
        calculatedSumCost: sumCost,
        status,
      });
    }

    console.log("--------------------------------------------------------------------------");
    console.log("                           DRY RUN SUMMARY TABLE                          ");
    console.log("--------------------------------------------------------------------------");

    dryRunResults.forEach((res, index) => {
      console.log(`\nItem #${index + 1}:`);
      console.log(`  Docket No      : ${res.docketNumber}`);
      console.log(`  Item Name      : ${res.itemName}`);
      console.log(`  Item Code      : ${res.itemCode}`);
      console.log(`  BOM ID         : ${res.bomId}`);
      console.log(`  Current Cost   : ${res.currentCost}`);
      console.log(`  Consumption RMs: ${res.consumptionDetails.join(", ")}`);
      console.log(`  Calculated Sum : ₹${res.calculatedSumCost.toLocaleString("en-IN")}`);
      console.log(`  Action/Status  : ${res.status}`);
    });

    console.log("\n==========================================================================");
    const wouldPropagate = dryRunResults.filter((r) => r.status.includes("WOULD PROPAGATE"));
    console.log(`TOTAL ITEMS THAT WOULD GET 'COST' FILLED: ${wouldPropagate.length} out of ${dryRunResults.length} matched items.`);
    console.log("==========================================================================\n");
  } catch (err) {
    console.error("Dry run error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

dryRun();
