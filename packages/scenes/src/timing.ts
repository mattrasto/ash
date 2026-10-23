import { DEFAULT_LOCATION, validateLocation, type SceneLocation, type ScenePhase } from './contracts.ts';

const D = Math.PI / 180;
const wrap = (v: number, period = 360) => ((v % period) + period) % period;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export interface SolarState {
  timestamp: number; latitude: number; longitude: number; timeZone: string;
  altitude: number; azimuth: number; rightAscension: number; declination: number; localSiderealTime: number;
  lightingTime: number; rising: boolean; regime: 'normal' | 'polar-day' | 'polar-night';
}

/** Low-order solar ephemeris in UTC; longitude supplies local solar time, timezone labels the host location.
 * Formula reference: https://aa.usno.navy.mil/faq/sun_approx (approximate solar coordinates).
 * Geometric altitude intentionally omits terrain and atmospheric refraction; artwork grading is not a sunrise timetable.
 */
export function solarState(date: Date | number, location: SceneLocation = DEFAULT_LOCATION): SolarState {
  const timestamp = Number(date), { latitude, longitude, timeZone } = validateLocation(location);
  if (!Number.isFinite(timestamp)) throw new Error('Scene clock is invalid.');
  const jd = timestamp / 86400000 + 2440587.5, days = jd - 2451545;
  const meanLongitude = wrap(280.460 + .9856474 * days), anomaly = wrap(357.528 + .9856003 * days) * D;
  const ecliptic = (meanLongitude + 1.915 * Math.sin(anomaly) + .020 * Math.sin(2 * anomaly)) * D;
  const obliquity = (23.439 - .0000004 * days) * D;
  const rightAscension = wrap(Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic)) / D);
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic)) / D;
  const localSiderealTime = wrap(280.46061837 + 360.98564736629 * days + longitude);
  const hourAngle = wrap(localSiderealTime - rightAscension + 180) - 180;
  const lat = latitude * D, dec = declination * D, hour = hourAngle * D;
  const altitude = Math.asin(clamp(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hour), -1, 1)) / D;
  const azimuth = wrap(Math.atan2(-Math.sin(hour) * Math.cos(dec), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hour)) / D);
  const rising = hourAngle < 0;
  const maxAltitude = 90 - Math.abs(latitude - declination), minAltitude = Math.abs(latitude + declination) - 90;
  const regime = minAltitude > -.833 ? 'polar-day' : maxAltitude < -.833 ? 'polar-night' : 'normal';
  return { timestamp, latitude, longitude, timeZone, altitude, azimuth, rightAscension, declination, localSiderealTime, rising, regime, lightingTime: lightingTime(altitude, rising) };
}

// Artwork grading is indexed by a reference day; actual sunrise/season comes from altitude, never local wall-clock hour.
export function lightingTime(altitude: number, rising: boolean): number {
  const knots = rising ? [[-18, 270], [-6, 330], [0, 360], [18, 480], [50, 720]] : [[-18, 1260], [-6, 1170], [0, 1080], [18, 960], [50, 720]];
  if (altitude <= -18) return rising ? 270 : 1260;
  if (altitude >= 50) return 720;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!, b = knots[i + 1]!;
    if (altitude >= a[0]! && altitude <= b[0]!) return a[1]! + (b[1]! - a[1]!) * (altitude - a[0]!) / (b[0]! - a[0]!);
  }
  return 720;
}

/** Overrides hold sky rotation at a representative phase while the independent animation clock advances. */
export function phaseSolarState(date: Date | number, location: SceneLocation, phase: ScenePhase): SolarState {
  if (phase === 'automatic') return solarState(date, location);
  const timestamp = Number(date), noonUTC = Math.floor(timestamp / 86400000) * 86400000 + (12 - location.longitude / 15) * 3600000;
  const offsets = { dawn: -6, day: 0, dusk: 6, night: 12 };
  const state = solarState(noonUTC + offsets[phase] * 3600000, location);
  const altitude = { dawn: -1, day: 50, dusk: -1, night: -28 }[phase];
  const azimuth = { dawn: 90, day: location.latitude >= 0 ? 180 : 0, dusk: 270, night: location.latitude >= 0 ? 0 : 180 }[phase];
  return { ...state, altitude, azimuth, rising: phase === 'dawn', lightingTime: lightingTime(altitude, phase === 'dawn') };
}

export function interpolateSolarState(from: SolarState, to: SolarState, fraction: number): SolarState {
  const t = clamp(fraction, 0, 1), lerp = (a: number, b: number) => a + (b - a) * t;
  const angle = (a: number, b: number, period = 360) => wrap(a + (wrap(b - a + period / 2, period) - period / 2) * t, period);
  return { ...to, altitude: lerp(from.altitude, to.altitude), azimuth: angle(from.azimuth, to.azimuth), localSiderealTime: angle(from.localSiderealTime, to.localSiderealTime), lightingTime: angle(from.lightingTime, to.lightingTime, 1440) };
}
