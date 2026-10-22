import { prisma } from "@/lib/prisma";
import { encryptRelativePath } from "@/lib/fileCrypto";
import { TYPE_TEST_FILE_TYPE, readTypeTestLedger } from "@/services/typeTestLedgerService";

export type TypeTestSyncOptions = {
  filePath?: string;
  dryRun?: boolean;
  verbose?: boolean;
};

export type TypeTestSyncStats = {
  filePath: string;
  sheetName: string;
  totalRows: number;
  skippedNoItemCode: number;
  skippedNoCertNo: number;
  upserted: number;
  created: number;
  updated: number;
  errors: number;
  dryRun: boolean;
};

function parseDateValue(raw: unknown, str: string | null): Date | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  if (!str) return null;
  const s = str.trim();
  if (!s) return null;
  // excel may have dd-mm-yyyy or dd/mm/yyyy or "21-03-2020" without time
  // try native Date parse, then dd-mm-yyyy
  const d1 = new Date(s);
  if (!isNaN(d1.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) return d1;
  // try dd-mm-yyyy or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10) - 1;
    let yyyy = parseInt(m[3], 10);
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, mm, dd);
    if (!isNaN(d.getTime())) return d;
  }
  if (!isNaN(d1.getTime())) return d1;
  return null;
}

export async function syncTypeTestFromLedger(opts: TypeTestSyncOptions = {}): Promise<TypeTestSyncStats> {
  const res = await readTypeTestLedger({ filePath: opts.filePath });
  const stats: TypeTestSyncStats = {
    filePath: res.filePath,
    sheetName: res.sheetName,
    totalRows: res.rows.length,
    skippedNoItemCode: 0,
    skippedNoCertNo: 0,
    upserted: 0,
    created: 0,
    updated: 0,
    errors: 0,
    dryRun: !!opts.dryRun,
  };

  for (const row of res.rows) {
    const itemCodeRaw = row.itemCode ?? row.erpCode;
    const itemCode = itemCodeRaw ? itemCodeRaw.trim().toUpperCase() : "";
    const certNo = row.testCertificateNo ? row.testCertificateNo.trim() : "";

    if (!itemCode || itemCode === "NA") {
      stats.skippedNoItemCode++;
      continue;
    }
    if (!certNo) {
      stats.skippedNoCertNo++;
      continue;
    }

    const lab = row.lab; // already mapped via mapLab in ledger service
    const issuedAt = parseDateValue(row.issuedRaw, row.issued);
    const expiredAt = parseDateValue(row.expiredRaw, row.expired);

    // Store as encrypted TYPETEST|\<backslash path> per standard (portable will normalize \ -> / at resolve)
    let encryptedUrl: string | null = null;
    const rawLink = row.testCertificateHyperlink;
    if (rawLink) {
      try {
        const decoded = decodeURI(rawLink.trim());
        // force Windows separators as requested: store as \\ path
        // strip leading ../, ..\, ./, .\ and leading separators so resolve does not pop base (e.g. "..\Cables" -> "Cables")
        const sanitized = decoded
          .trim()
          .replace(/^(\.\.?[\\/]+)+/, "")
          .replace(/^[\\/]+/, "");
        const backslashPath = sanitized.replace(/\//g, "\\");
        encryptedUrl = encryptRelativePath(TYPE_TEST_FILE_TYPE, backslashPath);
      } catch {
        // fallback: store raw as backslash
        const sanitized = rawLink
          .trim()
          .replace(/^(\.\.?[\\/]+)+/, "")
          .replace(/^[\\/]+/, "");
        const backslashPath = sanitized.replace(/\//g, "\\");
        encryptedUrl = encryptRelativePath(TYPE_TEST_FILE_TYPE, backslashPath);
      }
    }

    const data = {
      itemCode,
      testCertificateNo: certNo,
      testCertificateUrl: encryptedUrl,
      lab,
      issuedAt,
      expiredAt,
      validity: null as string | null,
    };

    if (opts.dryRun) {
      stats.upserted++;
      if (opts.verbose) console.log(`[DRY-RUN] ${itemCode} | ${certNo} | ${lab} | ${row.testCertificateHyperlink?.slice(0,60) ?? ""}`);
      continue;
    }

    try {
      const existing = await prisma.typeTest.findUnique({
        where: { itemCode_testCertificateNo: { itemCode, testCertificateNo: certNo } },
        select: { id: true },
      });
      await prisma.typeTest.upsert({
        where: { itemCode_testCertificateNo: { itemCode, testCertificateNo: certNo } },
        update: data,
        create: data,
      });
      stats.upserted++;
      if (existing) stats.updated++;
      else stats.created++;
      if (opts.verbose) console.log(`[TypeTestSync] upsert ${itemCode} | ${certNo}`);
    } catch (err) {
      stats.errors++;
      console.warn(`[TypeTestSync] failed ${itemCode} ${certNo}: ${(err as Error).message}`);
    }
  }

  return stats;
}
