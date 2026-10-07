import { PrismaClient } from "../app/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Clear database
  await prisma.attachment.deleteMany({});
  await prisma.enquiryItem.deleteMany({});
  await prisma.enquiry.deleteMany({});

  console.log("Seeding database...");

  // Mock data matching the screenshot
  const initialEnquiries = [
    {
      docketNumber: "ORD-9902",
      partyName: "Tata Industrial Ltd., Jamshedpur Unit",
      enquiryDate: new Date("2023-10-12T10:00:00.000Z"),
      attachments: [
        { name: "Specs.pdf", url: "/files/Specs.pdf", type: "pdf", size: 124500 }
      ],
      items: [
        { itemName: "Structural Steel Beam I-Type", quantity: 1200 }
      ]
    },
    {
      docketNumber: "ORD-9884",
      partyName: "Reliance Energy, Mumbai HQ",
      enquiryDate: new Date("2023-10-11T10:00:00.000Z"),
      attachments: [
        { name: "Quote_Final.xlsx", url: "/files/Quote_Final.xlsx", type: "xlsx", size: 45200 }
      ],
      items: [
        { itemName: "High-Pressure Valve Assembly", quantity: 450 }
      ]
    },
    {
      docketNumber: "ORD-9872",
      partyName: "Adani Ports, Mundra Facility",
      enquiryDate: new Date("2023-10-10T10:00:00.000Z"),
      attachments: [
        { name: "Mundra_PR.pdf", url: "/files/Mundra_PR.pdf", type: "pdf", size: 312000 }
      ],
      items: [
        { itemName: "Marine Grade Paint Coating", quantity: 5000 }
      ]
    }
  ];

  for (const eq of initialEnquiries) {
    const { items, attachments, ...enquiryData } = eq;
    await prisma.enquiry.create({
      data: {
        ...enquiryData,
        attachments: {
          create: attachments.map((att) => ({
            name: att.name,
            url: att.url,
            type: att.type,
            size: att.size
          }))
        },
        items: {
          create: items.map((item) => ({
            itemName: item.itemName,
            quantity: item.quantity
          }))
        }
      }
    });
  }

  // Seeding 50 more mock entries
  const companies = [
    { name: "Larsen & Toubro", branch: "Chennai Plant" },
    { name: "Bharat Heavy Electricals", branch: "Bhopal Unit" },
    { name: "JSW Steel", branch: "Ballari Works" },
    { name: "Hindalco Industries", branch: "Renukoot Plant" },
    { name: "Indian Oil Corp", branch: "Mathura Refinery" },
    { name: "ONGC", branch: "Dehradun HQ" },
    { name: "NTPC Limited", branch: "Singrauli Station" },
    { name: "Gail India", branch: "Hazira Complex" },
    { name: "Tata Power", branch: "Trombay Station" },
    { name: "Coal India", branch: "Dhanbad HQ" }
  ];

  const itemsPool = [
    { name: "Industrial Air Compressor 500HP", minQty: 1, maxQty: 10 },
    { name: "Heavy Duty Hydraulic Cylinder", minQty: 10, maxQty: 100 },
    { name: "Structural Carbon Steel Plates", minQty: 50, maxQty: 500 },
    { name: "Seamless Steel Pipes 12-inch", minQty: 100, maxQty: 1000 },
    { name: "High Voltage Transformer 10MVA", minQty: 1, maxQty: 5 },
    { name: "Industrial Centrifugal Pump", minQty: 5, maxQty: 30 },
    { name: "Stainless Steel Fasteners", minQty: 1000, maxQty: 10000 },
    { name: "Electrical Control Panel Board", minQty: 2, maxQty: 15 },
    { name: "Refractory Silica Bricks", minQty: 500, maxQty: 2500 },
    { name: "Industrial Synthetic Lubricant", minQty: 200, maxQty: 2000 }
  ];

  const attachmentOptions = [
    ["Datasheet_V1.pdf", "Technical_Specs.zip"],
    ["Drawings_Final.dwg"],
    ["PO_Draft.pdf", "BOQ_Quotation.xlsx"],
    ["Technical_Specs.zip"],
    ["BOQ_Quotation.xlsx"],
    ["Datasheet_V1.pdf"]
  ];

  let docketSeq = 9800;

  for (let i = 0; i < 50; i++) {
    const company = companies[i % companies.length];
    const docketNumber = `ORD-${docketSeq--}`;
    const partyName = `${company.name}, ${company.branch}`;
    const enquiryDate = new Date(Date.now() - (i + 4) * 24 * 60 * 60 * 1000); // 4+ days ago
    
    const attachFiles = attachmentOptions[i % attachmentOptions.length];

    // Some enquiries will have multiple items
    const numItems = (i % 7 === 0) ? 2 : (i % 13 === 0) ? 3 : 1;
    const itemsData = [];
    for (let j = 0; j < numItems; j++) {
      const itemTemplate = itemsPool[(i * 3 + j) % itemsPool.length];
      const qty = Math.floor(Math.random() * (itemTemplate.maxQty - itemTemplate.minQty + 1)) + itemTemplate.minQty;
      itemsData.push({
        itemName: itemTemplate.name,
        quantity: qty
      });
    }

    await prisma.enquiry.create({
      data: {
        docketNumber,
        partyName,
        enquiryDate,
        attachments: {
          create: attachFiles.map(file => ({
            name: file,
            url: `/files/${file}`,
            type: file.split('.').pop(),
            size: Math.floor(Math.random() * 50000) + 1000
          }))
        },
        items: {
          create: itemsData
        }
      }
    });
  }

  console.log("Database seeded successfully!");
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
