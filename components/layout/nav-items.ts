// Single source of truth for the top nav.
// An entry with `items` renders as a dropdown; otherwise it's a plain tab.
// To move a page, cut/paste its line between groups or to the top level.
export type NavLink = { label: string; href: string; external?: boolean };
export type NavGroup = { label: string; items: NavLink[] };
export type NavEntry = NavLink | NavGroup;

export const NAV: NavEntry[] = [
  { label: "Quotations", href: "/" },
  {
    label: "Contracts",
    items: [
      { label: "Contract Review", href: "/contract_review" },
      { label: "Indent Checking", href: "/indent_listing" },
      { label: "BIS Status", href: "/bis-status" },
    ],
  },
  {
    label: "Materials",
    items: [
      { label: "Raw Material", href: "/raw_material" },
      { label: "FG BOM", href: "/bom" },
      { label: "Supply History", href: "/supply_history" },
    ],
  },
  { label: "Technical", href: "/technical" },
  { label: "Docket Follow Up", href: "/docket_follow_up" },
  {
    label: "More",
    items: [
      { label: "Upload Image", href: "/upload-image" },
      { label: "Data Sources", href: "/data-sources" },
      { label: "GEM Bid & RA", href: "http://192.168.1.190:6012/", external: true },
      { label: "Tenders", href: "https://gmd-tender-dashboard.vercel.app/tenders", external: true },
    ],
  },
];

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
