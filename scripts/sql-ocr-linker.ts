import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("Scanning docket numbers in subject, body, attach_names, and OCR DATA via PostgreSQL...");

  // 1. Direct match in ocr_text for docketNumber
  const ocrMatches: any[] = await prisma.$queryRaw`
    SELECT 
      e."docketNumber",
      e."partyName",
      COUNT(DISTINCT t.id)::int as matched_threads_count,
      array_agg(DISTINCT t.id) as sample_thread_ids
    FROM "Enquiry" e
    JOIN docket_quotation_threads t ON (
      t.ocr_text ILIKE '%' || e."docketNumber" || '%'
      OR t.subject ILIKE '%' || e."docketNumber" || '%'
      OR t.body ILIKE '%' || e."docketNumber" || '%'
      OR t.attach_names::text ILIKE '%' || e."docketNumber" || '%'
    )
    GROUP BY e."docketNumber", e."partyName"
  `;

  console.log(`Enquiries matched via subject, body, attach_names, and OCR data: ${ocrMatches.length} / 555`);

  // Let's also check with flexible zero padding (e.g. GMD/2026-27/076 vs GMD/2026-27/76)
  const flexibleMatches: any[] = await prisma.$queryRaw`
    WITH normalized_enquiries AS (
      SELECT 
        id,
        "docketNumber",
        "partyName",
        -- Strip leading zeros after last slash: e.g. GMD/2026-27/076 -> GMD/2026-27/76
        regexp_replace("docketNumber", '/0+([1-9][0-9]*)$', '/\\1') as unpadded_docket,
        "docketNumber" as original_docket
      FROM "Enquiry"
    )
    SELECT 
      ne.original_docket,
      ne."partyName",
      COUNT(DISTINCT t.id)::int as thread_count
    FROM normalized_enquiries ne
    JOIN docket_quotation_threads t ON (
      t.ocr_text ILIKE '%' || ne.original_docket || '%'
      OR t.ocr_text ILIKE '%' || ne.unpadded_docket || '%'
      OR t.subject ILIKE '%' || ne.original_docket || '%'
      OR t.subject ILIKE '%' || ne.unpadded_docket || '%'
      OR t.body ILIKE '%' || ne.original_docket || '%'
      OR t.body ILIKE '%' || ne.unpadded_docket || '%'
      OR t.attach_names::text ILIKE '%' || ne.original_docket || '%'
      OR t.attach_names::text ILIKE '%' || ne.unpadded_docket || '%'
    )
    GROUP BY ne.original_docket, ne."partyName"
  `;

  console.log(`Enquiries matched including flexible unpadded dockets across OCR & text: ${flexibleMatches.length} / 555`);
}

main().then(() => process.exit(0)).catch(console.error);
