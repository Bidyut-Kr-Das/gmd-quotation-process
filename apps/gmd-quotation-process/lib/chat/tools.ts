import { tool } from "ai";
import { z } from "zod";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import {
  sanitizeAttachmentFileName,
  uploadToS3,
} from "@/lib/s3";
import type { Prisma } from "@/app/generated/prisma";

const CONTRACT_REVIEW_FILTER_COLUMNS = [
  "contractNo",
  "itemCode",
  "mcNo",
  "itemName",
  "partyItemName",
  "rate",
  "cv",
  "vaPercent",
  "orderQty",
  "freeStock",
  "finalReq",
  "mcQty",
  "balanceMc",
  "prodOrdQty",
  "balanceToProdOrd",
  "balanceToProdEnt",
  "diQty",
  "billedQty",
  "balBillAgMc",
  "balBillAgCont",
  "item",
  "value",
  "size",
  "pnRating",
  "dateOfContract",
  "clearanceStatus",
  "actuator",
  "rmCodeForActuator",
  "rmCodeForGb",
  "paymentTerms",
  "lcRtgsRefNo",
  "lcDateRtgsDate",
  "lastDateOfShipmentDateOfLc",
  "issuingBankName",
  "bomFormulaTrial",
  "erpPartyNameFromGmdSupplyHistory",
  "itemType",
  "jobCode",
  "balDiQty",
  "balMcVal",
  "balProdOrdVal",
  "balToProdOrdEntVal",
  "balBillAgMcVal",
  "balBillAgContVal",
  "balDiVal",
  "state",
  "utility",
  "projectReference",
  "diVal",
  "icQty",
  "bomId",
  "noUse",
  "partyNameDump",
  "status",
  "mcReceivedPending",
  "inspection",
  "offerPendingDone",
  "remarks",
  "costfromQuotation",
  "vaPercentfromcost",
  "productionOrderNumber",
  "poNo",
] as const;

const CONTRACT_REVIEW_ARRAY_COLUMNS = new Set([
  "offerNumber",
  "inspectionNumber",
  "diDate",
  "orderList",
]);

const CONTRACT_REVIEW_SELECT = {
  contractNo: true,
  itemCode: true,
  mcNo: true,
  itemName: true,
  partyItemName: true,
  partyNameDump: true,
  erpPartyNameFromGmdSupplyHistory: true,
  rate: true,
  cv: true,
  vaPercent: true,
  orderQty: true,
  freeStock: true,
  finalReq: true,
  balanceMc: true,
  mcQty: true,
  diQty: true,
  billedQty: true,
  dateOfContract: true,
  lastDateOfShipmentDateOfLc: true,
  clearanceStatus: true,
  status: true,
  state: true,
  remarks: true,
  offerPendingDone: true,
} as const;

export function buildChatTools(userId: string) {
  return {
    lookup_contract_review: tool({
    description:
      "Search contract review records (read-only). Filter on ANY column of the ContractReview table — every field accepts a partial text match (case-insensitive). Returns only a curated set of columns (not the full row). Use filters to narrow by e.g. lastDateOfShipmentDateOfLc, clearanceStatus, paymentTerms, etc. Limited by limit (default 25, max 100).",
    inputSchema: z
      .object(
        Object.fromEntries(
          CONTRACT_REVIEW_FILTER_COLUMNS.map((f) => [f, z.string().optional()]),
        ),
      )
      .extend({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum rows to return, default 25"),
      }),
    execute: async (input) => {
      const { limit, ...filters } = input;
      const where: Prisma.ContractReviewWhereInput = {};
      const whereRecord = where as Record<string, unknown>;
      for (const [key, value] of Object.entries(filters)) {
        if (!value) continue;
        if (CONTRACT_REVIEW_ARRAY_COLUMNS.has(key)) {
          whereRecord[key] = { has: value };
        } else {
          whereRecord[key] = { contains: value, mode: "insensitive" };
        }
      }
      const rows = await prisma.contractReview.findMany({
        where,
        orderBy: { syncedAt: "desc" },
        take: Number(limit) || 25,
        select: CONTRACT_REVIEW_SELECT,
      });

      if (rows.length === 0) {
        return "No contract review records matched the filters.";
      }
      return rows;
    },
  }),
    memorize: tool({
      description:
        "Store a durable fact about the user in long-term memory (e.g. preferences, recurring item codes, contacts, working notes). Read-only database rules do not apply here — this tool writes only to the user's memory store. Keep memories short and factual.",
      inputSchema: z.object({
        memory: z
          .string()
          .describe("The fact to remember, one concise sentence"),
      }),
      execute: async ({ memory }) => {
        console.log("[memorize]", JSON.stringify({ userId, memory }));
        await prisma.userMemory.create({
          data: { userId, memory },
        });
        return `Saved to memory: ${memory}`;
      },
    }),
    prepare_excel: tool({
      description:
        "Generate an Excel file (.xlsx) from the given file name, headers, and row data, upload it to storage, and return a downloadable file (fileName + downloadUrl). Use when the user wants an Excel export of data.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe("File name without extension, e.g. contract_review_export"),
        headers: z
          .array(z.string())
          .describe("Column headers, in order"),
        rows: z
          .array(z.array(z.string()))
          .describe("Rows of data, each cell aligned to the headers. Values as strings."),
      }),
      execute: async ({ fileName, headers, rows }) => {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        const base = fileName.replace(/\.xlsx$/i, "");
        const safeName = sanitizeAttachmentFileName(`${base}.xlsx`);
        const key = `chat-export/${Date.now()}-${safeName}`;
        const contentType =
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        await uploadToS3({ key, body: buf, contentType });

        const endpoint = (process.env.S3_ENDPOINT_URL || "").replace(/\/+$/, "");
        const bucket = process.env.S3_BUCKET || "";
        const downloadUrl = `${endpoint}/${bucket}/${key}`;

        return { fileName: `${base}.xlsx`, downloadUrl };
      },
    }),
    remember: tool({
      description:
        "Recall the user's long-term memories relevant to a query (preferences, saved facts, notes). Returns matching memories; with no query, returns the most recent memories. If a query returns nothing, recent memories are returned as fallback.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("What to search memories for"),
      }),
      execute: async ({ query }) => {
        const tokens = query
          ? query.split(/\s+/).filter(Boolean).slice(0, 6)
          : [];
        const memories = await prisma.userMemory.findMany({
          where: {
            userId,
            ...(tokens.length
              ? {
                  OR: tokens.map((t) => ({
                    memory: { contains: t, mode: "insensitive" },
                  })),
                }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { memory: true, createdAt: true },
        });
        console.log(
          "[remember]",
          JSON.stringify({ userId, query, tokens, found: memories.length }),
        );
        if (memories.length === 0) {
          if (query) {
            const recent = await prisma.userMemory.findMany({
              where: { userId },
              orderBy: { createdAt: "desc" },
              take: 5,
              select: { memory: true },
            });
            if (recent.length > 0) {
              return `No memories matched "${query}". Recent memories: ${recent
                .map((m) => m.memory)
                .join(" | ")}`;
            }
          }
          return "No memories found.";
        }
        return memories.map((m) => m.memory);
      },
    }),
  };
}