import {getPublicEnvConfig} from '@/config/env';

/** Default map center: Cairo, Egypt (stored as lat/lng object) */
export const DEFAULT_EGYPT_MAP_CENTER: MapCoordinates = {
  lat: 30.04442,
  lng: 31.235712,
};

/** Mapbox GL JS strictly expects [lng, lat] order (longitude first, latitude second) */
export type MapboxLngLatTuple = readonly [lng: number, lat: number];

export const DEFAULT_EGYPT_MAPBOX_CENTER: MapboxLngLatTuple = [
  DEFAULT_EGYPT_MAP_CENTER.lng,
  DEFAULT_EGYPT_MAP_CENTER.lat,
];

export interface MapCoordinates {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters?: number;
}

/**
 * Converts { lat, lng } domain coordinates into Mapbox GL JS [lng, lat] tuple order.
 */
export function toMapboxLngLat(coords: Pick<MapCoordinates, 'lat' | 'lng'>): MapboxLngLatTuple {
  return [coords.lng, coords.lat];
}

export function isValidMapboxPublicToken(token: string | null | undefined): token is string {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed || trimmed.includes('[Redacted]')) return false;
  const parts = trimmed.split('.');
  return trimmed.startsWith('pk.') && parts.length === 3 && parts.every((part) => part.length > 0);
}

export function getMapboxAccessToken(): string | null {
  const token = getPublicEnvConfig().mapboxAccessToken;
  return isValidMapboxPublicToken(token) ? token : null;
}

export function isValidCoordinatePair(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Computes Haversine distance in kilometers between two GPS coordinates.
 */
export function computeDistanceKm(a: MapCoordinates, b: MapCoordinates): number {
  if (!isValidCoordinatePair(a.lat, a.lng) || !isValidCoordinatePair(b.lat, b.lng)) {
    return 0;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function computeRouteTotalDistanceKm(points: readonly MapCoordinates[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += computeDistanceKm(points[i - 1], points[i]);
  }
  return Number(total.toFixed(2));
}

export function formatCoordinatesLabel(lat: number, lng: number): string {
  if (!isValidCoordinatePair(lat, lng)) return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function buildExternalMapPinUrl(lat: number, lng: number): string {
  if (!isValidCoordinatePair(lat, lng)) return 'https://www.openstreetmap.org';
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
}

/**
 * Generates an opaque, deterministic browser device fingerprint without exposing PII.
 */
export function getBrowserDeviceFingerprint(): string {
  try {
    const storageKey = 'shipflow_courier_device_fp';
    const existing = window.localStorage.getItem(storageKey);
    if (existing && existing.length >= 8) return existing;
    const generated = `web-${crypto.randomUUID().slice(0, 12)}`;
    window.localStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return 'web-browser-default';
  }
}
