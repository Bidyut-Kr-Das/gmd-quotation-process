import puppeteer, { type Page } from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";
import { uploadFileToDrive } from "@/lib/gdrive";

export interface TenderItem {
  id: number;
  gemId: string;
}

export interface DownloadResult {
  id: number;
  gemId: string;
  success: boolean;
  pdfPath?: string;
  error?: string;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sleepForAnimation(ms: number) {
  return delay(ms);
}

async function waitForBidLink(
  page: Page,
  gemId: string,
  timeout = 20000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const clicked = await page.evaluate((targetGemId) => {
      const links = Array.from(document.querySelectorAll("a"));
      const link = links.find((l) =>
        l.textContent?.includes(targetGemId),
      );
      if (link instanceof HTMLElement) {
        link.click();
        return true;
      }
      return false;
    }, gemId);
    if (clicked) return true;
    await delay(1000);
  }
  return false;
}

async function isNoDataFound(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.body.innerText.includes("No data found"),
  );
}

async function performSearch(page: Page, gemId: string, checkBidRaStatus = false): Promise<void> {
  await page.goto("https://bidplus.gem.gov.in/all-bids", {
    waitUntil: "networkidle2",
  });
  await page.locator("#searchBid").setTimeout(20000).fill(gemId);
  await sleepForAnimation(1000);
  await page.evaluate(() => {
    (window as any).searchType("exact");
  });
  await sleepForAnimation(1000);
  if (checkBidRaStatus) {
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label, span"));
      const label = labels.find((l) =>
        l.textContent?.toUpperCase().includes("BID/RA STATUS"),
      );
      if (!label) return;
      const input =
        document.getElementById(label.getAttribute("for") || "") ||
        label.querySelector("input");
      if (input instanceof HTMLInputElement && !input.checked) {
        input.click();
      }
    });
    await sleepForAnimation(1000);
  }
  await page.keyboard.press("Enter");
}

async function downloadPdfDirectly(
  url: string,
  page: Page,
  savePath: string,
): Promise<boolean> {
  try {
    const cookies = await page.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers: Record<string, string> = {};
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(url, { headers });
    if (!response.ok) return false;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 100) return false;

    fs.writeFileSync(savePath, buffer);
    return true;
  } catch {
    return false;
  }
}

async function detectChromePath(): Promise<string> {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(
      /* turbopackIgnore: true */
      p,
    )) return p;
  }
  throw new Error(
    "Chrome not found. Please install Chrome or set CHROME_PATH env variable.",
  );
}

async function processTender(
  page: Page,
  tender: TenderItem,
): Promise<DownloadResult> {
  const folderName = tender.gemId.replace(/[\/\\]/g, "-");
  const downloadPath = path.join(os.tmpdir(), "gem-pdf-downloads", folderName);

  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true });
  }

  try {
    try { console.log(`Processing ${tender.gemId}`); } catch {}

    await performSearch(page, tender.gemId, false);

    let found = await waitForBidLink(page, tender.gemId, 20000);
    if (!found) {
      try { console.log(`  ${tender.gemId}: link not found without Bid/RA Status, retrying with checklist`); } catch {}
      await performSearch(page, tender.gemId, true);
      found = await waitForBidLink(page, tender.gemId, 20000);
      if (!found) {
        const noData = await isNoDataFound(page);
        if (noData) {
          try { console.error(`  ${tender.gemId}: no data found for this bid`); } catch {}
          return {
            id: tender.id,
            gemId: tender.gemId,
            success: false,
            error: "No data found for bid",
          };
        }
        try { console.error(`  ${tender.gemId}: bid link not found`); } catch {}
        return {
          id: tender.id,
          gemId: tender.gemId,
          success: false,
          error: "Bid link not found",
        };
      }
      try { console.log(`  ${tender.gemId}: found after enabling Bid/RA Status checklist`); } catch {}
    }

    try { console.log(`  ${tender.gemId}: bid link found`); } catch {}

    await sleepForAnimation(5000);

    let lastError: unknown;
    let succeeded = false;
    let result: DownloadResult | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          try { console.log(`  ${tender.gemId}: retrying download (attempt ${attempt}/3)`); } catch {}
          await performSearch(page, tender.gemId, true);
          const refound = await waitForBidLink(page, tender.gemId, 20000);
          if (!refound) {
            try { console.error(`  ${tender.gemId}: bid link gone on retry`); } catch {}
            return {
              id: tender.id,
              gemId: tender.gemId,
              success: false,
              error: "Bid link not found on retry",
            };
          }
          await sleepForAnimation(5000);
        }

        const downloadInfo = await page.evaluate((targetGemId: string) => {
          const links = Array.from(document.querySelectorAll("a"));
          const lowerId = targetGemId.toLowerCase();
          const match = links.find((l) =>
            l.textContent?.toLowerCase().includes(lowerId),
          );
          return {
            url: match?.getAttribute("href") || null,
            text: match?.textContent?.trim() || null,
          };
        }, tender.gemId);

        if (!downloadInfo.url) {
          try { console.error(`  ${tender.gemId}: download link not found on bid detail page`); } catch {}
          return {
            id: tender.id,
            gemId: tender.gemId,
            success: false,
            error: "Download link not found",
          };
        }

        try { console.log(`  ${tender.gemId}: found download link — "${downloadInfo.text}"`); } catch {}

        const absoluteUrl = new URL(downloadInfo.url, page.url()).href;
        const pdfSavePath = path.join(downloadPath, `${folderName}.pdf`);

        const downloaded = await downloadPdfDirectly(absoluteUrl, page, pdfSavePath);
        if (!downloaded) {
          try { console.error(`  ${tender.gemId}: failed to download PDF from ${absoluteUrl}`); } catch {}
          return {
            id: tender.id,
            gemId: tender.gemId,
            success: false,
            error: "PDF download failed",
          };
        }

        try { console.log(`  ${tender.gemId}: PDF downloaded, uploading to Google Drive...`); } catch {}

        const pdfBuffer = fs.readFileSync(pdfSavePath);
        const base64Data = pdfBuffer.toString("base64");

        const uploadResult = await uploadFileToDrive(
          `${folderName}.pdf`,
          "application/pdf",
          base64Data,
        );

        if (uploadResult.success) {
          try { console.log(`  ${tender.gemId}: uploaded to Drive: ${uploadResult.url}`); } catch {}
          result = {
            id: tender.id,
            gemId: tender.gemId,
            success: true,
            pdfPath: uploadResult.url,
          };
          succeeded = true;
          break;
        }

        try { console.error(`  ${tender.gemId}: Google Drive upload returned failure`); } catch {}
        return {
          id: tender.id,
          gemId: tender.gemId,
          success: false,
          error: "Google Drive upload returned failure",
        };
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          try { console.log(`  ${tender.gemId}: error on attempt ${attempt}, retrying (${attempt + 1}/3)`); } catch {}
        } else {
          try { console.error(`  ${tender.gemId}: failed after 3 retries — ${err instanceof Error ? err.message : String(err)}`); } catch {}
          return {
            id: tender.id,
            gemId: tender.gemId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    if (succeeded && result) {
      return result;
    }

    return {
      id: tender.id,
      gemId: tender.gemId,
      success: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  } finally {
    try {
      const files = fs.readdirSync(downloadPath);
      for (const f of files) {
        fs.unlinkSync(path.join(downloadPath, f));
      }
      fs.rmdirSync(downloadPath, { recursive: true });
    } catch {}
  }
}

export async function downloadGemPdfs(
  tenders: TenderItem[],
  onProgress?: (current: number, total: number) => void,
): Promise<DownloadResult[]> {
  const chromePath = process.env.CHROME_PATH || (await detectChromePath());

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  const results: DownloadResult[] = [];

  try {
    const page = await browser.newPage();

    for (let i = 0; i < tenders.length; i++) {
      const tender = tenders[i];
      const result = await processTender(page, tender);
      results.push(result);
      try { onProgress?.(i + 1, tenders.length); } catch {}
    }

    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}
