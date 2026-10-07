import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Starting fast SQL matching diagnostics...");

  // 1. Direct Drive ID match
  const driveMatches: any[] = await prisma.$queryRaw`
    SELECT 
      e.id as enquiry_id,
      e."docketNumber" as enquiry_docket,
      e."partyName" as enquiry_party,
      t.id as thread_id,
      t.docket_no as thread_docket,
      t.subject as thread_subject
    FROM "Attachment" a
    JOIN "Enquiry" e ON a."enquiryId" = e.id
    JOIN docket_quotation_threads t ON (
      t.attach_links::text ILIKE '%' || substring(a.url from 'id=([a-zA-Z0-9_-]{20,})') || '%'
      OR (
        substring(a.url from 'id=([a-zA-Z0-9_-]{20,})') IS NOT NULL
        AND t.attach_links::text ILIKE '%' || substring(a.url from 'id=([a-zA-Z0-9_-]{20,})') || '%'
      )
    )
    LIMIT 20;
  `;

  console.log(`Drive link matches found: ${driveMatches.length}`);
  for (const m of driveMatches) {
    console.log(`Enquiry: ${m.enquiry_docket} (${m.enquiry_party}) <--> Thread ${m.thread_id}: [${m.thread_docket}] ${m.thread_subject?.slice(0, 60)}`);
  }

  // 2. Check how many threads mention the docket number in subject, body_preview, or attach_names
  const textMatches: any[] = await prisma.$queryRaw`
    SELECT 
      e.id as enquiry_id,
      e."docketNumber" as enquiry_docket,
      e."partyName" as enquiry_party,
      t.id as thread_id,
      t.docket_no as thread_docket,
      t.subject as thread_subject
    FROM "Enquiry" e
    JOIN docket_quotation_threads t ON (
      t.subject ILIKE '%' || e."docketNumber" || '%'
      OR t.body_preview ILIKE '%' || e."docketNumber" || '%'
      OR t.attach_names::text ILIKE '%' || e."docketNumber" || '%'
    )
    WHERE t.docket_no IS NULL OR t.docket_no != e."docketNumber"
    LIMIT 20;
  `;

  console.log(`\nDirect text matches (unlinked or differently linked): ${textMatches.length}`);
  for (const m of textMatches) {
    console.log(`Enquiry: ${m.enquiry_docket} <--> Thread ${m.thread_id}: [${m.thread_docket}] ${m.thread_subject?.slice(0, 60)}`);
  }
}

main().then(() => process.exit(0)).catch(console.error);
