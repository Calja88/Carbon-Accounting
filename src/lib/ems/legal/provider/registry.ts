/**
 * Which `LegalContentProvider` a given provider key resolves to. One
 * switch, one place — same convention as `src/lib/ai/provider-registry.ts`.
 * A second source (e.g. an editorial provider) becomes a sibling file plus
 * a case here; nothing outside this directory names a provider.
 */

import type { LegalContentProvider } from "./types";
import { LegislationGovUkProvider, type LegislationGovUkProviderOptions } from "./legislation-gov-uk";

export function getLegalContentProvider(key: string, options: LegislationGovUkProviderOptions = {}): LegalContentProvider {
  switch (key) {
    case "legislation-gov-uk":
      return new LegislationGovUkProvider(options);
    default:
      throw new Error(`Unknown legal content provider key "${key}".`);
  }
}
