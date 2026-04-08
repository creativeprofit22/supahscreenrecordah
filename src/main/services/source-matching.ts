/**
 * Source matching — finds the best desktopCapturer source for a given
 * pending source ID and name. Used by setDisplayMediaRequestHandler to
 * resolve toolbar selections to actual capturable sources.
 */

export interface MatchableSource {
  id: string;
  name: string;
}

export interface MatchResult {
  source: MatchableSource;
  method: 'id' | 'exact-name' | 'fuzzy-name' | 'app-suffix' | 'fallback';
}

/**
 * Find the best matching source from the available sources list.
 * Tries multiple strategies in order of confidence:
 * 1. Exact ID match
 * 2. Exact name match
 * 3. Fuzzy name match (substring containment)
 * 4. App suffix match (e.g. " - Google Chrome")
 * 5. Fallback to first source
 */
export function findMatchingSource(
  sources: MatchableSource[],
  pendingId: string | null,
  pendingName: string | null,
): MatchResult | null {
  if (sources.length === 0) {
    return null;
  }

  // 1. Exact ID match
  if (pendingId) {
    const target = sources.find((s) => s.id === pendingId);
    if (target) {
      return { source: target, method: 'id' };
    }
  }

  // 2. Exact name match
  if (pendingName) {
    const target = sources.find((s) => s.name === pendingName);
    if (target) {
      return { source: target, method: 'exact-name' };
    }
  }

  // 3. Fuzzy name match (substring containment)
  if (pendingName) {
    const pending = pendingName.toLowerCase();
    const target = sources.find((s) => {
      const name = s.name.toLowerCase();
      return name.includes(pending) || pending.includes(name);
    });
    if (target) {
      return { source: target, method: 'fuzzy-name' };
    }
  }

  // 4. App suffix match (e.g. both end with " - Google Chrome")
  if (pendingName) {
    const pendingSuffix = pendingName.lastIndexOf(' - ');
    if (pendingSuffix >= 0) {
      const suffix = pendingName.substring(pendingSuffix).toLowerCase();
      const target = sources.find((s) => s.name.toLowerCase().endsWith(suffix));
      if (target) {
        return { source: target, method: 'app-suffix' };
      }
    }
  }

  // 5. Fallback to first source
  return { source: sources[0], method: 'fallback' };
}
