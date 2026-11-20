/** Google Maps Platform loader contract (Implemented in Phase 14). */
export interface MapCoordinates {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters?: number;
}
