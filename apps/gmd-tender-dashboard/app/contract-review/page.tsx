import { ContractReviewPage } from "@gmd/contract-review/ui";
import * as actions from "./actions";

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default function Page() {
  return <ContractReviewPage actions={{ ...actions }} />;
}
