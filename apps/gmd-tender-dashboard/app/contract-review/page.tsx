import { ContractReviewPage } from "@gmd/contract-review/ui";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import * as actions from "./actions";

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default async function Page() {
  return <ContractReviewPage actions={{ ...actions }} flags={await getContractReviewFlags()} />;
}
