import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { resolveItemCategory } from "../lib/itemCategoryResolver";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Public Google Sheet GIDs
const DOCKETS_URL =
  "https://docs.google.com/spreadsheets/d/13PExjBVtkd8izrPT3nCWvofJ7qTztl5IciCuLt9KA6Q/export?format=csv&gid=1091837496";
const ITEMS_URL =
  "https://docs.google.com/spreadsheets/d/13PExjBVtkd8izrPT3nCWvofJ7qTztl5IciCuLt9KA6Q/export?format=csv&gid=1061341359";

// Custom CSV Parser to handle quotes and multiline cells correctly
function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let currentVal = "";

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(currentVal.trim());
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      row.push(currentVal.trim());
      lines.push(row);
      row = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }
  if (currentVal || row.length > 0) {
    row.push(currentVal.trim());
    lines.push(row);
  }
  return lines;
}

// Clean and match raw party names from the sheet with the lookup table list
function getMatchedPartyName(rawName: string, partyNames: string[]): string {
  const cleanRaw = rawName.trim().toLowerCase();
  
  const exactMatch = partyNames.find((name) => name.toLowerCase() === cleanRaw);
  if (exactMatch) return exactMatch;

  const cleanString = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(
        /\b(ltd|limited|pvt|co|corp|corporation|private|company|engineers|engineering|projects|solutions|systems|infra|infrastructure|enterprises|enterprise|construction)\b/gi,
        ""
      )
      .trim()
      .toLowerCase();

  const rawCore = cleanString(rawName);
  if (!rawCore) return rawName;

  const substringMatch = partyNames.find((name) => {
    const listCore = cleanString(name);
    return listCore === rawCore || listCore.includes(rawCore) || rawCore.includes(listCore);
  });

  if (substringMatch) return substringMatch;
  return rawName;
}

interface TempItem {
  itemName: string;
  quantity: number;
  itemType?: string;
  moc?: string;
  size?: string;
  pnRating?: string;
  operationType?: string;
  extension?: string;
  bypass?: string;
  productCost?: number;
  costRefCode?: string;
  cost?: number;
  stockStatus?: string;
  discount?: number;
  itemTypeSource?: string;
  mocSource?: string;
}

interface TempEnquiry {
  docketNumber: string;
  partyName: string;
  enquiryDate: Date;
  enquiryType?: string;
  state?: string;
  paymentTerms?: string;
  inspection?: string;
  pbg?: string;
  utility?: string;
  vaPercent?: number;
  orderStatus?: string;
  attachments: { name: string; url: string; type: string; size: number }[];
  items: TempItem[];
}

async function main() {
  console.log("Fetching party names from LookupOption table...");
  const partyRows = await prisma.lookupOption.findMany({
    where: { type: "PARTY", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const partyNames = partyRows.map((r) => r.value);
  console.log(`Loaded ${partyNames.length} party names.`);

  console.log("Fetching Dockets from 'Form Responses 1' sheet...");
  const docketsRes = await fetch(DOCKETS_URL);
  if (!docketsRes.ok) {
    throw new Error(`Failed to fetch dockets: ${docketsRes.statusText}`);
  }
  const docketsCsv = await docketsRes.text();
  const docketRows = parseCSV(docketsCsv);
  console.log(`Parsed ${docketRows.length} rows from Dockets sheet.`);

  console.log("Fetching Items from 'ITEMS AND RATES' sheet...");
  const itemsRes = await fetch(ITEMS_URL);
  if (!itemsRes.ok) {
    throw new Error(`Failed to fetch items: ${itemsRes.statusText}`);
  }
  const itemsCsv = await itemsRes.text();
  const itemRows = parseCSV(itemsCsv);
  console.log(`Parsed ${itemRows.length} rows from Items sheet.`);

  // 1. Identify Docket columns
  const docketHeaders = docketRows[0].map((h) => h.toLowerCase().trim());
  const getDocketCol = (keywords: string[]) => {
    return docketHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));
  };

  const docketNoIdx = getDocketCol(["docket no", "docket number", "docket"]);
  const dateIdx = getDocketCol(["timestamp", "date"]);
  const partyIdx = getDocketCol(["party name", "party"]);
  const attachmentIdx = getDocketCol(["attachment", "attachments", "file"]);
  
  const typeIdx = getDocketCol(["enquiry type", "type"]);
  const stateIdx = getDocketCol(["state"]);
  const paymentIdx = getDocketCol(["payment terms", "payment"]);
  const inspectionIdx = getDocketCol(["inspection"]);
  const pbgIdx = getDocketCol(["pbg"]);
  const utilityIdx = getDocketCol(["utility"]);
  const vaIdx = getDocketCol(["va", "va%"]);
  const statusIdx = getDocketCol(["order status", "status"]);

  console.log("\nDockets Column Mappings:");
  console.log(`- Docket No Index: ${docketNoIdx}`);
  console.log(`- Date Index: ${dateIdx}`);
  console.log(`- Party Name Index: ${partyIdx}`);
  console.log(`- Attachment Index: ${attachmentIdx}\n`);

  if (docketNoIdx === -1 || partyIdx === -1) {
    console.error("Missing required columns in Dockets sheet.");
    process.exit(1);
  }

  // 2. Identify Items columns
  const itemHeaders = itemRows[0].map((h) => h.toLowerCase().trim());
  const getItemCol = (keywords: string[]) => {
    return itemHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));
  };

  const itemDocketNoIdx = getItemCol(["docket no", "docket number", "docket"]);
  const itemNameIdx = getItemCol(["item name as per party", "item description", "item name", "item"]);
  const quantityIdx = getItemCol(["quantity", "qty"]);
  
  // New item-level columns
  const itemTypeIdx = getItemCol(["item type"]);
  const mocIdx = getItemCol(["moc"]);
  const sizeIdx = getItemCol(["size"]);
  const pnRatingIdx = getItemCol(["pn rating", "pn"]);
  const opTypeIdx = getItemCol(["operation type", "operation"]);
  const extensionIdx = getItemCol(["extension"]);
  const bypassIdx = getItemCol(["bypass"]);
  const prodCostIdx = getItemCol(["product cost"]);
  const costRefIdx = getItemCol(["cost ref code", "cost ref"]);
  const costIdx = getItemCol(["cost"]);
  const stockIdx = getItemCol(["stock status", "stock"]);
  const discountIdx = getItemCol(["discount"]);

  console.log("Items Column Mappings:");
  console.log(`- Docket No Index: ${itemDocketNoIdx}`);
  console.log(`- Item Name Index: ${itemNameIdx}`);
  console.log(`- Quantity Index: ${quantityIdx}`);
  console.log(`- Item Type Index: ${itemTypeIdx}`);
  console.log(`- MOC Index: ${mocIdx}`);
  console.log(`- Size Index: ${sizeIdx}`);
  console.log(`- PN Rating Index: ${pnRatingIdx}`);
  console.log(`- Operation Type Index: ${opTypeIdx}`);
  console.log(`- Extension Index: ${extensionIdx}`);
  console.log(`- Bypass Index: ${bypassIdx}`);
  console.log(`- Product Cost Index: ${prodCostIdx}`);
  console.log(`- Cost Ref Code Index: ${costRefIdx}`);
  console.log(`- Cost Index: ${costIdx}`);
  console.log(`- Stock Status Index: ${stockIdx}`);
  console.log(`- Discount Index: ${discountIdx}\n`);

  if (itemDocketNoIdx === -1 || itemNameIdx === -1) {
    console.error("Missing required columns in Items sheet.");
    process.exit(1);
  }

  const docketsMap: Record<string, TempEnquiry> = {};

  // 3. Process Dockets
  for (let i = 1; i < docketRows.length; i++) {
    const row = docketRows[i];
    if (row.length < 2) continue;

    const docketNumber = row[docketNoIdx]?.trim();
    if (!docketNumber) continue;

    const partyName = getMatchedPartyName(row[partyIdx]?.trim() || "Unknown", partyNames);
    const dateStr = dateIdx !== -1 ? row[dateIdx]?.trim() : "";
    const enquiryDate = dateStr ? new Date(dateStr) : new Date();

    const enquiryType = typeIdx !== -1 ? row[typeIdx]?.trim() : null;
    const state = stateIdx !== -1 ? row[stateIdx]?.trim() : null;
    const paymentTerms = paymentIdx !== -1 ? row[paymentIdx]?.trim() : null;
    const inspection = inspectionIdx !== -1 ? row[inspectionIdx]?.trim() : null;
    const pbg = pbgIdx !== -1 ? row[pbgIdx]?.trim() : null;
    const utility = utilityIdx !== -1 ? row[utilityIdx]?.trim() : null;
    const vaRaw = vaIdx !== -1 ? row[vaIdx]?.replace(/%/g, "").trim() : "";
    const vaVal = vaRaw ? parseFloat(vaRaw) : null;
    const orderStatus = statusIdx !== -1 ? row[statusIdx]?.trim() : null;

    const attachmentStr = attachmentIdx !== -1 ? row[attachmentIdx]?.trim() : "";
    const parsedAttachments: { name: string; url: string; type: string; size: number }[] = [];

    if (attachmentStr && attachmentStr.toLowerCase() !== "#n/a") {
      const links = attachmentStr.split(/[,;\s]+/).map((l) => l.trim()).filter((l) => l.startsWith("http"));
      links.forEach((url, idx) => {
        const driveIdMatch = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const fileId = driveIdMatch ? driveIdMatch[1] : `file_${idx}`;
        parsedAttachments.push({
          name: `Drive_File_${fileId.substring(0, 8)}.pdf`,
          url,
          type: "pdf",
          size: Math.floor(Math.random() * 50000) + 5000,
        });
      });
    }

    docketsMap[docketNumber] = {
      docketNumber,
      partyName,
      enquiryDate: isNaN(enquiryDate.getTime()) ? new Date() : enquiryDate,
      enquiryType: enquiryType || undefined,
      state: state || undefined,
      paymentTerms: paymentTerms || undefined,
      inspection: inspection || undefined,
      pbg: pbg || undefined,
      utility: utility || undefined,
      vaPercent: vaVal && !isNaN(vaVal) ? vaVal : undefined,
      orderStatus: orderStatus || undefined,
      attachments: parsedAttachments,
      items: [],
    };
  }

  // 4. Process Items and join with Dockets
  let itemsCount = 0;
  for (let i = 1; i < itemRows.length; i++) {
    const row = itemRows[i];
    if (row.length < 2) continue;

    const docketNo = row[itemDocketNoIdx]?.trim();
    if (!docketNo) continue;

    const itemName = row[itemNameIdx]?.trim();
    if (!itemName || itemName.toLowerCase() === "#n/a") continue;

    const qtyRaw = quantityIdx !== -1 ? row[quantityIdx]?.replace(/,/g, "").trim() : "1";
    const quantity = parseFloat(qtyRaw) || 1;

    // Parse new item fields
    const itemType = itemTypeIdx !== -1 ? row[itemTypeIdx]?.trim() : null;
    const moc = mocIdx !== -1 ? row[mocIdx]?.trim() : null;
    const size = sizeIdx !== -1 ? row[sizeIdx]?.trim() : null;
    const pnRating = pnRatingIdx !== -1 ? row[pnRatingIdx]?.trim() : null;
    const operationType = opTypeIdx !== -1 ? row[opTypeIdx]?.trim() : null;
    const extension = extensionIdx !== -1 ? row[extensionIdx]?.trim() : null;
    const bypass = bypassIdx !== -1 ? row[bypassIdx]?.trim() : null;
    const costRefCode = costRefIdx !== -1 ? row[costRefIdx]?.trim() : null;
    const stockStatus = stockIdx !== -1 ? row[stockIdx]?.trim() : null;

    const prodCostRaw = prodCostIdx !== -1 ? row[prodCostIdx]?.replace(/,/g, "").trim() : "";
    const productCost = prodCostRaw ? parseFloat(prodCostRaw) : null;

    const costRaw = costIdx !== -1 ? row[costIdx]?.replace(/,/g, "").trim() : "";
    const cost = costRaw ? parseFloat(costRaw) : null;

    const discountRaw = discountIdx !== -1 ? row[discountIdx]?.replace(/,/g, "").trim() : "";
    const discount = discountRaw ? parseFloat(discountRaw) : null;

    const resolved = await resolveItemCategory({
      itemName,
      sheetItemType: itemType,
      sheetMoc: moc,
      sheetSize: size,
      sheetPnRating: pnRating,
    });

    // Check if parent docket exists, otherwise create a placeholder docket
    if (!docketsMap[docketNo]) {
      docketsMap[docketNo] = {
        docketNumber: docketNo,
        partyName: "Unknown Party",
        enquiryDate: new Date(),
        attachments: [],
        items: [],
      };
    }

    docketsMap[docketNo].items.push({
      itemName,
      quantity,
      itemType: resolved.itemType || undefined,
      moc: resolved.moc || undefined,
      itemTypeSource: resolved.itemTypeSource || undefined,
      mocSource: resolved.mocSource || undefined,
      size: resolved.size || undefined,
      pnRating: resolved.pnRating || undefined,
      operationType: operationType || undefined,
      extension: extension || undefined,
      bypass: bypass || undefined,
      productCost: productCost && !isNaN(productCost) ? productCost : undefined,
      costRefCode: costRefCode || undefined,
      cost: cost && !isNaN(cost) ? cost : undefined,
      stockStatus: stockStatus || undefined,
      discount: discount && !isNaN(discount) ? discount : undefined,
    });
    itemsCount++;
  }

  console.log(`Joined ${itemsCount} items to their dockets.`);

  const docketsToImport = Object.keys(docketsMap);
  console.log(`Found ${docketsToImport.length} unique enquiries to import.\n`);

  // Clear existing records to ensure a fresh clean import
  console.log("Clearing existing enquiries in the database for fresh import...");
  await prisma.attachment.deleteMany({});
  await prisma.enquiryItem.deleteMany({});
  await prisma.enquiry.deleteMany({});

  // Batch insert in parallel
  const BATCH_SIZE = 100;
  let count = 0;

  for (let i = 0; i < docketsToImport.length; i += BATCH_SIZE) {
    const batch = docketsToImport.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (docket) => {
        const eq = docketsMap[docket];
        
        // Ensure every docket has at least one item
        if (eq.items.length === 0) {
          eq.items.push({
            itemName: "General Enquiry Item",
            quantity: 1,
          });
        }

        try {
          await prisma.enquiry.create({
            data: {
              docketNumber: eq.docketNumber,
              partyName: eq.partyName,
              enquiryDate: eq.enquiryDate,
              enquiryType: eq.enquiryType,
              state: eq.state,
              paymentTerms: eq.paymentTerms,
              inspection: eq.inspection,
              pbg: eq.pbg,
              utility: eq.utility,
              vaPercent: eq.vaPercent,
              orderStatus: eq.orderStatus,
              attachments: {
                create: eq.attachments.map((att) => ({
                  name: att.name,
                  url: att.url,
                  type: att.type,
                  size: att.size,
                })),
              },
              items: {
                create: eq.items.map((item) => ({
                  itemName: item.itemName,
                  quantity: item.quantity,
                  itemType: item.itemType,
                  moc: item.moc,
                  itemTypeSource: item.itemTypeSource,
                  mocSource: item.mocSource,
                  size: item.size,
                  pnRating: item.pnRating,
                  operationType: item.operationType,
                  extension: item.extension,
                  bypass: item.bypass,
                  productCost: item.productCost,
                  costRefCode: item.costRefCode,
                  cost: item.cost,
                  stockStatus: item.stockStatus,
                  discount: item.discount,
                })),
              },
            },
          });
          count++;
        } catch (e: any) {
          console.error(`[ERROR] Failed to import docket ${eq.docketNumber}:`, e.message);
        }
      })
    );

    console.log(`Progress: Imported ${count}/${docketsToImport.length} enquiries...`);
  }

  console.log(`\nImport completed! Successfully imported ${count}/${docketsToImport.length} enquiries.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
