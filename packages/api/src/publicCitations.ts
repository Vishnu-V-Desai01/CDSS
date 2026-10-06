// packages/api/src/publicCitations.ts
/**
 * Which citation ids may be shown to the client.
 *
 * A citation used ONLY by values behind the UNKNOWN aggregate can name or
 * describe a hidden condition (its id, title or notes). Such citations are
 * withheld individually and replaced by one neutral id. A citation that also
 * supports a reportable condition is already public and is left alone.
 */

import { CANDIDATE_IDS } from "@cds/shared-types";
import type { LoadedPack } from "./packLoader.js";

export const UNKNOWN_BASIS_ID = "UNKNOWN_BASIS";

const IN_SCOPE: ReadonlySet<string> = new Set<string>(CANDIDATE_IDS);

export interface PublicCitationMap {
  /** The id the client may see for this citation. */
  publicId(citationId: string): string;
  /** Citation ids that support only the UNKNOWN aggregate. Server-side only. */
  withheldIds: ReadonlySet<string>;
}

export function buildPublicCitationMap(pack: LoadedPack): PublicCitationMap {
  const inScopeIds = new Set<string>();
  const hiddenOnlyIds = new Set<string>();

  for (const condition of Object.values(pack.conditions)) {
    const target = IN_SCOPE.has(condition.condition_id) ? inScopeIds : hiddenOnlyIds;
    for (const prior of Object.values(condition.priors)) {
      if (prior) target.add(prior.citation_id);
    }
    for (const feature of condition.features) {
      for (const state of feature.states) {
        if (state.citation_id) target.add(state.citation_id);
      }
    }
  }

  const withheldIds = new Set<string>(
    [...hiddenOnlyIds].filter((id) => !inScopeIds.has(id))
  );

  return {
    publicId: (citationId) => (withheldIds.has(citationId) ? UNKNOWN_BASIS_ID : citationId),
    withheldIds,
  };
}