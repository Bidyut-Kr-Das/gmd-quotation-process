import puppeteer, { type Page } from "puppeteer-core";
import fs from "fs";

export interface BidResultItem {
  id: number;
  gemId: string;
  success: boolean;
  bidStatus?: string;
  differenceBetweenRank1?: string;
  evaluations?: EvaluationRow[];
  error?: string;
}

interface EvaluationRow {
  sellerName: string;
  offeredItem: string | null;
  totalPrice: string | null;
  rank: string | null;
  status: string | null;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sleepForAnimation(ms: number) {
  return delay(ms);
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
      const input = label.querySelector("input");
      if (input instanceof HTMLInputElement && !input.checked) {
        input.click();
      }
    });
    await sleepForAnimation(1000);
  }
  await page.keyboard.press("Enter");
}

async function waitForSearchResults(page: Page, gemId: string, timeout = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await page.evaluate((targetGemId) => {
      const body = document.body.innerText;
      if (body.includes("No data found")) return "no-data";
      const link = document.querySelector<HTMLAnchorElement>(`a.bid_no_hover`);
      if (link && link.textContent?.includes(targetGemId)) return "found";
      if (body.includes(targetGemId)) return "found";
      return "waiting";
    }, gemId);
    if (state === "found") return true;
    if (state === "no-data") return false;
    await delay(1000);
  }
  return false;
}

async function findGemIdResult(page: Page, gemId: string): Promise<{
  bidStatus: string | null;
  hasViewBidResults: boolean;
} | null> {
  return page.evaluate((targetGemId) => {
    function elementText(el: Element): string {
      const val = el instanceof HTMLInputElement ? el.value : "";
      return (val || el.textContent || "").toUpperCase().replace(/\s+/g, " ");
    }

    function textMatches(el: Element, ...patterns: string[]) {
      const t = elementText(el);
      return patterns.some((p) => t.includes(p.toUpperCase()));
    }

    function hasOnclick(el: Element) {
      return el.hasAttribute("onclick") || el.hasAttribute("ng-click") || el.getAttribute("href");
    }

    function findViewBidButtonInPage(): boolean {
      const interactive = document.querySelectorAll<HTMLElement>(
        'a, button, input[type="button"], input[type="submit"], [role="button"], [onclick]',
      );
      for (const el of Array.from(interactive)) {
        if (textMatches(el, "VIEW BID RESULTS", "VIEW BID", "VIEW RESULT", "BID RESULTS")) return true;
      }

      const allElements = Array.from(document.querySelectorAll<HTMLElement>("*"));
      for (const el of allElements) {
        if (textMatches(el, "VIEW BID RESULTS") && (hasOnclick(el) || el.tagName !== "SPAN")) return true;
      }

      for (const el of allElements) {
        if (textMatches(el, "VIEW") && hasOnclick(el)) return true;
      }

      return false;
    }

    const link = document.querySelector<HTMLAnchorElement>(`a.bid_no_hover`);
    if (!link || !link.textContent?.includes(targetGemId)) {
      if (document.body.innerText.includes(targetGemId)) {
        const statusMatch = document.body.innerText.match(/Status\s*:\s*([^\n]+)/i);
        return {
          bidStatus: statusMatch ? statusMatch[1].trim() : null,
          hasViewBidResults: findViewBidButtonInPage(),
        };
      }
      return null;
    }

    const blockHeader = link.closest(".block_header");
    let bidStatus: string | null = null;

    if (blockHeader) {
      const statusSpan = blockHeader.querySelector("span.text-success, span.text-danger, span.text-warning, span");
      if (statusSpan) {
        bidStatus = statusSpan.textContent?.trim() || null;
      }
    }

    if (!bidStatus) {
      const statusMatch = (blockHeader || link.parentElement || document.body).textContent?.match(/Status\s*:\s*([^\n]+)/i);
      if (statusMatch) {
        bidStatus = statusMatch[1].trim();
      }
    }

    return {
      bidStatus,
      hasViewBidResults: findViewBidButtonInPage(),
    };
  }, gemId);
}

async function getViewBidResultsUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    function elementText(el: Element): string {
      const val = el instanceof HTMLInputElement ? el.value : "";
      return (val || el.textContent || "").toUpperCase().replace(/\s+/g, " ");
    }

    function textMatches(el: Element, ...patterns: string[]) {
      const t = elementText(el);
      return patterns.some((p) => t.includes(p.toUpperCase()));
    }

    function findAnchor(): HTMLAnchorElement | null {
      const interactive = document.querySelectorAll<HTMLElement>(
        'a, button, input[type="button"], input[type="submit"], [role="button"], [onclick]',
      );
      for (const el of Array.from(interactive)) {
        if (textMatches(el, "VIEW BID RESULTS", "VIEW BID", "VIEW RESULT", "BID RESULTS")) {
          const anchor = el.closest("a");
          if (anchor?.hasAttribute("href")) return anchor;
        }
      }

      const allElements = Array.from(document.querySelectorAll<HTMLElement>("*"));
      for (const el of allElements) {
        if (textMatches(el, "VIEW BID RESULTS")) {
          const anchor = el.closest("a");
          if (anchor?.hasAttribute("href")) return anchor;
        }
      }

      for (const el of allElements) {
        if (textMatches(el, "VIEW")) {
          const anchor = el.closest("a");
          if (anchor?.hasAttribute("href")) return anchor;
        }
      }

      return null;
    }

    const anchor = findAnchor();
    return anchor?.getAttribute("href") || null;
  });
}

async function expandEvaluationSection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("div, section, fieldset"));
    const evalSection = sections.find((s) =>
      s.textContent?.toUpperCase().includes("2. EVALUATION"),
    );
    if (!evalSection) return false;

    const arrow = evalSection.querySelector(
      'button, [role="button"], .arrow, i.fa-chevron-down, i.fa-chevron-right, svg, .expand-btn, .collapsed',
    );
    if (arrow instanceof HTMLElement) {
      arrow.click();
      return true;
    }

    const header = evalSection.querySelector("h1, h2, h3, h4, h5, h6, legend, label");
    if (header instanceof HTMLElement) {
      header.click();
      return true;
    }

    evalSection.querySelectorAll("*").forEach((el) => {
      if (el instanceof HTMLElement && el.click) {
        try { el.click(); } catch {}
      }
    });
    return false;
  });
}

async function parseEvaluationTable(page: Page): Promise<EvaluationRow[]> {
  return page.evaluate(() => {
    const evalSection = Array.from(document.querySelectorAll("div, section, fieldset")).find((s) =>
      s.textContent?.toUpperCase().includes("2. EVALUATION"),
    );
    const container = evalSection || document.body;
    const tables = Array.from(container.querySelectorAll("table"));
    const table = tables[0] || document.querySelector("table");
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return [];

    const headerCells = Array.from(rows[0].querySelectorAll("th, td"));
    const columnIndex: Record<string, number> = {};

    headerCells.forEach((cell, i) => {
      const text = cell.textContent?.trim().toLowerCase() || "";
      if (text.includes("s.no") || text.includes("sno") || text.includes("sn")) columnIndex["sno"] = i;
      if (text.includes("seller") || text.includes("bidder") || text.includes("vendor")) columnIndex["seller"] = i;
      if (text.includes("offered") || text.includes("item")) columnIndex["offeredItem"] = i;
      if (text.includes("total") || text.includes("price") || text.includes("amount")) columnIndex["totalPrice"] = i;
      if (text.includes("rank")) columnIndex["rank"] = i;
      if (text.includes("status")) columnIndex["status"] = i;
    });

    if (Object.keys(columnIndex).length === 0) {
      return rows.slice(1).map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        return {
          sellerName: cells[1]?.textContent?.trim() || "",
          offeredItem: cells[2]?.textContent?.trim() || null,
          totalPrice: cells[3]?.textContent?.trim() || null,
          rank: cells[4]?.textContent?.trim() || null,
          status: cells[5]?.textContent?.trim() || null,
        };
      });
    }

    return rows.slice(1).map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      return {
        sellerName: cells[columnIndex["seller"]]?.textContent?.trim() || "",
        offeredItem: cells[columnIndex["offeredItem"]]?.textContent?.trim() || null,
        totalPrice: cells[columnIndex["totalPrice"]]?.textContent?.trim() || null,
        rank: cells[columnIndex["rank"]]?.textContent?.trim() || null,
        status: cells[columnIndex["status"]]?.textContent?.trim() || null,
      };
    });
  });
}

function parsePrice(priceStr: string): number {
  const cleaned = priceStr.replace(/[^0-9.]/g, "");
  return parseFloat(cleaned) || 0;
}

function calculateDifference(evaluations: EvaluationRow[]): string | null {
  const l1Row = evaluations.find(
    (e) => e.rank?.toUpperCase() === "L1" || e.rank?.trim() === "1",
  );
  const targetRow = evaluations.find(
    (e) => e.sellerName.toUpperCase().includes("LASER POWER & INFRA") || e.sellerName.toUpperCase().includes("G M DALUI"),
  );

  if (!l1Row || !targetRow) return null;

  const l1Price = parsePrice(l1Row.totalPrice || "");
  const targetPrice = parsePrice(targetRow.totalPrice || "");

  if (!l1Price || !targetPrice) return null;

  const diff = ((targetPrice - l1Price) / l1Price) * 100;
  return diff.toFixed(2) + "%";
}

async function processTender(
  page: Page,
  gemId: string,
): Promise<BidResultItem> {
  const dummyId = 0;
  try { console.log(`Processing ${gemId}`); } catch {}

  for (let attempt = 1; attempt <= 2; attempt++) {
    const withChecklist = attempt === 2;
    try { console.log(`  ${gemId}: searching ${withChecklist ? "WITH" : "WITHOUT"} Bid/RA Status (attempt ${attempt}/2)`); } catch {}

    try {
      await performSearch(page, gemId, withChecklist);

      try { console.log(`  ${gemId}: waiting for search results`); } catch {}
      const hasResults = await waitForSearchResults(page, gemId);
      if (!hasResults) {
        try { console.log(`  ${gemId}: no data found on attempt ${attempt}`); } catch {}
        continue;
      }

      await sleepForAnimation(2000);

      const rowInfo = await findGemIdResult(page, gemId);
      if (!rowInfo) {
        try { console.log(`  ${gemId}: row not found on attempt ${attempt}`); } catch {}
        continue;
      }

      try { console.log(`  ${gemId}: bid status — "${rowInfo.bidStatus}"`); } catch {}

      if (!rowInfo.hasViewBidResults) {
        try {
          const pageDump = await page.evaluate((targetGemId) => {
            const body = document.body.innerText;
            const idx = body.indexOf(targetGemId);
            if (idx === -1) return "GemId text not found in page";
            const start = Math.max(0, idx - 200);
            const end = Math.min(body.length, idx + 400);
            return body.slice(start, end);
          }, gemId);
          console.error(`  ${gemId}: page content around gemId — ${pageDump}`);
        } catch {}
        try { console.log(`  ${gemId}: View BID Results button not found on attempt ${attempt}, will retry`); } catch {}
        continue;
      }

      try { console.log(`  ${gemId}: getting View BID Results URL`); } catch {}
      const viewUrl = await getViewBidResultsUrl(page);
      if (!viewUrl) {
        try { console.error(`  ${gemId}: View BID Results URL not found`); } catch {}
        continue;
      }

      const fullUrl = new URL(viewUrl, "https://bidplus.gem.gov.in").href;
      try { console.log(`  ${gemId}: opening ${fullUrl}`); } catch {}
      const bidResultsPage = await page.browser().newPage();
      await bidResultsPage.goto(fullUrl);
      try { console.log(`  ${gemId}: View BID Results page loaded, waiting 20s to check for refresh...`); } catch {}
      await delay(20000);

      try { console.log(`  ${gemId}: 20s wait complete, closing page`); } catch {}
      await bidResultsPage.close().catch(() => {});

      return {
        id: dummyId,
        gemId,
        success: true,
        bidStatus: rowInfo.bidStatus || undefined,
      };
    } catch (err) {
      try { console.error(`  ${gemId}: error on attempt ${attempt} — ${err instanceof Error ? err.message : String(err)}`); } catch {}
    }
  }

  return { id: dummyId, gemId, success: false, error: "All attempts failed" };
}

export async function extractBidResults(
  gemIds: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<BidResultItem[]> {
  const chromePath = process.env.CHROME_PATH || (await detectChromePath());

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  const results: BidResultItem[] = [];

  try {
    const page = await browser.newPage();

    for (let i = 0; i < gemIds.length; i++) {
      const gemId = gemIds[i];
      const result = await processTender(page, gemId);
      result.id = i + 1;
      results.push(result);
      try { onProgress?.(i + 1, gemIds.length); } catch {}
    }

    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}
