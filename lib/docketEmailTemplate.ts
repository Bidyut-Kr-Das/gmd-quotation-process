/**
 * HTML body for the docket quotation email sent through n8n.
 *
 * Kept dependency-free so it can run inside the `sendDocketEmail` server action.
 * The markup is table-based and inline-styled for email-client compatibility;
 * swap the visual format here without touching the send pipeline.
 */

export interface DocketEmailData {
  docketNumber: string;
  /** Project / reference shown in the opening sentence (optional). */
  projectName?: string;
  /** Short description of the requested items (optional). */
  itemDescription?: string;
  paymentTerms?: string;
  freight?: string;
  deliverySchedule?: string;
  /** Public URL of the Offer PDF (Drive "anyone with link" link). */
  pdfUrl: string;
  /** Attachment file name, used as the fallback link label. */
  fileName: string;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDocketEmailSubject(data: Pick<DocketEmailData, "docketNumber">): string {
  return `Offer - ${data.docketNumber}`;
}

function termRow(label: string, value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return `<tr>
                <td width="25%" style="padding:9px 0; color:#666666; border-bottom:1px solid #dddddd;">${esc(label)}</td>
                <td style="padding:9px 0; border-bottom:1px solid #dddddd;">${esc(v)}</td>
              </tr>`;
}

export function buildDocketEmailHtml(data: DocketEmailData): string {
  const docket = data.docketNumber;
  const project = (data.projectName ?? "").trim();
  const itemDescription = (data.itemDescription ?? "").trim();

  const projectSentence = project
    ? `<p style="margin:0 0 16px 0;">Thank you for sending the RFQ for the ${esc(project)} project.</p>`
    : "";

  const itemClause = itemDescription
    ? ` for the requested ${esc(itemDescription)}`
    : "";

  const terms = [
    termRow("Quotation Reference", docket),
    termRow("Payment Terms", data.paymentTerms),
    termRow("Freight", data.freight),
    termRow("Taxes/GST", "AS PER OFFER"),
    termRow("Delivery Schedule", data.deliverySchedule),
    termRow("Validity of Offer", "30 days"),
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offer - ${esc(docket)}</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#222222;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr>
    <td align="left" valign="top" style="padding:24px 28px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">

        <!-- Greeting & intro -->
        <tr>
          <td style="font-size:15px; line-height:1.7; color:#222222;">
            <p style="margin:0 0 16px 0;">Dear Sir,</p>
            ${projectSentence}
            <p style="margin:0;">
              Please find our detailed offer below as per reference <strong>${esc(docket)}</strong>${itemClause}.
            </p>
          </td>
        </tr>

        <!-- View Quotation button -->
        <tr>
          <td align="left" style="padding:22px 0;">
            <a href="${esc(data.pdfUrl)}" target="_blank"
               style="display:inline-block; background:#222222; color:#ffffff; font-size:14px; font-weight:bold; text-decoration:none; padding:12px 40px; border-radius:4px;">
              View Quotation
            </a>
          </td>
        </tr>

        <!-- Commercial terms -->
        <tr>
          <td style="font-size:15px; font-weight:bold; color:#222222; padding-bottom:8px;">
            Commercial Terms &amp; Conditions
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px; border-top:1px solid #dddddd;">
              ${terms}
            </table>
          </td>
        </tr>

        <!-- Closing -->
        <tr>
          <td style="font-size:15px; line-height:1.7; color:#222222;">
            <p style="margin:0 0 16px 0;">Please let us know if you require any further clarification or technical specifications.</p>
            <p style="margin:0 0 20px 0; font-style:italic;">Please feel free to contact for any clarifications.</p>
          </td>
        </tr>

        <!-- Signature -->
        <tr>
          <td style="padding-top:16px; border-top:1px solid #dddddd; font-size:15px; line-height:1.7; color:#222222;">
            <div>Thanks &amp; Regards,</div>
            <div style="font-weight:bold; padding-top:6px;">Puja Agarwal</div>
            <div>GM Dalui</div>
            <div style="font-size:14px; padding-top:2px;">+91 88200 44755</div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}
