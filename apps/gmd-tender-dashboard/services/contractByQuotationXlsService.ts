import * as path from "path";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

const DEFAULT_XLS_PATH = "Tenders Details - Puja (1).xls";
const SHEET_NAME = "Sales_Contract";
const HEADER_ROW = 0;
const QUOTATION_COL = 2; // QUOTATION_VRNO
const CONTRACT_COL = 3; // VRNO_Sales_Contract

const NULL_VALUES = new Set(["", "-", "not quoted", "n.a", "na", "null"]);

export interface ContractByQuotationStats {
  total: number;
  found: number;
  updated: number;
  notFound: number;
  skippedExistingContract: number;
  skippedNullQuotationDb: number;
  skippedNullQuotationXls: number;
  skippedNullContractXls: number;
  uniqueQuotations: number;
  multiContractQuotations: number;
  errors: number;
  headerCheck: {
    passed: boolean;
    sheetFound: boolean;
    sheetName: string;
    expectedQuotationHeader: string;
    expectedContractHeader: string;
    actualHeaders: string[];
    xlsPath: string;
    totalRows: number;
  };
}

export interface ContractSyncOptions {
  dryRun?: boolean;
  verbose?: boolean;
  filePath?: string;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export async function syncContractByQuotationFromXls(
  options: ContractSyncOptions = {},
): Promise<ContractByQuotationStats> {
  const xlsPath = options.filePath || DEFAULT_XLS_PATH;
  const resolvedPath = path.isAbsolute(xlsPath) ? xlsPath : path.resolve(process.cwd(), xlsPath);

  const stats: ContractByQuotationStats = {
    total: 0,
    found: 0,
    updated: 0,
    notFound: 0,
    skippedExistingContract: 0,
    skippedNullQuotationDb: 0,
    skippedNullQuotationXls: 0,
    skippedNullContractXls: 0,
    uniqueQuotations: 0,
    multiContractQuotations: 0,
    errors: 0,
    headerCheck: {
      passed: false,
      sheetFound: false,
      sheetName: SHEET_NAME,
      expectedQuotationHeader: "QUOTATION_VRNO",
      expectedContractHeader: "VRNO_Sales_Contract",
      actualHeaders: [],
      xlsPath: resolvedPath,
      totalRows: 0,
    },
  };

  // 1. Read XLS
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(resolvedPath);
  } catch (err) {
    console.warn(`[ContractByQuotationXls] Failed to read XLS "${resolvedPath}":`, (err as Error).message);
    stats.errors++;
    return stats;
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    console.warn(`[ContractByQuotationXls] Sheet "${SHEET_NAME}" not found. Available: ${workbook.SheetNames.join(", ")}`);
    stats.errors++;
    return stats;
  }
  stats.headerCheck.sheetFound = true;

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  stats.headerCheck.totalRows = rows.length;
  const headers = (rows[HEADER_ROW] as unknown[])?.map((h) => String(h ?? "").trim()) ?? [];
  stats.headerCheck.actualHeaders = headers;

  // 2. Header verification before any DB work
  const actualQHeader = headers[QUOTATION_COL] ?? "";
  const actualCHeader = headers[CONTRACT_COL] ?? "";
  const qOk = normalizeHeader(actualQHeader) === normalizeHeader("QUOTATION_VRNO");
  const cOk = normalizeHeader(actualCHeader) === normalizeHeader("VRNO_Sales_Contract");

  if (!qOk || !cOk) {
    console.warn(`[ContractByQuotationXls] Header check failed in "${SHEET_NAME}" row ${HEADER_ROW}: expected col ${QUOTATION_COL}="QUOTATION_VRNO" got "${actualQHeader}", col ${CONTRACT_COL}="VRNO_Sales_Contract" got "${actualCHeader}"`);
    console.warn(`[ContractByQuotationXls] Actual headers: ${JSON.stringify(headers)}`);
    stats.errors++;
    return stats;
  }
  stats.headerCheck.passed = true;

  if (options.verbose) {
    console.log(`[ContractByQuotationXls] Header check passed: sheet="${SHEET_NAME}" rows=${rows.length} file="${resolvedPath}"`);
    console.log(`  QUOTATION_VRNO col ${QUOTATION_COL}="${actualQHeader}", VRNO_Sales_Contract col ${CONTRACT_COL}="${actualCHeader}"`);
  }

  // 3. Build quotation -> Set<contract> then join with ", "
  const contractSetByQuotation = new Map<string, Set<string>>();
  for (let r = HEADER_ROW + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row) continue;
    const qRaw = row[QUOTATION_COL] !== undefined ? String(row[QUOTATION_COL]).trim() : "";
    const cRaw = row[CONTRACT_COL] !== undefined ? String(row[CONTRACT_COL]).trim() : "";

    if (!qRaw || NULL_VALUES.has(qRaw.toLowerCase())) {
      stats.skippedNullQuotationXls++;
      continue;
    }
    if (!cRaw || NULL_VALUES.has(cRaw.toLowerCase())) {
      stats.skippedNullContractXls++;
      continue;
    }

    // Exact trim match key (case-sensitive as in Excel) — preserves LD221-00003 style
    const qKey = qRaw;
    if (!contractSetByQuotation.has(qKey)) {
      contractSetByQuotation.set(qKey, new Set());
    }
    contractSetByQuotation.get(qKey)!.add(cRaw);
  }

  // Collapse to comma-separated
  const contractByQuotation = new Map<string, string>();
  for (const [q, set] of contractSetByQuotation) {
    const joined = Array.from(set).join(", ");
    contractByQuotation.set(q, joined);
    if (set.size > 1) stats.multiContractQuotations++;
  }
  stats.uniqueQuotations = contractByQuotation.size;

  if (options.verbose) {
    console.log(`[ContractByQuotationXls] Lookup built: ${stats.uniqueQuotations} unique quotations (${stats.multiContractQuotations} with multiple contracts), ${stats.skippedNullQuotationXls} skipped null quotations, ${stats.skippedNullContractXls} skipped null contracts`);
    // Show a few multi examples
    const multiSamples = Array.from(contractByQuotation.entries())
      .filter(([, v]) => v.includes(", "))
      .slice(0, 3)
      .map(([k, v]) => `  ${k} -> ${v}`);
    if (multiSamples.length) {
      console.log(`[ContractByQuotationXls] Multi-contract samples:\n${multiSamples.join("\n")}`);
    }
  }

  // 4. Fetch TenderMerged and update only null contractNo
  const allTenders = await prisma.tenderMerged.findMany({
    select: { id: true, quotationNo: true, contractNo: true },
  });
  stats.total = allTenders.length;

  for (const tender of allTenders) {
    if (!tender.quotationNo || tender.quotationNo.trim() === "" || NULL_VALUES.has(tender.quotationNo.trim().toLowerCase())) {
      stats.skippedNullQuotationDb++;
      continue;
    }
    // Only null contract numbers should be brought
    if (tender.contractNo !== null && tender.contractNo !== undefined && tender.contractNo.trim() !== "") {
      stats.skippedExistingContract++;
      continue;
    }

    const qKey = tender.quotationNo.trim();
    const contractNo = contractByQuotation.get(qKey);

    if (contractNo === undefined) {
      stats.notFound++;
      continue;
    }

    // contractNo is guaranteed non-empty comma-joined string
    stats.found++;

    if (options.dryRun) {
      if (options.verbose) {
        console.log(`[DRY-RUN] Would update id=${tender.id} quotationNo="${qKey}" contractNo: null -> "${contractNo}"`);
      }
      stats.updated++;
      continue;
    }

    try {
      await prisma.tenderMerged.update({
        where: { id: tender.id },
        data: { contractNo },
      });
      stats.updated++;
      if (options.verbose) {
        console.log(`[ContractByQuotationXls] Updated id=${tender.id} quotationNo="${qKey}" -> contractNo="${contractNo}"`);
      }
    } catch (err) {
      console.warn(`[ContractByQuotationXls] Failed to update contractNo for quotationNo ${qKey}:`, (err as Error).message);
      stats.errors++;
    }
  }

  return stats;
}
