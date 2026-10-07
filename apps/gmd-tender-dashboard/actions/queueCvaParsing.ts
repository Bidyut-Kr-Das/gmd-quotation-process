"use server";

import { prisma } from "@/lib/prisma";
import { publishTenderParsingTask } from "@/lib/queue/publisher";
import { describeTenderFile } from "@/lib/tenderFileDescriptor";

export async function queueAllCvaParsing(): Promise<{ queued: number }> {
  const tenders = await prisma.tenderMerged.findMany({
    where: {
      tenderType: "GEM",
      tenderFiles: { some: { tags: { has: "costingAttachment" } } },
    },
    select: {
      id: true,
      referenceNo: true,
      tenderFiles: {
        where: { tags: { has: "costingAttachment" } },
        select: { source: true, url: true },
        take: 1,
      },
    },
  });

  let queued = 0;
  for (const t of tenders) {
    const tenderFile = t.tenderFiles[0];
    if (!tenderFile) continue;
    const { file_type, decrypted_fileId } = describeTenderFile(tenderFile);
    if (!decrypted_fileId) continue;
    const ok = await publishTenderParsingTask({
      type: "COSTING_ATTACHMENT_PARSING",
      tenderId: t.id,
      referenceNo: t.referenceNo ?? undefined,
      file_link: tenderFile.url ?? "",
      file_type,
      decrypted_fileId,
      timestamp: Date.now(),
    });
    if (ok) queued++;
  }
  return { queued };
}
