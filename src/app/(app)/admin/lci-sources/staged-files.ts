/**
 * The staged pack files this admin flow reads directly from disk, rather
 * than requiring a re-upload of files already committed to the repo (the
 * brief allows either option — this is simpler and avoids a multi-MB
 * browser upload of a file already on the server).
 *
 * Split out from actions.ts because a "use server" module may only export
 * async functions — this plain config/lookup needs to be importable from
 * both the server actions and the client component.
 */
export const STAGED_FILES: Record<string, { path: string; label: string }> = {
  lca_recommended: {
    path: "data/lci-import/uk-desnz-2026/uk_desnz_2026_lca_recommended.csv",
    label: "LCA-recommended subset (1,652 rows) — primary import for the LCA module",
  },
  import_ready: {
    path: "data/lci-import/uk-desnz-2026/uk_desnz_2026_import_ready.csv",
    label: "Import-ready superset (2,622 rows) — wider corporate factor library",
  },
  factor_catalog: {
    path: "data/lci-import/uk-desnz-2026/uk_desnz_2026_factor_catalog.csv",
    label: "Full catalogue (3,425 rows, includes 803 unpublished-value rows shown as rejected)",
  },
};

export function stagedFileOptions() {
  return Object.entries(STAGED_FILES).map(([key, v]) => ({ key, label: v.label }));
}
