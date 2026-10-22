import { chromium } from "playwright";
import { createWorker, PSM } from "tesseract.js";
import fs from "fs";
import path from "path";
import { Jimp } from "jimp";
import { prisma } from "@/lib/prisma";

const TESSERACT_WORKER_PATH =
  "D:\\tender-executive-dashboard\\v2\\node_modules\\tesseract.js\\src\\worker-script\\node\\index.js";

const CAPTCHA_DEBUG_DIR = path.join(process.cwd(), "captcha-debug");

export interface NonGemTenderItem {
  id: number;
  referenceNo: string;
  tenderStatusId: number | null;
  website: string | null;
}

export interface NonGemSearchResult {
  id: number;
  referenceNo: string;
  success: boolean;
  captchaDetected?: string;
  error?: string;
}

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Chromium\\Application\\chrome.exe",
];

function detectChromePath(): string {
  const envPath = process.env.CHROME_PATH;
  if (envPath && fs.existsSync(
    /* turbopackIgnore: true */
    envPath,
  )) return envPath;
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(
      /* turbopackIgnore: true */
      p,
    )) return p;
  }
  throw new Error(
    "Chrome not found. Please install Chrome or set CHROME_PATH env variable.",
  );
}

async function waitForCaptchaImage(page: import("playwright").Page) {
  await page.waitForSelector("#captchaImage", { timeout: 10000 });
}

async function screenshotCaptchaElement(
  page: import("playwright").Page,
): Promise<Buffer | null> {
  const el = await page.$("#captchaImage");
  if (!el) return null;
  return await el.screenshot({ type: "png" });
}

async function preprocessCaptcha(buf: Buffer): Promise<Buffer> {
  const image = await Jimp.read(buf);
  image.greyscale().contrast(1).posterize(2).invert();
  return await image.getBuffer("image/png");
}

async function ocrCaptchaFromPage(
  page: import("playwright").Page,
  attempt: number,
): Promise<string> {
  await waitForCaptchaImage(page);
  console.log("  [Captcha] Screenshotting #captchaImage...");
  const rawBuf = await screenshotCaptchaElement(page);
  if (!rawBuf || rawBuf.length < 100) {
    console.warn("  [Captcha] Empty screenshot!");
    return "";
  }
  console.log(`  [Captcha] Raw: ${rawBuf.length} bytes`);

  let procBuf: Buffer;
  try {
    procBuf = await preprocessCaptcha(rawBuf);
  } catch (e: any) {
    console.warn("  [Captcha] Preprocessing failed, using raw:", e.message);
    procBuf = rawBuf;
  }

  if (!fs.existsSync(CAPTCHA_DEBUG_DIR)) {
    fs.mkdirSync(CAPTCHA_DEBUG_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(CAPTCHA_DEBUG_DIR, `captcha_raw_${attempt}.png`), rawBuf);
  fs.writeFileSync(path.join(CAPTCHA_DEBUG_DIR, `captcha_proc_${attempt}.png`), procBuf);

  console.log("  [Captcha] Running Tesseract (PSM 7, no dict)...");
  const worker = await createWorker("eng", 1, {
    workerPath: TESSERACT_WORKER_PATH,
  });
  await worker.setParameters({
    tessedit_char_whitelist:
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    classify_bln_numeric_mode: "1",
  });

  const {
    data: { text, confidence },
  } = await worker.recognize(procBuf);
  const solved = text.replace(/[^a-zA-Z0-9]/g, "").trim();
  console.log(
    `  [Captcha] Result: "${solved}"  (conf: ${Math.round(confidence)}%)`,
  );
  await worker.terminate();
  return solved;
}

interface TenderStatusInfo {
  website: string;
  type: string;
}

async function getTenderStatusInfo(
  tenderStatusId: number | null,
): Promise<TenderStatusInfo | null> {
  if (!tenderStatusId) return null;
  const record = await prisma.tenderStatusTable.findUnique({
    where: { id: tenderStatusId },
  });
  if (!record || !record.website) return null;
  return { website: record.website, type: record.type };
}

async function handleNicEproc(
  page: import("playwright").Page,
  website: string,
  referenceNo: string,
): Promise<{ success: boolean; captchaDetected?: string; error?: string }> {
  try {
    await page.goto(website, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    await page.locator("a[title='Advanced Search']").click();
    await page.waitForTimeout(2000);

    const tenderTypeSelect = page.locator("#TenderType");
    if (await tenderTypeSelect.isVisible()) {
      await tenderTypeSelect.selectOption("1");
    }

    await page.locator("#tenderId").fill(referenceNo);

    for (let attempt = 1; attempt <= 5; attempt++) {
      if (attempt > 1) {
        console.log(`[Non-GEM] Captcha retry ${attempt}/5 — refreshing captcha`);
        await page.locator("button[name='captcha']").click();
        await page.waitForTimeout(2000);
      }

      const captchaText = await ocrCaptchaFromPage(page, attempt);
      if (!captchaText) {
        console.log(`[Non-GEM] Attempt ${attempt}: OCR returned empty, retrying`);
        continue;
      }

      await page.locator("#captchaText").fill(captchaText);
      await page.locator("#submit").click();
      await page.waitForTimeout(3000);

      const invalidCaptcha = page.locator("span.error").first();
      if (!(await invalidCaptcha.isVisible())) {
        return { success: true, captchaDetected: captchaText };
      }

      console.log(`[Non-GEM] Attempt ${attempt}: invalid captcha`);
    }

    return { success: false, error: "Captcha failed after 5 attempts" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function searchNonGemTenders(
  tenders: NonGemTenderItem[],
  onProgress?: (current: number, total: number) => void,
): Promise<NonGemSearchResult[]> {
  console.log(`[Non-GEM] Starting search for ${tenders.length} tender(s)`);

  if (tenders.length === 0) return [];

  const chromePath = process.env.CHROME_PATH || detectChromePath();
  console.log(`[Non-GEM] Chrome path: ${chromePath}`);

  console.log(`[Non-GEM] Launching Chrome...`);
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: false,
  });
  console.log(`[Non-GEM] Chrome launched`);

  const results: NonGemSearchResult[] = [];

  try {
    const page = await browser.newPage();

    for (let i = 0; i < tenders.length; i++) {
      const tender = tenders[i];
      console.log(
        `[Non-GEM] Processing tender ${i + 1}/${tenders.length}: id=${tender.id} ref="${tender.referenceNo}" statusId=${tender.tenderStatusId}`,
      );
      let result: NonGemSearchResult;

      try {
        const info = await getTenderStatusInfo(tender.tenderStatusId);
        console.log(`[Non-GEM] TenderStatusInfo:`, info);

        if (!info) {
          if (tender.website) {
            console.log(
              `[Non-GEM] No TenderStatusTable record, using tender's website: ${tender.website}`,
            );
            const searchResult = await handleNicEproc(
              page,
              tender.website,
              tender.referenceNo,
            );
            result = {
              id: tender.id,
              referenceNo: tender.referenceNo,
              ...searchResult,
            };
          } else {
            result = {
              id: tender.id,
              referenceNo: tender.referenceNo,
              success: false,
              error: "Tender status record not found or missing website",
            };
          }
        } else if (info.type === "NIC") {
          console.log(`[Non-GEM] Running NIC handler for ${info.website}`);
          const searchResult = await handleNicEproc(
            page,
            info.website,
            tender.referenceNo,
          );
          result = {
            id: tender.id,
            referenceNo: tender.referenceNo,
            ...searchResult,
          };
        } else {
          result = {
            id: tender.id,
            referenceNo: tender.referenceNo,
            success: false,
            error: `Unsupported portal type: ${info.type}`,
          };
        }
      } catch (err) {
        console.error(`[Non-GEM] Error processing tender ${tender.id}:`, err);
        result = {
          id: tender.id,
          referenceNo: tender.referenceNo,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      console.log(`[Non-GEM] Result for ${tender.referenceNo}:`, result);

      results.push(result);
      try {
        onProgress?.(i + 1, tenders.length);
      } catch {}
    }

    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}
