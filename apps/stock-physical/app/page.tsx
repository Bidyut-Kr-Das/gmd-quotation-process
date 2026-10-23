import { PhysicalStockPage } from "@gmd/physical-stock/ui";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import * as actions from "./actions";

export default async function Page() {
  return <PhysicalStockPage flags={await getPhysicalStockFlags()} actions={{...actions}} showHeader={false} />;
}
