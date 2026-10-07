import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const dockets = [
    'GMD/2026-27/152',
    'GMD/2026-27/153',
    'GMD/2026-27/141',
    'GMD/2026-27/009',
    'GMD/2026-27/004',
    'ID003415',
    'ID003407',
  ];
  const enquiries = await prisma.enquiry.findMany({
    where: { docketNumber: { in: dockets } },
    include: { attachments: true },
  });

  const allThreads = await prisma.docketQuotationThread.findMany({
    take: 10000,
    select: {
      id: true,
      subject: true,
      sender: true,
      toDetails: true,
      date: true,
      docketNo: true,
      attachNames: true,
      attachLinks: true,
      bodyPreview: true,
    },
  });

  console.log('Total threads in DB:', allThreads.length);

  for (const enq of enquiries) {
    console.log('\n======================================================');
    console.log('Enquiry:', enq.docketNumber, '| Party:', enq.partyName, '| Date:', enq.enquiryDate);
    console.log('Enquiry attachments count:', enq.attachments.length);
    for (const a of enq.attachments) {
      console.log('  -> Att:', a.name, '| url:', a.url);
      const driveMatch = a.url?.match(/[-\w]{25,}/);
      if (driveMatch) {
        const driveId = driveMatch[0];
        const matchByDrive = allThreads.filter((t) => {
          const links = JSON.stringify(t.attachLinks || '');
          const prev = t.bodyPreview || '';
          return links.includes(driveId) || prev.includes(driveId);
        });
        console.log(`     Matches for Drive ID ${driveId}:`, matchByDrive.length);
      }
    }

    // Check by docket number digits (e.g. "152", "153", "141", "009", "004")
    const cleanNum = enq.docketNumber.replace(/\D/g, '').replace(/^202627/, '').replace(/^0+/, '');
    const numMatches = allThreads.filter((t) => {
      const sub = t.subject || '';
      const doc = t.docketNo || '';
      const atts = JSON.stringify(t.attachNames || '');
      return (
        new RegExp(`\\b(?:GMD[\\/\\-_\\s.]*)?(?:2026[\\/\\-_\\s.]*27|26[\\/\\-_\\s.]*27)?[\\/\\-_\\s.]*0*${cleanNum}\\b`, 'i').test(sub) ||
        new RegExp(`\\b(?:GMD[\\/\\-_\\s.]*)?(?:2026[\\/\\-_\\s.]*27|26[\\/\\-_\\s.]*27)?[\\/\\-_\\s.]*0*${cleanNum}\\b`, 'i').test(atts) ||
        (doc && doc.includes(cleanNum))
      );
    });
    console.log(`Threads mentioning docket number ${cleanNum}:`, numMatches.length);
    if (numMatches.length > 0) {
      for (const m of numMatches.slice(0, 5)) {
        console.log(`  -> ID: ${m.id} | Date: ${m.date?.toISOString()} | Sender: ${m.sender} | Subj: ${m.subject}`);
      }
    }

    // Check by party name words
    const partyWords = enq.partyName
      .replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt|Private|Enterprises|Enterprise|Industries|Industry|Engineering|Services|Infrastructure|Infra|M\/s|India|Company)\b/gi, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 4);

    if (partyWords.length > 0) {
      const pw = partyWords[0].toLowerCase();
      const partyMatches = allThreads.filter((t) => {
        const text = `${t.subject} ${t.bodyPreview} ${t.sender} ${JSON.stringify(t.toDetails)}`.toLowerCase();
        return new RegExp(`\\b${pw}\\b`, 'i').test(text);
      });
      console.log(`Threads matching party keyword "${pw}":`, partyMatches.length);
      if (partyMatches.length > 0) {
        for (const m of partyMatches.slice(0, 5)) {
          console.log(`  -> ID: ${m.id} | Date: ${m.date?.toISOString()} | Sender: ${m.sender} | Subj: ${m.subject}`);
        }
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
