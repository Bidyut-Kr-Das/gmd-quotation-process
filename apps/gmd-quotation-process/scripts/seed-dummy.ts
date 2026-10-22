// Dev-only: fills every table with a few dummy rows for UI checks.
// Run: npx tsx scripts/seed-dummy.ts   (upserts/skipDuplicates, safe to re-run)
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";
import { prisma as tenderPrisma } from "@gmd/db-tender";

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const N = 5;
const range = (n = N) => Array.from({ length: n }, (_, i) => i + 1);
const PARTIES = ["Tata Steel Ltd", "Reliance Energy", "L&T Water", "NTPC Ltd", "Jal Nigam UP"];
const STATES = ["Maharashtra", "Gujarat", "Uttar Pradesh", "West Bengal", "Karnataka"];
const TYPES = ["BUTTERFLY VALVE", "GATE VALVE", "CHECK VALVE", "AIR VALVE", "BALL VALVE"];
const MOCS = ["CI", "DI", "CS", "SS304", "SS316"];
const SIZES = ["100", "150", "200", "250", "300"];
const PNS = ["PN10", "PN16", "PN10", "PN16", "PN25"];
const pick = <T,>(a: T[], i: number) => a[(i - 1) % a.length];

async function main() {
  const password = await bcrypt.hash("password123", 10);
  for (const [email, role] of [["admin@example.com", "admin"], ["user@example.com", "user"], ["dev@example.com", "developer"]]) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email, role, password, name: role.toUpperCase() + " Demo",
        userMemories: { create: [{ memory: `Dummy memory for ${role}` }] },
        chatSessions: { create: [{ id: `dummy-chat-${role}`, title: `Demo chat (${role})`, messages: [] }] },
      },
    });
  }

  for (const i of range()) {
    const docketNumber = `DUMMY-${1000 + i}`;
    await prisma.enquiry.upsert({
      where: { docketNumber },
      update: {},
      create: {
        docketNumber,
        partyName: pick(PARTIES, i),
        contractNo: [`CN-${2000 + i}`],
        enquiryDate: new Date(Date.UTC(2026, 8, i * 3)),
        enquiryType: i % 2 ? "Tender" : "Direct",
        state: pick(STATES, i),
        paymentTerms: "100% against delivery",
        inspection: "Third Party",
        pbg: "10%",
        utility: "Water",
        vaPercent: 10 + i,
        orderStatus: i % 2 ? "Open" : "Won",
        closureStatus: i % 3 ? "Pending" : "Closed",
        emailAddress: `buyer${i}@example.com`,
        contactNo: `98765432${10 + i}`,
        attachments: { create: [{ name: `Spec-${i}.pdf`, url: `/files/Spec-${i}.pdf`, type: "pdf", size: 12000 * i }] },
        items: {
          create: range(3).map((j) => ({
            itemName: `${pick(TYPES, i + j)} ${pick(SIZES, j)}mm ${pick(PNS, j)}`,
            quantity: 10 * j,
            itemType: pick(TYPES, i + j),
            moc: pick(MOCS, j),
            size: pick(SIZES, j),
            pnRating: pick(PNS, j),
            erpItemCode: `ITM-${i}${j}`,
            operationType: "MANUAL",
            productCost: 1000 * j,
            cost: 1100 * j,
            quotedRate: String(1300 * j),
            stockStatus: j % 2 ? "In Stock" : "Not In Stock",
            itemStatus: "Active",
            position: j,
          })),
        },
      },
    });
  }

  await prisma.gmdItemCode.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({ itemCode: `ITM-${i}1`, itemType: pick(TYPES, i), moc: pick(MOCS, i), operation: "MANUAL", size: pick(SIZES, i), pnGmd: pick(PNS, i), currentReqt: "YES" })),
  });
  await prisma.extensionCost.createMany({ skipDuplicates: true, data: range().map((i) => ({ length: `${i}m`, cost: String(500 * i) })) });
  await prisma.bypassCost.createMany({ skipDuplicates: true, data: range().map((i) => ({ size: pick(SIZES, i), cost: String(800 * i) })) });
  await prisma.paymentTermsCost.createMany({ skipDuplicates: true, data: ["Advance", "30 days", "60 days", "90 days", "LC"].map((terms, i) => ({ terms, costPct: String(i) })) });
  await prisma.inspectionCost.createMany({ skipDuplicates: true, data: ["Self", "Third Party", "Customer", "RITES", "None"].map((type, i) => ({ type, costPct: String(i * 0.5) })) });
  await prisma.pbgCost.createMany({ skipDuplicates: true, data: ["0%", "3%", "5%", "10%", "15%"].map((pbg, i) => ({ pbg, costPct: String(i) })) });
  await prisma.transportationCost.createMany({ skipDuplicates: true, data: STATES.map((state, i) => ({ state, fullLoad: String(20000 + i * 1000), partLoad: String(8000 + i * 500) })) });

  await prisma.supplyHistoryItem.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      financialYear: "2025-26", partyName: pick(PARTIES, i), erpPartyName: pick(PARTIES, i).toUpperCase(),
      itemName: `${pick(TYPES, i)} ${pick(SIZES, i)}mm`, invoiceNo: `INV-${3000 + i}`, date: `2026-0${i}-15`,
      quantity: String(5 * i), uom: "NOS", value: String(25000 * i), state: pick(STATES, i), utility: "Water",
      erpContractNo: `CN-${2000 + i}`, typeOfValve: pick(TYPES, i), sizeOfValve: pick(SIZES, i), classOfValve: pick(PNS, i), moc: pick(MOCS, i),
    })),
  });

  const gmdRow = (i: number) => ({
    erpItemCode: `RM-${100 + i}`, itemNameAuto: `${pick(MOCS, i)} BODY ${pick(SIZES, i)}`, l1: "RM", l2ValveType: pick(TYPES, i),
    l3Dia: pick(SIZES, i), l4Component: "BODY", l5Material: pick(MOCS, i), um: "NOS", availableStock: String(10 * i),
    hsnCode: "84818030", currentStatus: "Active", rmType: "COMMON", indianImported: i % 2 ? "Indian" : "Imported",
  });
  if ((await prisma.rawMaterial.count()) === 0)
    await prisma.rawMaterial.createMany({ data: range().map((i) => ({ ...gmdRow(i), cost: String(400 * i), newItemStatus: "New" })) });
  await prisma.rawMaterial.createMany({ skipDuplicates: true, data: range().map((i) => ({ ...gmdRow(i), cost: 400 * i })) });

  await prisma.fullItem.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      itemCode: `ITM-${i}1`, itemName: `${pick(TYPES, i)} ${pick(SIZES, i)}mm ${pick(PNS, i)}`, itemType: pick(TYPES, i), moc: pick(MOCS, i),
      operation: "MANUAL", size: pick(SIZES, i), pnGmd: pick(PNS, i), cost: 1500 * i, currentReqt: "YES", bomNature: "STANDARD",
    })),
  });
  const fullItems = await prisma.fullItem.findMany({ where: { itemCode: { startsWith: "ITM-" } }, orderBy: { itemCode: "asc" } });
  const rms = await prisma.rawMaterial.findMany({ where: { erpItemCode: { startsWith: "RM-" } }, orderBy: { erpItemCode: "asc" } });
  for (const [idx, fi] of fullItems.entries()) {
    const bomId = `BOM-${fi.itemCode}`;
    if (await prisma.bom.findUnique({ where: { bomId } })) continue;
    await prisma.bom.create({
      data: {
        bomId, bomIdType: "PRIMARY", bomCost: 1200 * (idx + 1), fullItemId: fi.id,
        components: { create: rms.slice(0, 3).map((rm, k) => ({ rawMaterialId: rm.id, quantity: k + 1, cost: 400 * (k + 1) })) },
      },
    });
  }

  await prisma.verifyBom.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      bomId: `BOM-ITM-${i}1`, itemCode: `ITM-${i}1`, rmItemCode: `RM-${100 + i}`, bomIdType: "PRIMARY", bomItemQty: "2",
      itemName: `${pick(TYPES, i)} ${pick(SIZES, i)}mm`, rmItemName: `${pick(MOCS, i)} BODY`, itemType: pick(TYPES, i), moc: pick(MOCS, i),
      size: pick(SIZES, i), pnGmd: pick(PNS, i), cost: String(400 * i), bomItemQtyCost: String(800 * i), availableStock: String(i * 4),
    })),
  });

  if ((await tenderPrisma.contractReview.count()) === 0)
    await tenderPrisma.contractReview.createMany({
      data: range().map((i) => ({
        contractNo: `CN-${2000 + i}`, itemCode: `ITM-${i}1`, mcNo: `MC-${i}`, itemName: `${pick(TYPES, i)} ${pick(SIZES, i)}mm`,
        rate: String(1500 * i), orderQty: String(10 * i), billedQty: String(2 * i), balBillAgCont: String(8 * i),
        item: pick(TYPES, i), size: pick(SIZES, i), pnRating: pick(PNS, i), dateOfContract: `2026-0${i}-01`,
        state: pick(STATES, i), utility: "Water", status: i % 2 ? "Open" : "Closed", mcReceivedPending: i % 2 ? "Received" : "Pending",
        partyNameDump: pick(PARTIES, i), offerNumber: [`OFF-${i}`], remarks: "Dummy row",
      })),
    });

  await prisma.bisStatus.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      itemName: pick(TYPES, i), bisNo: `BIS-${7000 + i}`, expiryDate: new Date(Date.UTC(2027, i, 1)),
      applicationStatus: i % 2 ? "Approved" : "Pending", remark: "Dummy", reachedLab: i % 2 ? "Yes" : "No", licenseNo: `CM/L-${900 + i}`,
    })),
  });

  await prisma.indentListing.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      item: pick(TYPES, i), size: pick(SIZES, i), pnRating: pick(PNS, i), mcReceivedPending: i % 2 ? "Received" : "Pending",
      totalBalBillAgCont: 8 * i, v1: `RM-${100 + i}`, v1Category: "BODY", rmCodeV1: `RM-${100 + i}`,
    })),
  });

  await prisma.lookupOption.createMany({
    skipDuplicates: true,
    data: [
      ...TYPES.map((value, i) => ({ type: "itemType", value, sortOrder: i })),
      ...MOCS.map((value, i) => ({ type: "moc", value, sortOrder: i })),
      ...PARTIES.map((value, i) => ({ type: "partyName", value, sortOrder: i })),
    ],
  });

  await prisma.generatedImage.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      itemType: pick(TYPES, i), operationType: "MANUAL", rmType: "COMMON", imageKey: `dummy-${i}`,
      url: `https://placehold.co/400x300?text=Valve+${i}`, status: i === 5 ? "failed" : "ready", generatedAt: new Date(),
    })),
  });

  await prisma.docketQuotationThread.createMany({
    skipDuplicates: true,
    data: range().map((i) => ({
      threadId: `dummy-thread-${i}`, mailType: i % 2 ? "ENQUIRY" : "QUOTATION", docketNo: `DUMMY-${1000 + i}`,
      docketStatus: i % 2 ? "Pending" : "Quoted", state: pick(STATES, i), isGmdClient: i % 2 === 1, isReplied: i % 3 === 0,
      actionTag: "FOLLOW_UP", date: new Date(Date.UTC(2026, 8, i * 3)), sender: `buyer${i}@example.com`,
      subject: `Enquiry for ${pick(TYPES, i)}`, body: "Dummy mail body.", bodyPreview: "Dummy mail body.",
      aiSummary: "Customer asks for quotation.", category: "Enquiry", company: "GMD", pendingDocket: i % 2 === 1, partyName: pick(PARTIES, i),
    })),
  });

  console.log("Dummy data seeded.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); await pool.end(); });
