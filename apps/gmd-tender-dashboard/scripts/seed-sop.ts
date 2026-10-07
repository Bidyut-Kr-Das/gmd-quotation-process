import { prisma } from "../lib/prisma";

type SeedRow = {
  id: number;
  columnName: string;
  description: string | null;
  allocatedTo: string | null;
  email: string | null;
  source: string | null;
  doneFromWhere: string | null;
  isManual: boolean;
  dailyLogEnabled: boolean;
  dateEnabled: boolean;
  dailyLog?: string | null;
  date?: string | null;
};

// Hardcoded unique ids — 1..4 manual from user, 5.. for TenderMerged fields (small total)
const SEED_ROWS: SeedRow[] = [
  { id: 1, columnName: "APM", description: "It is done as per instruction from Sambhu Chakraborty to Arpan Pal, as per discussion with PVG and AKG.", allocatedTo: "Arpan Pal", email: "sales@uicwires.com", source: "MANUAL", doneFromWhere: "-", isManual: true, dailyLogEnabled: true, dateEnabled: true },
  { id: 2, columnName: "APS", description: "-", allocatedTo: "Sambhu Chakraborty", email: "sambhu@gmdalui.co.in", source: "MANUAL", doneFromWhere: "-", isManual: true, dailyLogEnabled: true, dateEnabled: true },
  { id: 3, columnName: "APP", description: "Based on logical formula.", allocatedTo: "Arpan Pal", email: "sales@uicwires.com", source: "MANUAL", doneFromWhere: "-", isManual: true, dailyLogEnabled: true, dateEnabled: true },
  { id: 4, columnName: "File Upload", description: "Uploading new tenders daily from T247 and Tender Tiger.", allocatedTo: "Arpan Pal", email: "sales@uicwires.com", source: "SCRAPE_247", doneFromWhere: "T247 Puppeteer bidplus.gem + Tender Tiger uploader + /api/upload + GoogleSheetService", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  // TenderMerged representative sample — add remaining as needed with tail ids
  { id: 5, columnName: "referenceNo", description: "Tender / NIT No (unique) - primary key(from file uploaded)", allocatedTo: "-", email: "-", source: "UPLOAD_EXCEL", doneFromWhere: "Excel referenceNo via ColumnMapping + T247 fix script", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 6, columnName: "tenderBrief", description: "Work/item description used for AI & filters(from file uploaded)", allocatedTo: "-", email: "-", source: "UPLOAD_EXCEL", doneFromWhere: "Excel tenderBrief map", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 7, columnName: "deadline", description: "Last date of submission", allocatedTo: "-", email: "-", source: "UPLOAD_EXCEL", doneFromWhere: "Excel deadline via parseDate", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 8, columnName: "organization", description: "Procuring organization / buyer", allocatedTo: "-", email: "-", source: "UPLOAD_EXCEL", doneFromWhere: "Excel organization", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 9, columnName: "docketNo", description: "Internal ENQ docket number", allocatedTo: "Arindam Sarkar", email: "lasertender.001@gmail.com", source: "MANUAL", doneFromWhere: "Excel + Manual ENQ regex + updateTenderDocketNo + smartsheet sync", isManual: true, dailyLogEnabled: true, dateEnabled: true },
  { id: 10, columnName: "aiRelevanceValid", description: "AI says eligible for Power Cables/Conductors", allocatedTo: "-", email: "-", source: "AI", doneFromWhere: "OpenAI actions/ai-analysis analyzeTenderValidity", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 12, columnName: "itemCategory", description: "Extracted item category (XLPE, AB Cable)", allocatedTo: "-", email: "-", source: "DOCUMENT_PARSE", doneFromWhere: "pdf-extractor extractPdfData + queueCvaParsing", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 13, columnName: "totalQuantity", description: "Total quantity extracted from PDF", allocatedTo: "-", email: "-", source: "DOCUMENT_PARSE", doneFromWhere: "pdf-extractor totalQuantity", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 14, columnName: "proposedErpItemName", description: "Derived ERP item name from CostingSheetDetails", allocatedTo: "-", email: "-", source: "DOCUMENT_PARSE", doneFromWhere: "CostingSheetDetails.cva via flattenTender", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 15, columnName: "cva", description: "CVA JSON aggregated from costing", allocatedTo: "-", email: "-", source: "DOCUMENT_PARSE", doneFromWhere: "CostingSheetDetails flatten", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 16, columnName: "emdPaymentMode", description: "EMD Payment Mode BG/NEFT/EXEMPTED", allocatedTo: "Assigned To", email: "-", source: "MANUAL", doneFromWhere: "Manual TenderTable emdPaymentMode", isManual: true, dailyLogEnabled: false, dateEnabled: false },
  { id: 17, columnName: "bgNoUtrNo", description: "BG No / UTR No", allocatedTo: "Assigned To", email: "-", source: "MANUAL", doneFromWhere: "Manual updateBgNoUtrNo", isManual: true, dailyLogEnabled: false, dateEnabled: false },
  { id: 18, columnName: "differenceBetweenRank1", description: "L1 Diff (%) auto calc", allocatedTo: "-", email: "-", source: "RA_AUTOMATION", doneFromWhere: "gem-bid-results scrape evaluations + auto diff calc", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 19, columnName: "valueOfRank1", description: "L1 Price", allocatedTo: "-", email: "-", source: "RA_AUTOMATION", doneFromWhere: "RA scraper + manual overwrite gated", isManual: false, dailyLogEnabled: false, dateEnabled: false },
  { id: 20, columnName: "tenderUpdateStatus", description: "OPEN/CLOSED — auto from bgStatus/currentStatus", allocatedTo: "Arindam Sarkar", email: "lasertender.001@gmail.com", source: "MANUAL", doneFromWhere: "Manual updateStatusAndAction", isManual: true, dailyLogEnabled: true, dateEnabled: true },
  { id: 21, columnName: "reverseAuctionApplicable", description: "RA applicable bool (auto if raQualificationRule)", allocatedTo: "Assigned To or AI", email: "-", source: "MANUAL", doneFromWhere: "Manual + RA automation", isManual: true, dailyLogEnabled: false, dateEnabled: false },
  { id: 22, columnName: "quotationNo", description: "Quotation number", allocatedTo: "-", email: "-", source: "GOOGLE_SHEET_SYNC", doneFromWhere: "smartsheetQuotationSync + manual", isManual: true, dailyLogEnabled: true, dateEnabled: true },
];

async function main() {
  console.log(`Seeding ${SEED_ROWS.length} SOP rows (hardcoded ids, upsert, no delete) ...`);
  let created = 0, updated = 0;
  for (const r of SEED_ROWS) {
    const byId = await prisma.sopResponsibility.findUnique({ where: { id: r.id } });
    if (byId) {
      // update if diff — preserve allocatedTo/email if r has null but byId has value? For hardcoded we overwrite description/source etc but keep allocatedTo if r null? For our seed we have explicit values so overwrite.
      const data: any = {
        columnName: r.columnName,
        description: r.description,
        allocatedTo: r.allocatedTo,
        email: r.email,
        source: r.source,
        doneFromWhere: r.doneFromWhere,
        isManual: r.isManual,
        dailyLogEnabled: r.dailyLogEnabled,
        dateEnabled: r.dateEnabled,
      };
      const diff = Object.keys(data).some(k => (byId as any)[k] !== data[k]);
      if (diff) {
        await prisma.sopResponsibility.update({ where: { id: r.id }, data });
        updated++;
      }
    } else {
      const byName = await prisma.sopResponsibility.findFirst({ where: { columnName: r.columnName } });
      if (byName) {
        // update existing byName without changing its id
        await prisma.sopResponsibility.update({ where: { id: byName.id }, data: {
          description: r.description,
          allocatedTo: r.allocatedTo ?? byName.allocatedTo,
          email: r.email ?? byName.email,
          source: r.source,
          doneFromWhere: r.doneFromWhere,
          isManual: r.isManual,
          dailyLogEnabled: r.dailyLogEnabled,
          dateEnabled: r.dateEnabled,
        }});
        updated++;
      } else {
        await prisma.sopResponsibility.create({ data: { id: r.id, columnName: r.columnName, description: r.description, allocatedTo: r.allocatedTo, email: r.email, source: r.source, doneFromWhere: r.doneFromWhere, isManual: r.isManual, dailyLogEnabled: r.dailyLogEnabled, dateEnabled: r.dateEnabled, dailyLog: r.dailyLog ?? null, date: r.date ? new Date(r.date) : null } });
        created++;
      }
    }
  }
  // reset sequence to max id to avoid clash with autoincrement
  try {
    await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('"sop_responsibilities"','id'), (SELECT COALESCE(MAX(id),0) FROM "sop_responsibilities"))`;
  } catch (e) { console.warn("setval failed", e); }
  console.log(`Seed done: ${created} created, ${updated} updated, ${SEED_ROWS.length} total (no deletes)`);
}

main().catch(e=>{ console.error(e); process.exit(1); }).finally(async ()=>{ await prisma.$disconnect(); });
