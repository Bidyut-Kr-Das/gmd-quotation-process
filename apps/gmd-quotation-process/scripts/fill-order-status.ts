import "dotenv/config";
import { prisma } from "../lib/prisma";

const GST = 1.18;

function toNumber(value: string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Select Enquiries that HAVE a selectedContractNo but NO orderStatus.
// Dry-run only: logs the plan and matching rows, writes nothing.
async function main() {
  console.log("\n=== PLAN: Enquiries with selectedContractNo present AND orderStatus null ===\n");

  const rows = await prisma.enquiry.findMany({
    where: {
      selectedContractNo: { isEmpty: false },
      orderStatus: null,
    },
    select: {
      id: true,
      docketNumber: true,
      partyName: true,
      selectedContractNo: true,
      items: { select: { totalValue: true } },
    },
    orderBy: { docketNumber: "asc" },
  });

  console.log(`Matched enquiries: ${rows.length}\n`);

  let grandTotal = 0;
  let grandTotalGst = 0;

  for (const r of rows) {
    const total = r.items.reduce((sum, it) => sum + toNumber(it.totalValue), 0);
    const withGst = total * GST;
    grandTotal += total;
    grandTotalGst += withGst;

    console.log(
      `${r.docketNumber.padEnd(16)} | ${r.partyName.padEnd(28)} | ` +
        `selectedContractNo=[${r.selectedContractNo.join(", ")}] | ` +
        `items=${String(r.items.length).padStart(3)} | ` +
        `totalValue=${total.toFixed(2).padStart(14)} | ` +
        `totalValue*1.18=${withGst.toFixed(2).padStart(14)}`,
    );
  }

  console.log("\n--- GRAND TOTAL ---");
  console.log(`totalValue       = ${grandTotal.toFixed(2)}`);
  console.log(`totalValue*1.18  = ${grandTotalGst.toFixed(2)}`);
  console.log("\nDry run complete. No writes performed.\n");
}

main()
  .catch((e) => {
    console.error("Filter failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
