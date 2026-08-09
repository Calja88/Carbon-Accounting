# LCI Integration Pack

Generated: 2026-08-09

## What this pack contains

This is a legally screened **starter LCI/PCF integration pack**, not a replacement for ecoinvent, Sphera, PEF Developer, or a complete unit-process LCI database.

It contains:

- **2,622 import-ready UK Government 2026 total CO2e factors** with published numeric values.
- A **1,652-row product-LCA-relevant subset** covering electricity, fuels, heat, freight, materials, waste, water and refrigerants.
- The complete **3,425-row total-CO2e catalogue**, including 803 source rows where the official revised flat file intentionally has no value. Missing values are preserved as missing and must never be interpreted as zero.
- A source/licence registry for the European Commission PEF/OEF nodes and useful free alternatives.
- A canonical schema and a ready-to-use Claude Code import prompt.
- The original official UK flat file for audit and reproducibility.

## Which file Claude should use

For the LCA module, start with:

`uk_desnz_2026_lca_recommended.csv`

For the wider corporate carbon factor library, use:

`uk_desnz_2026_import_ready.csv`

Do not load `uk_desnz_2026_factor_catalog.csv` as active factors without filtering `factor_status == ACTIVE_PUBLIC`, because it includes rows with no published value.

## Important methodological limitation

The UK factors are characterised GHG conversion factors. They are very useful for UK electricity, fuels, freight, waste, water, refrigerants and some material proxies, but they are **not a complete process-level LCI database**. Every factor in this pack is marked as requiring human review before use in a product LCA.

## Licence screening

The PEF/OEF registry is mainly included as a discovery and licence-control manifest. High-value sources such as ESIG, CEPE, ecoinvent, FEFAC/Blonk and Sphera are not numerically copied into this pack because current terms do not establish a general right to embed or redistribute them in this website.

Only import a source when the manifest decision and the individual dataset licence allow it.

## Attribution

UK Government factors are reused under the Open Government Licence v3.0. Preserve the publisher, source URL, version and licence fields in the website.
