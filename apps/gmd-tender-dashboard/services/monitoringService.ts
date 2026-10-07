import fs from "fs";
import path from "path";
import type { UnmatchedTender, FolderMatch, FolderMatchResult } from "@/types/indexer";

const CONFIG = {
  reportsDir: path.resolve(process.cwd(), "data", "reports"),
  alertEmailRecipient: process.env.MONITOR_ALERT_EMAIL || "tender-alerts@gmdalui.co.in"
};

function ensureReportsDir(): void {
  fs.mkdirSync(CONFIG.reportsDir, { recursive: true });
}

export async function getUnmatchedDockets(): Promise<UnmatchedTender[]> {
  const matchesDbPath = path.resolve(process.cwd(), "data", "tender_folder_matches.json");
  const tenderCachePath = path.resolve(process.cwd(), "excel_cache", "last_sheet_fetch.json");

  if (!fs.existsSync(matchesDbPath) || !fs.existsSync(tenderCachePath)) {
    console.warn("[Monitor] Missing database or cache indexes. Cannot run scan.");
    return [];
  }

  try {
    const matches: Record<string, FolderMatchResult> = JSON.parse(
      await fs.promises.readFile(matchesDbPath, "utf-8")
    );
    const tenders: Record<string, unknown>[] = JSON.parse(
      await fs.promises.readFile(tenderCachePath, "utf-8")
    );

    const unmatchedList: UnmatchedTender[] = [];

    for (const tender of tenders) {
      const docketNo = tender.docketNo as string | undefined;

      if (docketNo && docketNo !== "-") {
        const matchInfo = matches[docketNo];

        if (!matchInfo || !matchInfo.folderFound) {
          unmatchedList.push({
            docketNo: parseInt(docketNo, 10) || docketNo,
            tenderNo: (tender.tenderNoNitNo as string) || "UNKNOWN",
            reason: "Folder not found"
          });
        }
      }
    }

    return unmatchedList;
  } catch (err) {
    console.error(`[Monitor] Failure running unmatched scanner: ${(err as Error).message}`);
    return [];
  }
}

export async function generateDailyReport(): Promise<string> {
  ensureReportsDir();
  const unmatched = await getUnmatchedDockets();
  const dateStr = new Date().toISOString().split("T")[0];
  const reportPath = path.join(CONFIG.reportsDir, `folder_gaps_report_${dateStr}.html`);

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>G M DALUI Folder Discrepancy Report - ${dateStr}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #334155; }
        h2 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
        .summary-box { background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #cbd5e1; }
        th { background-color: #f1f5f9; color: #475569; font-weight: 600; }
        tr:hover { background-color: #f8fafc; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background-color: #fee2e2; color: #991b1b; }
      </style>
    </head>
    <body>
      <h2>Tender Folder Gaps Audit Report</h2>
      <p>Report Compiled: <strong>${new Date().toLocaleString()}</strong></p>
      
      <div class="summary-box">
        <strong>Status Alert:</strong> Found <strong>${unmatched.length}</strong> active tender dockets in Google Sheets missing a physical network folder.
      </div>

      <table>
        <thead>
          <tr>
            <th>Docket No</th>
            <th>Tender Number</th>
            <th>Client Name</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${unmatched.map(item => `
            <tr>
              <td><strong>${item.docketNo}</strong></td>
              <td>${item.tenderNo}</td>
              <td>${(item as UnmatchedTender & { client?: string }).client || "-"}</td>
              <td><span class="badge">Missing Directory</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </body>
    </html>
  `;

  await fs.promises.writeFile(reportPath, htmlContent, "utf-8");
  console.log(`[Monitor] Daily HTML audit report generated at: ${reportPath}`);
  return reportPath;
}

export async function sendEmailAlert(unmatchedCount: number): Promise<boolean> {
  console.log(`[Mailer] Dispatching sync alert notification to: ${CONFIG.alertEmailRecipient}`);

  const mailDetails = {
    to: CONFIG.alertEmailRecipient,
    subject: `ALERT: ${unmatchedCount} Folder Gaps Detected in Tender Sync Pipeline`,
    body: `The synchronization pipeline has completed. We detected ${unmatchedCount} docket folder(s) missing from the network server. Please view the Daily Folder Gaps Report for details.`
  };

  console.log(`=========================================`);
  console.log(`MOCK EMAIL DISPATCH SENT`);
  console.log(`Subject: ${mailDetails.subject}`);
  console.log(`To:      ${mailDetails.to}`);
  console.log(`Body:    ${mailDetails.body}`);
  console.log(`=========================================`);

  return true;
}

import type { IncomingMessage, ServerResponse } from "http";

export async function getUnmatchedApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const list = await getUnmatchedDockets();

    if (list.length > 0) {
      await sendEmailAlert(list.length);
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      timestamp: Date.now(),
      count: list.length,
      data: list
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: (err as Error).message
    }));
  }
}
