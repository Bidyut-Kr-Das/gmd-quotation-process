// import { PrismaClient } from "@prisma/client";
// async function main() {
//   const p = new PrismaClient();
//   const r = await p.contractReview.findMany({
//     take: 5,
//     orderBy: { syncedAt: "desc" },
//     select: {
//       lcDateRtgsDate: true,
//       lastDateOfShipmentDateOfLc: true,
//       lcRtgsRefNo: true,
//       dateOfContract: true,
//     },
//   });
//   console.log(JSON.stringify(r, null, 2));
//   await p.$disconnect();
// }
// main();