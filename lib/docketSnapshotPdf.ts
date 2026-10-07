/**
 * Server-side docket mail-snapshot: renders the snapshot HTML to a PDF
 * (puppeteer, via the existing generic `generateOfferLetterPdf`) and uploads it
 * to Google Drive, returning an `Attachment`-shaped row.
 *
 * Not pure — pulls puppeteer + Google APIs. Keep the pure parsing/HTML in
 * `lib/docketSnapshot.ts`.
 */

import { generateOfferLetterPdf } from "./generatePdf";
import { uploadFileToDrive } from "./gdrive";
import { buildDocketSnapshotHtml, type DocketSnapshotData } from "./docketSnapshot";

export interface SnapshotAttachmentRow {
  name: string;
  url: string;
  type: string;
  size: number;
}

/** Renders the snapshot HTML to a PDF buffer (no disk write). */
export async function generateDocketSnapshotPdf(data: DocketSnapshotData): Promise<Buffer> {
  const html = buildDocketSnapshotHtml(data);
  // The markup carries no Handlebars tokens, so the data arg is unused.
  return generateOfferLetterPdf(html, {} as never, {});
}

function snapshotFileName(docketNumber: string): string {
  return `${docketNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}_mail_snapshot.pdf`;
}

/** Generates the snapshot PDF and uploads it to Google Drive. */
export async function buildSnapshotAttachment(
  data: DocketSnapshotData,
): Promise<SnapshotAttachmentRow> {
  const buffer = await generateDocketSnapshotPdf(data);
  const name = snapshotFileName(data.docketNumber);
  const { url } = await uploadFileToDrive(name, "application/pdf", buffer.toString("base64"));
  return { name, url, type: "application/pdf", size: buffer.length };
}
