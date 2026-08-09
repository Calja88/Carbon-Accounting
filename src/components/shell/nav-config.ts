/**
 * Nav data/config only — no "use client" here, so AppShell (a server
 * component) can call buildNavGroups() directly. The interactive rendering
 * (PrimaryNav, MobileNavToggle) lives in primary-nav.tsx, which is a client
 * component and resolves `icon` (a string key, not a component reference —
 * React Server Components can't pass a component reference as a plain prop
 * across the server/client boundary) via its own ICONS registry.
 */

export type NavIconKey =
  | "overview"
  | "enterData"
  | "historicalData"
  | "documents"
  | "reports"
  | "products"
  | "assessments"
  | "suppliers"
  | "factors"
  | "methodology"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
}

export interface NavGroup {
  /** Null for a standalone top-level link rendered without a dropdown. */
  label: string | null;
  items: NavItem[];
}

export function buildNavGroups(opts: { isAdmin: boolean; historicalDataEnabled: boolean }): NavGroup[] {
  const dataItems: NavItem[] = [{ href: "/data/entry", label: "Enter data", icon: "enterData" }];
  if (opts.historicalDataEnabled) {
    dataItems.push({ href: "/data/entries", label: "Historical data", icon: "historicalData" });
  }

  const groups: NavGroup[] = [
    { label: null, items: [{ href: "/", label: "Overview", icon: "overview" }] },
    { label: "Data", items: dataItems },
    { label: null, items: [{ href: "/documents", label: "Documents", icon: "documents" }] },
    { label: null, items: [{ href: "/reports", label: "Reports", icon: "reports" }] },
    {
      label: "Product LCA",
      items: [
        { href: "/products", label: "Products", icon: "products" },
        { href: "/assessments", label: "Assessments", icon: "assessments" },
        { href: "/suppliers", label: "Suppliers", icon: "suppliers" },
      ],
    },
    {
      label: "Factors & datasets",
      items: [
        { href: "/admin/factors", label: "Emission factors", icon: "factors" },
        { href: "/methodologies", label: "Methodology register", icon: "methodology" },
      ],
    },
  ];

  if (opts.isAdmin) {
    groups.push({ label: null, items: [{ href: "/admin/ai", label: "Settings", icon: "settings" }] });
  }

  return groups;
}
