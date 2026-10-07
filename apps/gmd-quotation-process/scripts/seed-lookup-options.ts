import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { PARTY_NAMES } from "../lib/partyNames";
import { UTILITIES } from "../lib/utilities";
import { ALLOWED_OPERATION_TYPES } from "../lib/operationTypePatterns";
import { ALLOWED_EXTENSIONS } from "../lib/extensionPatterns";
import { ALLOWED_BYPASSES } from "../lib/bypassPatterns";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATIC_ITEM_TYPES = [
  "ACTUATOR",
  "AIR CUSHION VALVE",
  "AIR VACCUM VALVE",
  "AIR VALVE",
  "ALTITUDE CONTROL VALVE",
  "BALL VALVE",
  "BOLTS OR NUTS",
  "BUSH",
  "BUSH PLATE",
  "BUTTERFLY VALVE",
  "CHECK VALVE",
  "COMPANION FLANGE",
  "COTTER PIN",
  "DEAD END COVER",
  "DIGITAL PRESSURE GAUGE",
  "DISC SEAT RING",
  "DISMANTLING JOINT",
  "DOWEL PIN & WASHER",
  "DPCV",
  "DRUM PLATE",
  "EXPANSION BELOWS",
  "FIRE HYDRANT VALVE",
  "FLAP VALVE",
  "FLOAT VALVE",
  "FOOT VALVE",
  "GASKET",
  "GATE VALVE",
  "GAZAL",
  "GEAR BOX",
  "GLOBE VALVE",
  "H.P. ORIFICE SMALL CHAMBER",
  "KNIFE GATE VALVE",
  "LP SEAT RING",
  "MS REDUCER",
  "MS ROD",
  "NEEDLE VALVE",
  "O-RING",
  "OTHERS",
  "PLUG VALVE",
  "PRESSURE REDUCING VALVE",
  "PRESSURE RELIEF VALVE",
  "RETAINER RING",
  "RING",
  "SEAL RING",
  "SEAL RING, DISC SEAT RING",
  "SHAFT",
  "SLUICE GATE",
  "SLUICE VALVE-METAL-NON-RISING",
  "SLUICE VALVE-METAL-RISING",
  "SLUICE VALVE-RESILIENT-NON-RISING",
  "SLUICE VALVE-RESILIENT-RISING",
  "SMALL ORIFICE SET",
  "SOLENOID VALVE",
  "SPINDLE",
  "TIE ROD",
  "TPAV",
  "UPPER SHAFT",
  "VACUM BREAKER VALVE",
  "WASHER",
  "WASTAGE",
  "WEDGE NUT",
  "WIRE NAIL",
  "Y-STRAINER",
  "ZERO VELOCITY VALVE",
];

const STATIC_MOCS = [
  "DUCTILE IRON/CAST IRON",
  "MILD STEEL",
  "CAST STEEL/CARBON STEEL",
  "ACTUATOR",
  "RUBBER",
  "OTHERS",
  "CAPEX",
  "STAINLESS STEEL",
  "GUN METAL/ BRASS",
  "LEATHER",
  "FORGED STEEL",
  "MONEL STEEL",
  "WOODEN",
  "GALVANISED",
];

const STATIC_SIZES = [
  "12", "15", "20", "25", "32", "40", "50", "65", "80", "100",
  "120", "125", "150", "200", "225", "250", "300", "350", "400",
  "450", "500", "600", "700", "750", "800", "900", "1000", "1100",
  "1200", "1300", "1400", "1500", "1600", "1700", "1800", "1900",
  "2000", "2100", "2200", "2300", "2400", "2500", "2600", "2700",
  "2800",
];

const STATIC_PN_RATINGS = [
  "PN-10/16",
  "PN-20/25/30",
  "NA",
  "CLASS-600#",
  "CLASS-150#",
  "CLASS-300#",
  "CLASS-800#",
];

const STATIC_ENQUIRY_TYPES = ["PURCHASE", "BUDGETARY", "TENDER"];

const STATIC_STATES = [
  "ANDHRA PRADESH",
  "ARUNACHAL PRADESH",
  "ASSAM",
  "BIHAR",
  "CHHATTISGARH",
  "GOA",
  "GUJARAT",
  "HARYANA",
  "HIMACHAL PRADESH",
  "JHARKHAND",
  "KARNATAKA",
  "KERALA",
  "MADHYA PRADESH",
  "MAHARASHTRA",
  "MANIPUR",
  "MEGHALAYA",
  "MIZORAM",
  "NAGALAND",
  "ODISHA",
  "PUNJAB",
  "RAJASTHAN",
  "SIKKIM",
  "TAMIL NADU",
  "TELANGANA",
  "TRIPURA",
  "UTTAR PRADESH",
  "UTTARAKHAND",
  "WEST BENGAL",
  "DELHI",
];

const STATIC_PAYMENT_TERMS = [
  "20% advance against order & 80 % Against Proforma Invoice immediately after Inspection.",
  "20% advance against order & 80 % Within 30 Days from the date of receipt of material at site.",
  "30 days Open credit from date of Dispatch of material",
  "60 days Open credit from date of Dispatch of material",
  "60 days Letter of credit prior to date of supply with interest in Buyer Account",
  "30 days Letter of credit prior to date of supply with interest in Buyer Account",
  "60 days Letter of credit prior to date of supply with interest in Seller Account",
  "30 days Letter of credit prior to date of supply with interest in Seller Account",
  "90 days Letter of credit prior to date of supply with interest in Buyer Account",
  "90 days Letter of credit prior to date of supply with interest in Seller'S Account",
  "90 days Open credit from date of Dispatch of material",
  "45 days Open credit from date of Dispatch of material",
  "60 days PDC prior to date of supply.",
  "07 days Open credit from date of Dispatch of material",
  "180 days Letter of credit prior to date of supply with interest in Seller'S Account",
  "100 % Against Proforma Invoice Prior To Dispatch.",
  "15% Advance Along With PO and Balance 85% Against Proforma Invoice Prior To Dispatch",
  "20% Advance Along With PO and Balance 80% Against 45 Days Bank L/c Prior To Dispatch",
  "90 days hundi: against MRN & BILL SUBMISSION whichever is later",
  "45 days Letter of credit from date of Dispatch of material",
  "180 days VFS  with interest in Seller'S Account",
];

const STATIC_INSPECTIONS = [
  "Client Scope @ 0.75%",
  "Client Scope @ 1%",
  "Client Scope @ 1.25%",
  "Client Scope @ 1.5%",
  "Client Scope @ 1.75%",
  "Client Scope @ 2%",
  "Our Scope @ 1%",
  "Our Scope @ 1.25%",
  "Our Scope @ 1.5%",
  "Our Scope @ 1.75%",
  "Our Scope @ 2%",
  "NA",
];

const STATIC_PBGS = [
  "5% For 24 Months from date of invoice.",
  "7.5% For 24 Months from date of invoice.",
  "10% For 24 Months  from date of invoice.",
  "5% For 36 Months  from date of invoice.",
  "7.5% For 36 Months  from date of invoice.",
  "10% For 36 Months  from date of invoice.",
  "5% For 60 Months  from date of invoice.",
  "7.5% For 60 Months from date of invoice.",
  "10% For 60 Months  from date of invoice.",
  "5% For 66 Months  from date of invoice.",
  "7.5% For 66 Months  from date of invoice.",
  "10% For 66 Months  from date of invoice.",
  "NA",
  "2.5% For 24 Months from date of invoice.",
  "10% For 12 Months from date of invoice.",
  "2.5% For 36 Months  from date of invoice.",
  "10% For 90days beyond DLP of 10 yrs from date of invoice.",
  "5% For 4 Months from date of invoice.",
  "5% For 3 Months from date of invoice.",
  "5% For 6 Months from date of invoice.",
  "10% For 15 Months from date of invoice.",
  "5% For 17 Months from date of invoice.",
  "10% For 21 Months from date of invoice.",
  "10% For 45 Months from date of invoice.",
  "10% For 69 Months from date of invoice.",
  "10% For 29 Months from date of invoice.",
  "3% For 16 Months from date of invoice.",
  "3% For 27 Months from date of invoice.",
  "5% For 21 Months from date of invoice.",
  "5% For 31 Months from date of invoice.",
  "5% For 14 Months from date of invoice.",
  "10% For 24 Months beyond DLP of 30 days from date of invoice.",
  "3% For 23 Months from date of invoice.",
  "5% For 5 Months  from date of invoice.",
  "5% For 12 Months from date of invoice.",
  "10% For 14 Months from date of invoice.",
  "3% For 25 Months from date of invoice.",
  "3% For 24 Months from date of invoice.",
  "5% For 22 Months from date of invoice.",
  "5% For 7 Months from date of invoice.",
  "5% For 19 Months from date of invoice.",
  "1% For 36 Months  from date of invoice.",
];

const STATIC_ORDER_STATUSES = ["PENDING", "LOST", "ORDER RECVD"];

const STATIC_CLOSURE_STATUSES = ["Sent", "Rejected", "Pending"];

const STATIC_OTHERS = ["flange", "gasket", "nut and bolt"];

// Single source of truth for the Delivery Schedule dropdown. Computed schedules
// from lib/deliverySchedule.ts ("2-3 weeks", "2 months", "3 months", "Min. 3 to 4 months")
// must all be present here.
const STATIC_DELIVERY_SCHEDULES = [
  "-",
  "2-3 weeks",
  "2 months",
  "3 months",
  "Min. 3 to 4 months",
  "Ready Stock",
  "Within 2 months",
  "30 Days FRom the Date of MFC",
];

const lists: Record<string, string[]> = {
  PARTY: PARTY_NAMES,
  UTILITY: UTILITIES,
  ITEM_TYPE: STATIC_ITEM_TYPES,
  MOC: STATIC_MOCS,
  SIZE: STATIC_SIZES,
  PN_RATING: STATIC_PN_RATINGS,
  ENQUIRY_TYPE: STATIC_ENQUIRY_TYPES,
  STATE: STATIC_STATES,
  PAYMENT_TERM: STATIC_PAYMENT_TERMS,
  INSPECTION: STATIC_INSPECTIONS,
  PBG: STATIC_PBGS,
  ORDER_STATUS: STATIC_ORDER_STATUSES,
  CLOSURE_STATUS: STATIC_CLOSURE_STATUSES,
  OPERATION_TYPE: [...ALLOWED_OPERATION_TYPES],
  EXTENSION: [...ALLOWED_EXTENSIONS],
  BYPASS: [...ALLOWED_BYPASSES],
  OTHERS: [...STATIC_OTHERS],
  DELIVERY: [...STATIC_DELIVERY_SCHEDULES],
};

async function main() {
  let total = 0;
  for (const [type, values] of Object.entries(lists)) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i].trim();
      if (!value) continue;
      await prisma.lookupOption.upsert({
        where: { type_value: { type, value } },
        update: { sortOrder: i, isActive: true },
        create: { type, value, sortOrder: i },
      });
      total++;
    }
    console.log(`Seeded ${type}: ${values.length} options`);
  }
  console.log(`\nDone. Total upserts: ${total}`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
