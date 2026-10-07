import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { resolveItemCategory } from "../lib/itemCategoryResolver";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface ValidationResult {
  id: string
  docketNumber: string
  itemName: string
  oldItemType: string | null
  newItemType: string | null
  oldMoc: string | null
  newMoc: string | null
  oldSize: string | null
  newSize: string | null
  oldOperationType: string | null
  newOperationType: string | null
  itemTypeSource: string | null
  mocSource: string | null
  changed: boolean
}

async function fetchItems(docketFilter?: string[]) {
  const where = docketFilter?.length
    ? { enquiry: { docketNumber: { in: docketFilter } } }
    : undefined

  return prisma.enquiryItem.findMany({
    where,
    select: {
      id: true,
      itemName: true,
      itemType: true,
      moc: true,
      size: true,
      operationType: true,
      itemTypeSource: true,
      mocSource: true,
      enquiry: { select: { docketNumber: true } },
    },
  })
}

async function main() {
  const args = process.argv.slice(2)
  const docketIdx = args.indexOf("--docket")
  const docketFilter = docketIdx !== -1
    ? args[docketIdx + 1]?.split(",").map((d) => d.trim()).filter(Boolean)
    : undefined

  console.log(docketFilter?.length
    ? `Fetching items for docket(s): ${docketFilter.join(", ")}...`
    : "Fetching all items from database...")

  const items = await fetchItems(docketFilter)
  console.log(`Found ${items.length} items.\n`)

  const results: ValidationResult[] = []
  let changedCount = 0
  let errorCount = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    process.stdout.write(`\r[${i + 1}/${items.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`)

    try {
      const resolved = await resolveItemCategory({
        itemName: item.itemName,
        sheetItemType: item.itemTypeSource === "sheet" ? item.itemType : undefined,
        sheetMoc: item.mocSource === "sheet" ? item.moc : undefined,
      })

      const changed =
        resolved.itemType !== item.itemType ||
        resolved.moc !== item.moc ||
        resolved.size !== item.size ||
        resolved.operationType !== item.operationType

      results.push({
        id: item.id,
        docketNumber: item.enquiry.docketNumber,
        itemName: item.itemName,
        oldItemType: item.itemType,
        newItemType: resolved.itemType,
        oldMoc: item.moc,
        newMoc: resolved.moc,
        oldSize: item.size,
        newSize: resolved.size,
        oldOperationType: item.operationType,
        newOperationType: resolved.operationType,
        itemTypeSource: resolved.itemTypeSource,
        mocSource: resolved.mocSource,
        changed,
      })

      if (changed) changedCount++
    } catch (err) {
      console.error(`\n[ERROR] ${item.enquiry.docketNumber}: ${(err as Error).message}`)
      errorCount++
    }
  }

  console.log(`\n\n=== SUMMARY ===`)
  console.log(`Total items: ${items.length}`)
  console.log(`Changed: ${changedCount}`)
  console.log(`Errors: ${errorCount}`)
  console.log(`Unchanged: ${items.length - changedCount - errorCount}\n`)

  const changedItems = results.filter((r) => r.changed)
  if (changedItems.length > 0) {
    console.log("=== CHANGES ===")
    const header = `Docket`.padEnd(22) + `| Item Type`.padEnd(22) + `→`.padEnd(3) + `Item Type`.padEnd(22) + `| MOC`.padEnd(20) + `→`.padEnd(3) + `MOC`.padEnd(20) + `| Size`.padEnd(10) + `→`.padEnd(3) + `Size`.padEnd(10) + `| Source`
    console.log(header)
    console.log("-".repeat(140))
    for (const r of changedItems) {
      console.log(
        r.docketNumber.substring(0, 20).padEnd(22),
        "|",
        (r.oldItemType || "-").substring(0, 18).padEnd(20),
        "→",
        (r.newItemType || "-").substring(0, 18).padEnd(20),
        "|",
        (r.oldMoc || "-").substring(0, 16).padEnd(18),
        "→",
        (r.newMoc || "-").substring(0, 16).padEnd(18),
        "|",
        (r.oldSize || "-").padEnd(8),
        "→",
        (r.newSize || "-").padEnd(8),
        "|",
        `${r.itemTypeSource}/${r.mocSource}`
      )
    }
  }

  if (changedItems.length > 0) {
    console.log("\nTo apply changes to database, run with --apply flag:")
    console.log("  npx tsx scripts/validate-existing-items.ts --apply")
    if (docketFilter?.length) {
      console.log(`  npx tsx scripts/validate-existing-items.ts --docket "${docketFilter.join(",")}" --apply`)
    }
  }

  await prisma.$disconnect()
}

async function apply() {
  const args = process.argv.slice(2)
  const docketIdx = args.indexOf("--docket")
  const docketFilter = docketIdx !== -1
    ? args[docketIdx + 1]?.split(",").map((d) => d.trim()).filter(Boolean)
    : undefined

  console.log(docketFilter?.length
    ? `Fetching items for docket(s): ${docketFilter.join(", ")}...`
    : "Fetching all items from database...")

  const items = await fetchItems(docketFilter)
  console.log(`Found ${items.length} items. Applying validation...\n`)

  let updatedCount = 0
  let errorCount = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    process.stdout.write(`\r[${i + 1}/${items.length}] ${item.enquiry.docketNumber} | ${item.itemName.substring(0, 50).padEnd(50)}`)

    try {
      const resolved = await resolveItemCategory({
        itemName: item.itemName,
        sheetItemType: item.itemTypeSource === "sheet" ? item.itemType : undefined,
        sheetMoc: item.mocSource === "sheet" ? item.moc : undefined,
      })

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          itemType: resolved.itemType,
          moc: resolved.moc,
          size: resolved.size,
          operationType: resolved.operationType,
          itemTypeSource: resolved.itemTypeSource,
          mocSource: resolved.mocSource,
        },
      })

      if (resolved.itemType !== item.itemType || resolved.moc !== item.moc || resolved.size !== item.size || resolved.operationType !== item.operationType) {
        updatedCount++
      }
    } catch (err) {
      console.error(`\n[ERROR] ${item.enquiry.docketNumber}: ${(err as Error).message}`)
      errorCount++
    }
  }

  console.log(`\n\n=== APPLY SUMMARY ===`)
  console.log(`Total items: ${items.length}`)
  console.log(`Updated: ${updatedCount}`)
  console.log(`Errors: ${errorCount}`)

  await prisma.$disconnect()
}

const args = process.argv.slice(2)
if (args.includes("--apply")) {
  apply().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
