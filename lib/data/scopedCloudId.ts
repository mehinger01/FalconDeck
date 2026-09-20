/**
 * Derives a deterministic, injective cloud id from a (parentId, localId)
 * pair.
 *
 * Some local ids (e.g. a ScheduleBlock's id) are only ever guaranteed
 * unique within their own parent (that block's own BellSchedule) - nothing
 * locally requires them to be unique across every schedule a teacher has.
 * A cloud table keyed on a single global primary key needs more than that,
 * so callers that migrate/save such a value must scope it to its parent
 * first, via scopedCloudId(parentId, localId) - never the raw local id
 * alone.
 *
 * Component strings are escaped (backslash, then the separator) before
 * being joined, so two different (parentId, localId) pairs can never
 * produce the same scopedCloudId even if either id happens to already
 * contain the separator character - the join is genuinely injective, not
 * just "unlikely to collide in practice". No randomness is involved: the
 * same pair always produces the same output, which is what keeps
 * migration/save retries idempotent. parseScopedCloudId reverses it
 * exactly, for the read path that needs the original localId back.
 */

const SEPARATOR = ":";

function escapeComponent(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function unescapeComponent(escaped: string): string {
  let result = "";
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === "\\" && i + 1 < escaped.length) {
      result += escaped[i + 1];
      i++;
    } else {
      result += escaped[i];
    }
  }
  return result;
}

export function scopedCloudId(parentId: string, localId: string): string {
  return `${escapeComponent(parentId)}${SEPARATOR}${escapeComponent(localId)}`;
}

/** Reverses scopedCloudId - recovers the original (parentId, localId) pair. */
export function parseScopedCloudId(scoped: string): { parentId: string; localId: string } {
  let splitIndex = -1;
  for (let i = 0; i < scoped.length; i++) {
    if (scoped[i] === "\\") {
      i++; // the next character is escaped, not a real separator - skip it
      continue;
    }
    if (scoped[i] === SEPARATOR) {
      splitIndex = i;
      break;
    }
  }
  if (splitIndex === -1) {
    throw new Error(`parseScopedCloudId: "${scoped}" has no unescaped separator - not a valid scoped id.`);
  }
  return {
    parentId: unescapeComponent(scoped.slice(0, splitIndex)),
    localId: unescapeComponent(scoped.slice(splitIndex + 1)),
  };
}
