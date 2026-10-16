import fs from "fs";
import { prisma } from "@/lib/prisma";
import { resolveSupplyPath } from "@/controllers/tenderAttachmentController";

interface UniqueFileEntry {
  filePath: string;
  filename: string;
}

export async function getUniqueSupplyDocuments(
  saleBillNumbers: string[]
): Promise<UniqueFileEntry[]> {
  const docs = await prisma.supplyDoc.findMany({
    where: {
      saleBillNumber: { in: saleBillNumbers.map(s => s.trim().toUpperCase()) },
    },
    orderBy: { fileName: "asc" },
  });

  const seenFilenames = new Set<string>();
  const results: UniqueFileEntry[] = [];

  for (const doc of docs) {
    if (seenFilenames.has(doc.fileName)) continue;
    const resolvedPath = resolveSupplyPath(doc.filePath);
    if (!fs.existsSync(resolvedPath)) continue;
    seenFilenames.add(doc.fileName);
    results.push({ filePath: resolvedPath, filename: doc.fileName });
  }

  return results;
}
