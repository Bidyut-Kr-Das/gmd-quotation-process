import "server-only"
import { z } from "zod"
import fs from "fs"
import path from "path"
import { format } from "date-fns"
import { parseDate } from "@/lib/parse-date"
import { describeTenderFile } from "@/lib/tenderFileDescriptor"
import { resolvePortablePath } from "@/lib/pathUtils"

export interface EmdWebhookItem {
  sl: number
  name: string | null
  qty: string | null
  unit: string | null
}

export interface EmdWebhookBank {
  accountName?: string | null
  bankName?: string | null
  accountNo?: string | null
  ifsc?: string | null
}

export interface EmdWebhookPayload {
  tenderEnquiryNo: string
  tenderReferenceNo: string
  clientName: string | null
  itemDescription: string | null
  itemList: EmdWebhookItem[]
  bidSubmissionEndDate: string | null
  tenderFeeLastDate: string | null
  tenderFee: string | null
  bank: EmdWebhookBank
  emdAmount: string | null
  bgValidityDays: number | null
  bgInstructions: string | null
  hardCopySubmissionDate: string | null
  remarks: string | null
  hasAttachments: boolean
  senderName: string
  senderDesignation: string | null
  companyName: string | null
  fileUrls: string[]
}

export interface EmdWebhookAttachment {
  buffer: Buffer
  filename: string
}

export interface EmdWebhookAttachmentFile {
  source: string | null
  url: string | null
  name: string
  extension: string
}

function resolveNetworkFilePath(decrypted: string): string {
  const pipeIdx = decrypted.indexOf("|")
  if (pipeIdx === -1) {
    const supplyRoot = process.env.SUPPLY_NETWORK_PATH
    const driveMatch = decrypted.match(/^[a-zA-Z]:\\/)
    if (supplyRoot && driveMatch) {
      return path.resolve(
        supplyRoot.replace(/\\+$/, "") + "\\" + decrypted.substring(3),
      )
    }
    // Normalize backslashes for Linux hosts (tokens created on Windows)
    return path.resolve(decrypted.replace(/\\/g, "/"))
  }
  const type = decrypted.slice(0, pipeIdx)
  const relative = decrypted.slice(pipeIdx + 1)
  let base: string
  if (type === "condutor") {
    base = process.env.CONDUTOR_PATH ?? ""
  } else if (type === "RA_COSTING_FILE") {
    base = process.env.OLD_RA_EXCEL_PATH ?? process.env.INDEXER_NETWORK_PATH ?? ""
  } else {
    base = process.env.INDEXER_NETWORK_PATH ?? ""
  }
  if (!base) throw new Error(`Unable to resolve base path for type "${type}"`)
  return resolvePortablePath(base, relative)
}

export async function resolveEmdAttachment(
  file: EmdWebhookAttachmentFile,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const filename =
    file.name + (file.extension ? `.${file.extension}` : "")

  try {
    const descriptor = describeTenderFile(file)

    if (descriptor.file_type === "network") {
      const absolutePath = resolveNetworkFilePath(descriptor.decrypted_fileId)
      if (!fs.existsSync(absolutePath)) {
        console.warn(`[n8n] Attachment not found on disk: ${absolutePath}`)
        return null
      }
      const buffer = await fs.promises.readFile(absolutePath)
      return { buffer, filename }
    }

    const response = await fetch(descriptor.decrypted_fileId)
    if (!response.ok) {
      console.warn(
        `[n8n] Attachment fetch returned ${response.status}: ${descriptor.decrypted_fileId}`,
      )
      return null
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    return { buffer, filename }
  } catch (error) {
    console.warn(`[n8n] Failed to resolve attachment "${filename}":`, error)
    return null
  }
}

function appendFormField(
  formData: FormData,
  key: string,
  value: string | number | boolean | null,
): void {
  formData.append(key, value == null ? "" : String(value))
}

export async function triggerEmdPaymentWebhook(
  payload: EmdWebhookPayload,
  attachments: EmdWebhookAttachment[] = [],
) {
  const url = process.env.N8N_EMD_WEBHOOK_URL
  console.log(process.env.N8N_EMD_WEBHOOK_URL)
  if (!url) {
    console.warn("[n8n] N8N_EMD_WEBHOOK_URL not configured, skipping webhook")
    return
  }

  console.log(`EMD webhook triggered for referenceNo ${payload.tenderReferenceNo}`)

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log("[n8n] EMD webhook payload:", JSON.stringify(payload, null, 2))
  }

  try {
    let response: Response

    if (payload.hasAttachments && attachments.length > 0) {
      const formData = new FormData()
      appendFormField(formData, "tenderEnquiryNo", payload.tenderEnquiryNo)
      appendFormField(formData, "tenderReferenceNo", payload.tenderReferenceNo)
      appendFormField(formData, "clientName", payload.clientName)
      appendFormField(formData, "itemDescription", payload.itemDescription)
      formData.append("itemList", JSON.stringify(payload.itemList))
      appendFormField(formData, "bidSubmissionEndDate", payload.bidSubmissionEndDate)
      appendFormField(formData, "tenderFeeLastDate", payload.tenderFeeLastDate)
      appendFormField(formData, "tenderFee", payload.tenderFee)
      formData.append("bank", JSON.stringify(payload.bank))
      appendFormField(formData, "emdAmount", payload.emdAmount)
      appendFormField(formData, "bgValidityDays", payload.bgValidityDays)
      appendFormField(formData, "bgInstructions", payload.bgInstructions)
      appendFormField(formData, "hardCopySubmissionDate", payload.hardCopySubmissionDate)
      appendFormField(formData, "remarks", payload.remarks)
      appendFormField(formData, "hasAttachments", payload.hasAttachments)
      appendFormField(formData, "senderName", payload.senderName)
      appendFormField(formData, "senderDesignation", payload.senderDesignation)
      appendFormField(formData, "companyName", payload.companyName)
      formData.append("fileUrls", JSON.stringify(payload.fileUrls))

      for (const attachment of attachments) {
        const { buffer } = attachment
        const arrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer
        formData.append("attachments", new Blob([arrayBuffer]), attachment.filename)
      }

      response = await fetch(url, {
        method: "POST",
        body: formData,
      })
    } else {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    }

    console.log(`[n8n] EMD webhook response status: ${response.status}`)

    if (!response.ok) {
      console.error(`[n8n] EMD webhook returned ${response.status}: ${await response.text()}`)
    }
  } catch (error) {
    console.error("[n8n] EMD webhook failed:", error)
  }
}

export const TenderItemSchema = z.object({
  description: z.string().min(1, "Item description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required"),
})

export const AttachmentSchema = z.object({
  url: z.string().url("Invalid attachment URL"),
  fileName: z.string().min(1, "File name is required"),
})

export const TenderApprovalMailRequestSchema = z.object({
  to: z.array(z.string().email("Invalid email in 'to'")).min(1, "At least one recipient is required"),
  cc: z.array(z.string().email("Invalid email in 'cc'")).optional(),
  subject: z.string().min(1, "Subject is required"),

  tenderEnquiryNo: z.string().min(1, "Tender enquiry number is required"),
  rfxNo: z.string().min(1, "RFX number is required"),

  itemDescription: z.string().min(1, "Item description is required"),

  bidSubmissionEndDate: z.string().min(1, "Bid submission end date is required"),
  extensionRemark: z.string().optional(),
  lastTenderFeePaymentDate: z.string().min(1, "Last tender fee payment date is required"),

  tenderFee: z.string().min(1, "Tender fee is required"),

  bankDetails: z.string().optional(),

  emdAmount: z.string().min(1, "EMD amount is required"),
  bgValidity: z.string().optional(),
  hardCopySubmissionDate: z.string().optional(),

  items: z.array(TenderItemSchema).min(1, "At least one item is required"),
  attachments: z.array(AttachmentSchema).optional(),
})

export type TenderApprovalMailRequest = z.infer<typeof TenderApprovalMailRequestSchema>

export interface MailWebhookResult {
  success: boolean
  message: string
  errors?: { field: string; message: string }[]
}

export async function triggerRequisitionEmailWebhook(
  payload: TenderApprovalMailRequest,
): Promise<MailWebhookResult> {
  const validation = TenderApprovalMailRequestSchema.safeParse(payload)
  if (!validation.success) {
    const errors = validation.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }))
    return { success: false, message: "Validation failed", errors }
  }

  const url = process.env.REQUISITION_EMAIL_N8N_WEBHOOK_URL
  if (!url) {
    return { success: false, message: "REQUISITION_EMAIL_N8N_WEBHOOK_URL not configured" }
  }

  console.log(`[n8n] Requisition email webhook triggered for tender ${validation.data.tenderEnquiryNo}`)

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log("[n8n] Requisition email webhook payload:", JSON.stringify(validation.data, null, 2))
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validation.data),
    })

    console.log(`[n8n] Requisition email webhook response status: ${response.status}`)

    if (!response.ok) {
      const text = await response.text()
      console.error(`[n8n] Requisition email webhook returned ${response.status}: ${text}`)
      return { success: false, message: `Webhook returned ${response.status}: ${text}` }
    }

    return { success: true, message: "Requisition email webhook triggered successfully" }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[n8n] Requisition email webhook failed:", error)
    return { success: false, message: `Webhook failed: ${msg}` }
  }
}

export interface ReverseAuctionWebhookData {
  tenderMergedId: number
  organization: string | null
  docketNo: string | null
  referenceNo: string | null
  reverseAuctionApplicable: boolean | null
  reverseAuctionStartDate: Date | string | null
  reverseAuctionEndDate: Date | string | null
  associateName: string | null
  associateEmail: string | null
}

export interface ReverseAuctionWebhookPayload {
  organization: string | null
  docketNo: string | null
  referenceNo: string | null
  startDate: string | null
  endDate: string | null
  associateName: string | null
  associateEmail: string | null
}

export interface EmdEmailWebhookPayload {
  to: string;
  subject: string;
  body: string;
  html: string;
  reason?: string | null;
  tenderNo?: string | null;
  bgNo?: string | null;
  id: string;
}

export async function triggerEmdEmailWebhook(payload: EmdEmailWebhookPayload): Promise<MailWebhookResult> {
  const url = process.env.N8N_EMD_WEBHOOK_URL;
  if (!url) {
    return { success: false, message: "N8N_EMD_WEBHOOK_URL not configured" };
  }

  console.log(`[n8n] EMD email webhook triggered for id ${payload.id} to ${payload.to}`);

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log("[n8n] EMD email webhook payload:", JSON.stringify({ to: payload.to, subject: payload.subject, reason: payload.reason, tenderNo: payload.tenderNo, bgNo: payload.bgNo }, null, 2));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log(`[n8n] EMD email webhook response status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[n8n] EMD email webhook returned ${response.status}: ${text}`);
      return { success: false, message: `Webhook returned ${response.status}: ${text}` };
    }

    return { success: true, message: "EMD email webhook triggered successfully" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[n8n] EMD email webhook failed:", error);
    return { success: false, message: `Webhook failed: ${msg}` };
  }
}

export interface CertificateEmailPayload {
  to: string
  cc: string[]
  partyRefNo: string
  partyName: string
  fy: string
  invoiceAmt: string
  fileName: string
  driveUrl: string
  itemCount: number
}

export async function triggerCertificateEmailWebhook(
  payload: CertificateEmailPayload,
  pdfBuffer: Buffer,
): Promise<MailWebhookResult> {
  const url = process.env.N8N_CERTIFICATE_EMAIL_WEBHOOK_URL || process.env.N8N_CERTIFICATE_WEBHOOK_URL
  if (!url) {
    return { success: false, message: "N8N_CERTIFICATE_EMAIL_WEBHOOK_URL not configured" }
  }

  console.log(`[n8n] Certificate email webhook triggered for partyRefNo ${payload.partyRefNo} to ${payload.to} cc ${payload.cc.length}`)

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log("[n8n] Certificate email payload:", JSON.stringify({ ...payload, pdfSize: pdfBuffer.length }, null, 2))
  }

  try {
    // Reuse Emd pattern: FormData with file attachment
    const formData = new FormData()
    appendFormField(formData, "to", payload.to)
    formData.append("cc", JSON.stringify(payload.cc))
    appendFormField(formData, "partyRefNo", payload.partyRefNo)
    appendFormField(formData, "partyName", payload.partyName)
    appendFormField(formData, "fy", payload.fy)
    appendFormField(formData, "invoiceAmt", payload.invoiceAmt)
    appendFormField(formData, "fileName", payload.fileName)
    appendFormField(formData, "driveUrl", payload.driveUrl)
    appendFormField(formData, "itemCount", payload.itemCount)
    // Also send structured JSON for n8n convenience
    formData.append("payload", JSON.stringify(payload))

    const arrayBuffer = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength) as ArrayBuffer
    formData.append("attachments", new Blob([arrayBuffer], { type: "application/pdf" }), payload.fileName)
    // Also as 'file' alias for n8n compatibility
    formData.append("file", new Blob([arrayBuffer], { type: "application/pdf" }), payload.fileName)

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    })

    console.log(`[n8n] Certificate email webhook response status: ${response.status}`)

    if (!response.ok) {
      const text = await response.text()
      console.error(`[n8n] Certificate email webhook returned ${response.status}: ${text}`)
      return { success: false, message: `Webhook returned ${response.status}: ${text}` }
    }

    return { success: true, message: "Certificate email webhook triggered successfully" }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[n8n] Certificate email webhook failed:", error)
    return { success: false, message: `Webhook failed: ${msg}` }
  }
}

export async function triggerReverseAuctionWebhook(
  data: ReverseAuctionWebhookData,
): Promise<boolean> {
  const url = process.env.N8N_RA_WEBHOOK_URL
  console.log(process.env.N8N_RA_WEBHOOK_URL)
  if (!url) {
    console.warn(
      "[n8n] N8N_RA_WEBHOOK_URL not configured, skipping reverse auction webhook",
    )
    return false
  }

  const start = data.reverseAuctionStartDate
    ? parseDate(data.reverseAuctionStartDate)
    : null
  const end = data.reverseAuctionEndDate
    ? parseDate(data.reverseAuctionEndDate)
    : null

  if (
    data.reverseAuctionApplicable !== true ||
    !start ||
    isNaN(start.getTime()) ||
    !end ||
    isNaN(end.getTime())
  ) {
    return false
  }

  const payload: ReverseAuctionWebhookPayload = {
    organization: data.organization,
    docketNo: data.docketNo,
    referenceNo: data.referenceNo,
    startDate: format(start, "dd-MM-yyyy HH:mm"),
    endDate: format(end, "dd-MM-yyyy HH:mm"),
    associateName: data.associateName,
    associateEmail: data.associateEmail,
  }

  console.log(
    `[n8n] Reverse auction webhook triggered for referenceNo ${data.referenceNo}`,
  )

  if (process.env.ENVIRONMENT !== "PROD") {
    console.log(
      "[n8n] Reverse auction webhook payload:",
      JSON.stringify(payload, null, 2),
    )
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    console.log(
      `[n8n] Reverse auction webhook response status: ${response.status}`,
    )

    if (!response.ok) {
      console.error(
        `[n8n] Reverse auction webhook returned ${response.status}: ${await response.text()}`,
      )
      return false
    }

    return true
  } catch (error) {
    console.error("[n8n] Reverse auction webhook failed:", error)
    return false
  }
}
