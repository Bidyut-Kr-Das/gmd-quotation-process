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
  // Use dynamic imports to prevent ES module hoisting from running imports before env is loaded
  const { prisma } = await import("../lib/prisma");
  const { recalculateItem } = await import("../lib/costCalculator");

  console.log("Fetching all enquiry items with product cost...");
  const items = await prisma.enquiryItem.findMany({
    where: {
      productCost: {
        not: null,
      },
    },
  });

  console.log(`Found ${items.length} items to recalculate.`);

  let successCount = 0;
  for (const item of items) {
    try {
      await recalculateItem(item.id);
      successCount++;
    } catch (error) {
      console.error(`Failed to recalculate item ${item.id}:`, error);
    }
  }

  console.log(`Successfully recalculated ${successCount} of ${items.length} items.`);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const { prisma } = await import("../lib/prisma");
      await prisma.$disconnect();
    } catch (e) {}
  });
