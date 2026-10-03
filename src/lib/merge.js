/**
 * Three-way merge for lists edited in two places at once.
 *
 * `base` is the list as this device last saw it, `mine` is what this device
 * wants it to become, and `server` is what it is now — possibly changed by
 * someone else in between. The result applies only what this device
 * actually changed, on top of the server's version:
 *
 *   - an item this device removed (in base, not in mine) is removed;
 *   - an item this device added (in mine, not in base) is added;
 *   - an item this device changed gets those fields, and only those —
 *     a field someone else changed meanwhile is kept;
 *   - an item someone else added (on the server, not in base) is kept;
 *   - an item someone else removed (in base, not on the server) stays
 *     removed, unless this device changed it.
 *
 * Writing "mine" back wholesale is what used to happen: saving the trip
 * editor erased a family that had joined while it was open, and two people
 * editing one day of the itinerary overwrote each other.
 *
 * Order follows `mine`; items only the server has go where they were
 * relative to their neighbours on the server, or at the end.
 *
 * No imports, so the tests can load it without a bundler.
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function mergeList(server = [], base = [], mine = [], keyOf = (x) => x.id) {
  const baseBy = new Map(base.map((x) => [keyOf(x), x]))
  const mineBy = new Map(mine.map((x) => [keyOf(x), x]))
  const serverBy = new Map(server.map((x) => [keyOf(x), x]))

  const result = []
  for (const item of mine) {
    const key = keyOf(item)
    const before = baseBy.get(key)
    const now = serverBy.get(key)
    if (!before) {
      result.push(item) // added here
    } else if (!now) {
      // Removed elsewhere. Kept only if this device changed it meanwhile.
      if (!same(before, item)) result.push(item)
    } else if (same(before, item)) {
      result.push(now) // untouched here: the server's version wins
    } else {
      // Changed here: those fields, on top of the server's version.
      const changed = {}
      for (const field of new Set([...Object.keys(before), ...Object.keys(item)])) {
        if (!same(before[field], item[field])) changed[field] = item[field]
      }
      const merged = { ...now, ...changed }
      for (const [field, value] of Object.entries(changed)) if (value === undefined) delete merged[field]
      result.push(merged)
    }
  }

  // Added elsewhere: keep, placed after the item that precedes it there.
  server.forEach((item, i) => {
    const key = keyOf(item)
    if (baseBy.has(key) || mineBy.has(key)) return
    const prevKey = i > 0 ? keyOf(server[i - 1]) : null
    const at = prevKey == null ? -1 : result.findIndex((x) => keyOf(x) === prevKey)
    if (at >= 0) result.splice(at + 1, 0, item)
    else result.push(item)
  })

  return result
}
