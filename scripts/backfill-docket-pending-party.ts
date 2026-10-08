import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  PARTY_LOOKUP_TYPE,
  buildPartyMatcher,
  buildPartySearchText,
  isPendingDocketCandidate,
} from "../lib/docketPending";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 500;
const SAMPLE_SIZE = 20;

interface ThreadRow {
  id: number;
  threadId: string;
  subject: string | null;
  body: string | null;
  bodyPreview: string | null;
  ocrText: string | null;
  sender: string | null;
  toDetails: unknown;
  ccDetails: unknown;
  company: string | null;
  isGmdClient: boolean | null;
  userLabels: unknown;
  docketNo: string | null;
  pendingDocket: boolean | null;
  partyName: string | null;
}

async function main() {
  const partyRows = await prisma.lookupOption.findMany({
    where: { type: PARTY_LOOKUP_TYPE, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { value: true },
  });
  const partyNames = partyRows.map((r) => r.value);
  const matchParty = buildPartyMatcher(partyNames);
  console.log(`Loaded ${partyNames.length} active PARTY lookup options.`);

  let cursor = 0;
  let scanned = 0;
  let pendingThreads = 0;
  const pendingDocketUpdates: number[] = [];
  const partyUpdates: { id: number; partyName: string }[] = [];
  const samples: string[] = [];

  for (;;) {
    const batch = await prisma.docketQuotationThread.findMany({
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      skip: cursor,
      select: {
        id: true,
        threadId: true,
        subject: true,
        body: true,
        bodyPreview: true,
        ocrText: true,
        sender: true,
        toDetails: true,
        ccDetails: true,
        company: true,
        isGmdClient: true,
        userLabels: true,
        docketNo: true,
        pendingDocket: true,
        partyName: true,
      },
    });
    if (batch.length === 0) break;
    cursor += batch.length;
    scanned += batch.length;

    for (const t of batch as ThreadRow[]) {
      const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;
      const isCandidate = isPendingDocketCandidate({
        userLabels: t.userLabels,
        isGmdClient: t.isGmdClient,
        company: t.company,
        toDetails: t.toDetails,
        ccDetails: t.ccDetails,
        text,
      });
      if (!isCandidate) continue;

      pendingThreads++;

      const hasDocket = !!t.docketNo;
      const partyName = matchParty(buildPartySearchText(t));

      if (!hasDocket && t.pendingDocket !== true) {
        pendingDocketUpdates.push(t.id);
      }
      if (partyName && !t.partyName) {
        partyUpdates.push({ id: t.id, partyName });
      }

      if (samples.length < SAMPLE_SIZE) {
        samples.push(
          [
            t.id,
            hasDocket ? `docket=${t.docketNo}` : "NO-DOCKET",
            partyName || "-",
            (t.subject || "No Subject").slice(0, 55),
          ].join(" | ")
        );
      }
    }
  }

  console.log(`\nScanned ${scanned} threads.`);
  console.log(`Pending-docket candidate threads: ${pendingThreads}`);
  console.log(`pendingDocket -> true: ${pendingDocketUpdates.length}`);
  console.log(`partyName to fill: ${partyUpdates.length}`);

  const byParty = new Map<string, number>();
  for (const p of partyUpdates) byParty.set(p.partyName, (byParty.get(p.partyName) || 0) + 1);
  if (byParty.size > 0) {
    console.log("\nParty name matches:");
    for (const [name, count] of [...byParty.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}  ${name}`);
    }
  }

  console.log("\nSample pending threads:");
  samples.forEach((s) => console.log(`  ${s}`));

  if (!APPLY) {
    console.log("\nDRY RUN - re-run with --apply to write these changes.");
    return;
  }

  for (let i = 0; i < pendingDocketUpdates.length; i += BATCH_SIZE) {
    const chunk = pendingDocketUpdates.slice(i, i + BATCH_SIZE);
    await prisma.docketQuotationThread.updateMany({
      where: { id: { in: chunk } },
      data: { pendingDocket: true },
    });
  }

  for (const row of partyUpdates) {
    await prisma.docketQuotationThread.update({
      where: { id: row.id },
      data: { partyName: row.partyName },
    });
  }

  console.log(
    `\nAPPLIED: pendingDocket=true on ${pendingDocketUpdates.length} threads, partyName on ${partyUpdates.length} threads.`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
