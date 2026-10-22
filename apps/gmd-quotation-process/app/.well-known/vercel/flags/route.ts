import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";
import * as flags from "@/flags";

// Lets the Vercel Toolbar's Flags Explorer list this app's flags. Requests are
// verified with FLAGS_SECRET, so the endpoint is closed when it is unset.
export const GET = createFlagsDiscoveryEndpoint(() => getProviderData(flags));
