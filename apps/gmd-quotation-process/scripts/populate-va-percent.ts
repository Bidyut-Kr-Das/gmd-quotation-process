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
  const { recalculateItem } = await import("../lib/costCalculator");

  console.log("Fetching all enquiry items with cost and quoted rate...");
  const items = await prisma.enquiryItem.findMany({
    where: {
      cost: { not: null },
      quotedRate: { not: null },
    },
  });

  console.log(`Found ${items.length} items to inspect.`);

  let updatedCount = 0;
  for (const item of items) {
    // Run recalculateItem which will automatically align cost, quotedRate, and vaPercent
    try {
      await recalculateItem(item.id);
      updatedCount++;
    } catch (e) {
      console.error(`Error recalculating item ${item.id}:`, e);
    }
  }

  console.log(`Successfully populated/updated VA% for ${updatedCount} items.`);
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
