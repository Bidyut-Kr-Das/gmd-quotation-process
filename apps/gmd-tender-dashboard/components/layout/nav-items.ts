// Single source of truth for the top nav (same shape as gmd-quotation-process).
// An entry with `items` renders as a dropdown; otherwise it's a plain tab.
// `roles` hides an entry from users without one of those roles.
export type NavLink = { label: string; href: string; external?: boolean };
export type NavGroup = { label: string; items: NavLink[]; roles?: string[] };
export type NavEntry = (NavLink & { roles?: string[] }) | NavGroup;

export const NAV: NavEntry[] = [
  { label: "Tenders", href: "/tenders" },
  { label: "Contract Review", href: "/contract-review" },
  {
    label: "Admin",
    roles: ["admin", "developer"],
    items: [
      { label: "Column Mappings", href: "/admin/mappings" },
      { label: "Column Index", href: "/admin/indices" },
      { label: "Column Merging", href: "/admin/merging" },
      { label: "SOP Responsibilities", href: "/admin/sop" },
    ],
  },
];

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
