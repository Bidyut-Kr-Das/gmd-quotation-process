import * as XLSX from "xlsx";
import path from "path";
import pg from "pg";
import crypto from "crypto";

const FILE = path.join(process.cwd(), "BIS STATUS (1).xlsx");

function excelSerialToDate(serial: number): Date | null {
  try {
    const parsed: any = (XLSX.SSF as any).parse_date_code?.(serial);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      // Use UTC to keep date stable regardless of server TZ (IST vs UTC)
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  } catch {}
  const utc_days = Math.floor(serial - 25569);
  const d = new Date(utc_days * 86400 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseExpiryCell(raw: unknown): { expiryDate: Date | null; applicationStatus: string | null } {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { expiryDate: null, applicationStatus: null };
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.toUpperCase() === "NEW APPLICATION") {
      return { expiryDate: null, applicationStatus: "NEW APPLICATION" };
    }
    // Try to parse as date string M/D/YY or DD-Mmm-YYYY
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      // Excel may have formatted w like "1/31/31" -> new Date("1/31/31") parses as 1931, but serial already handled
      // For safety, treat as date if year plausibly 2020-2040
      return { expiryDate: d, applicationStatus: null };
    }
    // Unknown string treat as applicationStatus?
    return { expiryDate: null, applicationStatus: t };
  }
  if (typeof raw === "number") {
    const d = excelSerialToDate(raw);
    if (d && !isNaN(d.getTime())) return { expiryDate: d, applicationStatus: null };
    return { expiryDate: null, applicationStatus: null };
  }
  return { expiryDate: null, applicationStatus: null };
}

async function main() {
  console.log(`[bis-import] Reading ${FILE}`);
  const wb = XLSX.readFile(FILE);
  console.log(`[bis-import] Sheets: ${wb.SheetNames.join(", ")}`);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // Use header:1 with range B3:E12 handling: sheet !ref is B3:E12, so header row is first row in range
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false }) as unknown[][];
  console.log(`[bis-import] Total rows including header: ${rows.length}`);
  rows.forEach((r, i) => console.log(`[bis-import] row ${i}: ${JSON.stringify(r)}`));

  if (rows.length < 2) {
    console.log("[bis-import] No data");
    return;
  }

  const header = rows[0];
  console.log(`[bis-import] Header: ${JSON.stringify(header)}`);
  // Expect ["ITEM NAME","BIS NO","EXPIRY DATE","REACHED LAB"]
  const dataRows = rows.slice(1);
  console.log(`[bis-import] Data rows: ${dataRows.length}`);

  const conn = process.env.DATABASE_URL || "postgresql://postgres:postgres@192.168.1.190:5432/gmd-quotation";
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  console.log("[bis-import] Connected via pg");

  let upserted = 0;
  let skipped = 0;
  const dupeMap = new Map<string, number>();
  for (let idx = 0; idx < dataRows.length; idx++) {
    const row = dataRows[idx];
    const itemNameRaw = row[0];
    const bisNoRaw = row[1];
    const expiryRaw = row[2];
    const labRaw = row[3];

    const itemName = itemNameRaw ? String(itemNameRaw).trim() : null;
    const bisNo = bisNoRaw ? String(bisNoRaw).trim() : null;
    const reachedLab = labRaw ? String(labRaw).trim() : null;

    if (!bisNo) {
      console.log(`[bis-import] skip row ${idx + 1} missing bisNo itemName=${itemName}`);
      skipped++;
      continue;
    }

    dupeMap.set(bisNo, (dupeMap.get(bisNo) || 0) + 1);

    const { expiryDate, applicationStatus } = parseExpiryCell(expiryRaw);

    console.log(
      `[bis-import] row ${idx + 1} bisNo=${bisNo} item=${itemName} expiryRaw=${JSON.stringify(
        expiryRaw,
      )} -> expiryDate=${expiryDate ? expiryDate.toISOString().slice(0, 10) : null} appStatus=${
        applicationStatus ?? null
      } lab=${reachedLab?.slice(0, 40) ?? null}`,
    );

    try {
      const id = crypto.randomUUID();
      // Use pg upsert; preserve remark on conflict, only update relevant fields
      await client.query(
        `INSERT INTO "BisStatus" ("id","itemName","bisNo","expiryDate","applicationStatus","remark","reachedLab","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT ("bisNo") DO UPDATE SET
           "itemName" = EXCLUDED."itemName",
           "expiryDate" = EXCLUDED."expiryDate",
           "applicationStatus" = EXCLUDED."applicationStatus",
           "reachedLab" = EXCLUDED."reachedLab",
           "updatedAt" = NOW()`,
        [id, itemName, bisNo, expiryDate, applicationStatus, null, reachedLab],
      );
      upserted++;
    } catch (e: any) {
      console.error(`[bis-import] upsert failed bisNo=${bisNo} err=${e.message}`);
      skipped++;
    }
  }

  console.log(`[bis-import] Dup summary:`);
  for (const [k, v] of dupeMap.entries()) if (v > 1) console.log(`  dup ${k} x${v} last wins`);

  const totalRes = await client.query('SELECT COUNT(*) as c FROM "BisStatus"');
  console.log(`[bis-import] Done upserted=${upserted} skipped=${skipped} total in DB=${totalRes.rows[0].c} dataRows=${dataRows.length}`);
  const all = await client.query('SELECT "bisNo","itemName","expiryDate","applicationStatus","reachedLab","remark" FROM "BisStatus" ORDER BY "bisNo" ASC');
  console.log(`[bis-import] DB dump:`);
  for (const r of all.rows) {
    const exp = r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0,10) : "null";
    console.log(
      `  ${r.bisNo} | ${r.itemName} | expiry=${exp} | appStatus=${r.applicationStatus ?? "null"} | lab=${r.reachedLab?.slice(0, 50) ?? "null"} | remark=${r.remark ?? "null"}`,
    );
  }
  await client.end();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
