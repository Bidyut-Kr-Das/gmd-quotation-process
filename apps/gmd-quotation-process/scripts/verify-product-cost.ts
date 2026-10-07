import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchBomRows, buildRmCostMap, DIRECT_M2M } from "../lib/gmdBomCostLookup";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

function round10(v: number): number {
  return Math.round(v * 10) / 10;
}

async function main() {
  console.log("\n=== VERIFY PRODUCT COST FOR ITEMS WITH ITEMCODE ===\n");
  const tolerance = 0.01;

  // 1. Load lookup tables once
  const [extRows, bypassRows, ptRows, inspRows, pbgRows, transRows] = await Promise.all([
    prisma.extensionCost.findMany(),
    prisma.bypassCost.findMany(),
    prisma.paymentTermsCost.findMany(),
    prisma.inspectionCost.findMany(),
    prisma.pbgCost.findMany(),
    prisma.transportationCost.findMany(),
  ]);
  const extMap = new Map(extRows.map((r) => [r.length, parseFloat(r.cost) || 0]));
  const bypassMap = new Map(bypassRows.map((r) => [r.size, parseFloat(r.cost) || 0]));
  const ptMap = new Map(ptRows.map((r) => [r.terms, parseFloat(r.costPct.replace(/%/g, "")) / 100 || 0]));
  const inspMap = new Map(inspRows.map((r) => [r.type, parseFloat(r.costPct.replace(/%/g, "")) / 100 || 0]));
  const pbgMap = new Map(pbgRows.map((r) => [r.pbg, parseFloat(r.costPct.replace(/%/g, "")) / 100 || 0]));
  const transMap = new Map(transRows.map((r) => [r.state, { full: parseFloat(r.fullLoad.replace(/%/g, "")) / 100 || 0, part: parseFloat(r.partLoad.replace(/%/g, "")) / 100 || 0 }]));

  function computeExpectedCost(productCost: number, extension: string | null, bypass: string | null, enquiry: { paymentTerms: string | null; inspection: string | null; pbg: string | null; state: string | null }): number | null {
    if (productCost === null || productCost <= 0) return null;
    let extCost = 0;
    if (extension && extension !== "-") extCost = extMap.get(extension) ?? 0;
    let bpCost = 0;
    if (bypass && bypass !== "-") bpCost = bypassMap.get(bypass) ?? 0;
    let ptPct = 0;
    if (enquiry.paymentTerms && enquiry.paymentTerms !== "-") ptPct = ptMap.get(enquiry.paymentTerms) ?? 0;
    let inspPct = 0;
    if (enquiry.inspection && enquiry.inspection !== "-") inspPct = inspMap.get(enquiry.inspection) ?? 0;
    let pbgPct = 0;
    if (enquiry.pbg && enquiry.pbg !== "-") pbgPct = pbgMap.get(enquiry.pbg) ?? 0;
    let transPct = 0;
    if (enquiry.state && enquiry.state !== "-") {
      const m = transMap.get(enquiry.state);
      if (m) {
        const isFull = productCost >= 5000000;
        transPct = isFull ? m.full : m.part;
      }
    }
    const pctSum = ptPct + inspPct + pbgPct + transPct;
    const base = productCost * 1.08;
    const cost = base + extCost + bpCost + base * pctSum;
    return parseFloat(cost.toFixed(2));
  }

  // 2. Fetch items with itemcode
  const items = await prisma.enquiryItem.findMany({
    where: { erpItemCode: { not: null } },
    include: { enquiry: { select: { docketNumber: true, partyName: true, state: true, paymentTerms: true, inspection: true, pbg: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${items.length} EnquiryItems with erpItemCode != null`);

  if (items.length === 0) {
    console.log("Nothing to verify — no items have itemCode yet.");
    await prisma.$disconnect();
    return;
  }

  // 3. Fetch BOM rows (DIRECT M2M) — try sheet, fallback to verifyBom table
  let bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
  let bomSource = "sheet";
  try {
    const bomRows = await fetchBomRows();
    console.log(`[BOM] Sheet DIRECT M2M rows: ${bomRows.length}`);
    for (const r of bomRows) bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
  } catch (e: any) {
    console.warn(`[BOM] fetchBomRows failed (${e.message}), falling back to prisma.verifyBom`);
    bomSource = "verifyBom-fallback";
    const vb = await prisma.verifyBom.findMany({ select: { itemCode: true, bomId: true, rmItemCode: true } });
    for (const r of vb) {
      if (!bomMap.has(r.itemCode)) bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
    }
    console.log(`[BOM] Fallback verifyBom distinct itemCodes: ${bomMap.size}`);
  }

  const rmCodes = [...new Set([...bomMap.values()].map((v) => v.rmItemCode))];
  console.log(`Distinct RM codes from BOM: ${rmCodes.length} (source=${bomSource})`);

  let costMap = new Map<string, number>();
  try {
    costMap = await buildRmCostMap(rmCodes);
    console.log(`RM codes with computable latest cost: ${costMap.size}`);
  } catch (e: any) {
    console.warn(`buildRmCostMap failed: ${e.message}`);
  }

  // 4. Verify each item
  let cntNoBom = 0;
  let cntNoRmCost = 0;
  let cntProductMatch = 0;
  let cntProductMismatch = 0;
  let cntProductNullBoth = 0;
  let cntProductUnexpectedFilled = 0;
  let cntCostMatch = 0;
  let cntCostMismatch = 0;
  let cntCostNull = 0;

  const rowsForCsv: any[] = [];
  const mismatches: any[] = [];

  for (const it of items) {
    const erp = it.erpItemCode!;
    const actualProductCost = it.productCost ? parseFloat(String(it.productCost)) : null;
    const actualCost = it.cost ? parseFloat(String(it.cost)) : null;
    const bom = bomMap.get(erp);
    let expectedProductCost: number | null | undefined = undefined;
    let productStatus = "";
    if (!bom) {
      cntNoBom++;
      productStatus = "NO_BOM_FOR_CODE";
      // If no BOM, expected productCost comparison is N/A — gate says code shouldn't have been populated, flag stale
      if (actualProductCost !== null) productStatus += "|STALE_GATE";
    } else {
      const expected = costMap.get(bom.rmItemCode);
      expectedProductCost = expected ?? null;
      if (expectedProductCost === null && actualProductCost === null) {
        cntProductNullBoth++;
        productStatus = "NULL_BOTH";
      } else if (expectedProductCost === null && actualProductCost !== null) {
        // Has BOM but no RM cost in supply history — actual should ideally be null but may be manually set
        cntProductUnexpectedFilled++;
        productStatus = "UNEXPECTED_FILLED";
      } else if (expectedProductCost !== null && actualProductCost === null) {
        cntProductMismatch++;
        productStatus = "MISSING_ACTUAL";
        mismatches.push(it);
      } else if (expectedProductCost !== null && actualProductCost !== null) {
        const diff = Math.abs(expectedProductCost - actualProductCost);
        if (diff <= tolerance) {
          cntProductMatch++;
          productStatus = "MATCH";
        } else {
          cntProductMismatch++;
          productStatus = `MISMATCH diff=${diff.toFixed(2)}`;
          mismatches.push(it);
        }
      } else {
        // both null handled
      }
      if (expectedProductCost === undefined) expectedProductCost = null;
      if (costMap.get(bom.rmItemCode) === undefined && actualProductCost !== null) {
        cntNoRmCost++;
      }
    }

    // Verify cost (derived)
    let costStatus = "";
    let expectedCost: number | null = null;
    if (actualProductCost !== null && actualProductCost > 0) {
      expectedCost = computeExpectedCost(
        actualProductCost,
        it.extension,
        it.bypass,
        { paymentTerms: it.enquiry.paymentTerms, inspection: it.enquiry.inspection, pbg: it.enquiry.pbg, state: it.enquiry.state }
      );
      if (expectedCost === null && actualCost === null) {
        cntCostNull++;
        costStatus = "NULL_BOTH";
      } else if (expectedCost !== null && actualCost !== null) {
        const diff = Math.abs(expectedCost - actualCost);
        if (diff <= tolerance) {
          cntCostMatch++;
          costStatus = "MATCH";
        } else {
          cntCostMismatch++;
          costStatus = `MISMATCH diff=${diff.toFixed(2)}`;
        }
      } else if (expectedCost !== null && actualCost === null) {
        cntCostMismatch++;
        costStatus = "MISSING_ACTUAL_COST";
      } else {
        cntCostNull++;
        costStatus = "EXPECTED_NULL";
      }
    } else {
      cntCostNull++;
      costStatus = actualCost === null ? "NULL_BOTH" : "PRODUCT_NULL_BUT_COST_EXISTS";
      if (actualCost !== null) cntCostMismatch++;
    }

    // QuotedRate check (warning)
    let qrStatus = "";
    if (actualCost !== null && actualCost > 0) {
      const vaNum = it.vaPercent ? parseFloat(String(it.vaPercent)) : null;
      const qrNum = it.quotedRate ? parseFloat(String(it.quotedRate)) : null;
      if (vaNum !== null && qrNum !== null) {
        const expectedQr = round10(actualCost * (1 + vaNum / 100));
        if (Math.abs(expectedQr - qrNum) > 0.6) qrStatus = `QR_MISMATCH exp~${expectedQr}`;
        else qrStatus = "QR_OK";
      } else qrStatus = "QR_NA";
    }

    const rmInfo = bom ? bom.rmItemCode : "";
    const expectedProdStr = expectedProductCost !== undefined ? (expectedProductCost === null ? "" : String(expectedProductCost)) : "";

    rowsForCsv.push({
      id: it.id,
      docket: it.enquiry.docketNumber,
      party: it.enquiry.partyName,
      itemName: it.itemName,
      erpItemCode: erp,
      rmItemCode: rmInfo,
      productCostActual: actualProductCost ?? "",
      productCostExpected: expectedProdStr,
      productStatus,
      costActual: actualCost ?? "",
      costExpected: expectedCost ?? "",
      costStatus,
      qrStatus,
      vaPercent: it.vaPercent ?? "",
      quotedRate: it.quotedRate ?? "",
    });

    // Verbose for mismatches
    if (productStatus.includes("MISMATCH") || costStatus.includes("MISMATCH") || productStatus.includes("STALE_GATE")) {
      console.log(`- ${it.enquiry.docketNumber} | ${it.itemName.substring(0, 50)} | code=${erp} rm=${rmInfo} | prod act=${actualProductCost} exp=${expectedProductCost} [${productStatus}] | cost act=${actualCost} exp=${expectedCost} [${costStatus}] ${qrStatus}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total with itemCode:           ${items.length}`);
  console.log(`  NO_BOM_FOR_CODE (stale gate): ${cntNoBom}`);
  console.log(`  RM no cost in supply:         ${cntNoRmCost}`);
  console.log(`ProductCost: MATCH ${cntProductMatch}, MISMATCH ${cntProductMismatch}, NULL_BOTH ${cntProductNullBoth}, UNEXPECTED_FILLED ${cntProductUnexpectedFilled}`);
  console.log(`Cost (derived): MATCH ${cntCostMatch}, MISMATCH ${cntCostMismatch}, NULL/NA ${cntCostNull}`);
  console.log(`Mismatched items listed above: ${mismatches.length}`);

  // Write CSV
  try {
    const fs = await import("fs");
    const path = await import("path");
    const outDir = path.resolve(process.cwd(), "tmp");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const headers = Object.keys(rowsForCsv[0] || {});
    const csv = [headers.join(","), ...rowsForCsv.map((r) => headers.map((h) => `"${String((r as any)[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const outPath = path.join(outDir, "verify-product-cost.csv");
    fs.writeFileSync(outPath, csv, "utf-8");
    console.log(`\nCSV written to ${outPath} (${rowsForCsv.length} rows)`);
  } catch (e) {
    console.warn("Failed to write CSV:", e);
  }

  await prisma.$disconnect();
  if (cntProductMismatch > 0 || cntCostMismatch > 0) {
    console.log("\nResult: MISMATCHES FOUND — review table above.");
  } else {
    console.log("\nResult: All checked productCost/cost values MATCH within tolerance.");
  }
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
