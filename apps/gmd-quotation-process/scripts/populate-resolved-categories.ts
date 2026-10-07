import fs from "fs";
import path from "path";

// Load .env file manually so standalone execution has database credentials
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const firstEquals = trimmed.indexOf("=");
      if (firstEquals !== -1) {
        const key = trimmed.slice(0, firstEquals).trim();
        const value = trimmed.slice(firstEquals + 1).trim().replace(/^['"]|['"]$/g, "");
        process.env[key] = value;
      }
    }
  }
} catch (err) {
  console.warn("Failed to load .env manually:", err);
}

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { resolveItemCategory } = await import("../lib/itemCategoryResolver");

  console.log("Fetching all enquiry items...");
  const items = await prisma.enquiryItem.findMany();

  console.log(`Found ${items.length} items. Resolving categories & MOCs...`);
  let count = 0;
  for (const item of items) {
    try {
      // Resolve based on existing values
      const resolved = await resolveItemCategory({
        itemName: item.itemName,
        sheetItemType: item.itemTypeSource === "sheet" ? item.itemType : null,
        sheetMoc: item.mocSource === "sheet" ? item.moc : null,
      });

      // Check if anything changed
      if (
        resolved.itemType !== item.itemType ||
        resolved.moc !== item.moc ||
        resolved.itemTypeSource !== item.itemTypeSource ||
        resolved.mocSource !== item.mocSource
      ) {
        console.log(`Updating item ${item.id} (${item.itemName}):`);
        console.log(`  Type: "${item.itemType}" (${item.itemTypeSource}) -> "${resolved.itemType}" (${resolved.itemTypeSource})`);
        console.log(`  MOC: "${item.moc}" (${item.mocSource}) -> "${resolved.moc}" (${resolved.mocSource})`);

        await prisma.enquiryItem.update({
          where: { id: item.id },
          data: {
            itemType: resolved.itemType,
            moc: resolved.moc,
            itemTypeSource: resolved.itemTypeSource,
            mocSource: resolved.mocSource,
            operationType: resolved.operationType,
          },
        });
        count++;
      }
    } catch (e: any) {
      console.error(`Failed to update item ${item.id}:`, e.message);
    }
  }

  console.log(`Successfully updated ${count} items.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });
