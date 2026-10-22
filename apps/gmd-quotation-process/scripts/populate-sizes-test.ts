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

  // Get 5 unique dockets from the database
  console.log("Fetching first 5 unique dockets...");
  const dockets = await prisma.enquiry.findMany({
    take: 5,
    select: { id: true, docketNumber: true }
  });

  const docketIds = dockets.map(d => d.id);
  console.log(`Targeting dockets: ${dockets.map(d => d.docketNumber).join(", ")}`);

  console.log("Fetching items for target dockets...");
  const items = await prisma.enquiryItem.findMany({
    where: { enquiryId: { in: docketIds } }
  });

  console.log(`Found ${items.length} items to update. Running category & size resolution...`);

  let count = 0;
  for (const item of items) {
    try {
      const resolved = await resolveItemCategory({
        itemName: item.itemName,
        sheetItemType: item.itemTypeSource === "sheet" ? item.itemType : null,
        sheetMoc: item.mocSource === "sheet" ? item.moc : null,
        sheetSize: null // Force re-detection
      });

      console.log(`Updating item ${item.id} (${item.itemName.slice(0, 60)}...):`);
      console.log(`  Type: "${item.itemType}" -> "${resolved.itemType}"`);
      console.log(`  MOC: "${item.moc}" -> "${resolved.moc}"`);
      console.log(`  Size: "${item.size}" -> "${resolved.size}"`);

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          itemType: resolved.itemType,
          moc: resolved.moc,
          itemTypeSource: resolved.itemTypeSource,
          mocSource: resolved.mocSource,
          size: resolved.size,
        }
      });
      count++;
    } catch (e: any) {
      console.error(`Failed to update item ${item.id}:`, e.message);
    }
  }

  console.log(`Successfully completed testing. Updated ${count} items.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });
