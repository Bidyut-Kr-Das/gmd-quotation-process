import { prisma as defaultPrisma } from "@/lib/prisma";

function partyKey(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function sameContractNos(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Sync Enquiry.contractNo from ContractReview by party name.
 * Matches Enquiry.partyName (trim+upper) against ContractReview.partyNameDump (trim+upper).
 * When `enquiryIds` is provided, only those enquiries are considered; otherwise all.
 * Returns { updated, matched } via the provided prisma instance (defaults to app prisma).
 */
export async function syncEnquiryContractNumbers(
  enquiryIds?: string[],
  prisma: any = defaultPrisma
): Promise<{ updated: number; matched: number }> {
  const contractRows = await prisma.contractReview.findMany({
    select: { contractNo: true, partyNameDump: true },
  });

  const byParty = new Map<string, string[]>();
  for (const row of contractRows) {
    const party = partyKey(row.partyNameDump);
    const contractNo = (row.contractNo ?? "").trim();
    if (!party || !contractNo) continue;
    const list = byParty.get(party);
    if (!list) byParty.set(party, [contractNo]);
    else if (!list.includes(contractNo)) list.push(contractNo);
  }

  const where: any = {};
  if (enquiryIds && enquiryIds.length > 0) where.id = { in: enquiryIds };

  const enquiries = await prisma.enquiry.findMany({
    where: Object.keys(where).length ? where : undefined,
    select: { id: true, partyName: true, contractNo: true },
  });

  let updated = 0;
  let matched = 0;
  for (const enquiry of enquiries) {
    const party = partyKey(enquiry.partyName);
    const next = byParty.get(party) ?? [];
    if (next.length > 0) matched++;
    if (!sameContractNos(enquiry.contractNo ?? [], next)) {
      await prisma.enquiry.update({ where: { id: enquiry.id }, data: { contractNo: next } });
      updated++;
    }
  }
  return { updated, matched };
}

/**
 * Convenience: sync a single enquiry by party name (avoids scanning all ContractReview rows
 * when only one docket's party changed). Still scans ContractReview for that party.
 */
export async function syncSingleEnquiryContractNumbers(
  enquiryId: string,
  partyName: string,
  prisma: any = defaultPrisma
): Promise<{ updated: boolean; contractNo: string[] }> {
  const key = partyKey(partyName);
  if (!key) {
    await prisma.enquiry.update({ where: { id: enquiryId }, data: { contractNo: [] } });
    return { updated: true, contractNo: [] };
  }
  const contractRows = await prisma.contractReview.findMany({
    where: { partyNameDump: { not: null } },
    select: { contractNo: true, partyNameDump: true },
  });
  const contracts: string[] = [];
  for (const row of contractRows) {
    if (partyKey(row.partyNameDump) !== key) continue;
    const cn = (row.contractNo ?? "").trim();
    if (cn && !contracts.includes(cn)) contracts.push(cn);
  }
  const prev = await prisma.enquiry.findUnique({ where: { id: enquiryId }, select: { contractNo: true } });
  const old = prev?.contractNo ?? [];
  if (!sameContractNos(old, contracts)) {
    await prisma.enquiry.update({ where: { id: enquiryId }, data: { contractNo: contracts } });
    return { updated: true, contractNo: contracts };
  }
  return { updated: false, contractNo: old };
}
