/** Great-circle distance between two points, in meters. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Steps from distance walked — there is no way for a web app to read a
 * phone's real hardware pedometer, only GPS movement. An average stride
 * turns that into a step count that is honestly an estimate, not a
 * measurement, and every place this is shown says so.
 */
const STRIDE_M = 0.75
export const stepsFromMeters = (m) => Math.round(m / STRIDE_M)
