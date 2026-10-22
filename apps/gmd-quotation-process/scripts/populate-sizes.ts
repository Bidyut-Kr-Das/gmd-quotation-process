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
  const { extractSizeFromItemName } = await import("../lib/sizeExtractor");

  console.log("Fetching all enquiry items...");
  const items = await prisma.enquiryItem.findMany();

  console.log(`Found ${items.length} items. Checking and updating sizes...`);
  let count = 0;
  for (const item of items) {
    try {
      const newSize = extractSizeFromItemName(item.itemName);
      // Update if size is null, empty, or differs from newly extracted size
      if (!item.size || item.size === "" || item.size !== newSize) {
        console.log(`Updating size for item ${item.id} (${item.itemName}): "${item.size}" -> "${newSize}"`);
        await prisma.enquiryItem.update({
          where: { id: item.id },
          data: { size: newSize },
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
