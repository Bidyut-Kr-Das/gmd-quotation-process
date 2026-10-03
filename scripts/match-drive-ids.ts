import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const sampleAttachments = await prisma.attachment.findMany({
    take: 10,
    select: {
      id: true,
      name: true,
      url: true,
      enquiryId: true,
      enquiry: { select: { docketNumber: true, partyName: true } }
    }
  });

  console.log("Sample 10 Enquiry Attachments:");
  for (const a of sampleAttachments) {
    console.log(`Docket: "${a.enquiry.docketNumber}" | Name: "${a.name}" | URL: "${a.url}"`);
  }

  // Let's test if any attachment URL/ID matches in docket_quotation_threads
  // Extract drive file IDs from Enquiry attachments
  const allEnqAttachments = await prisma.attachment.findMany({
    select: {
      name: true,
      url: true,
      enquiry: { select: { docketNumber: true } }
    }
  });

  console.log(`\nTotal Enquiry attachments in DB: ${allEnqAttachments.length}`);

  // Test first 20 attachment URLs against docket_quotation_threads.attachLinks or ocrText
  let matchedByUrl = 0;
  for (const att of allEnqAttachments) {
    // Extract ID from URL: e.g. drive.google.com/file/d/XYZ/... or id=XYZ
    const idMatch = att.url.match(/[-\w]{25,}/);
    const driveId = idMatch ? idMatch[0] : "";
    if (!driveId) continue;

    const threadMatch = await prisma.docketQuotationThread.findFirst({
      where: {
        OR: [
          { attachLinks: { string_contains: driveId } },
          { ocrText: { contains: driveId } },
          { body: { contains: driveId } },
        ]
      },
      select: { id: true, docketNo: true, subject: true }
    });

    if (threadMatch) {
      matchedByUrl++;
      if (matchedByUrl <= 10) {
        console.log(`MATCH BY DRIVE ID! Enq Docket: ${att.enquiry.docketNumber} -> Thread ${threadMatch.id} (Existing Docket: ${threadMatch.docketNo}, Subj: ${threadMatch.subject?.slice(0, 50)})`);
      }
    }
  }

  console.log(`Total attachments matched by Drive File ID: ${matchedByUrl} / ${allEnqAttachments.length}`);
}

main().then(() => process.exit(0)).catch(console.error);
