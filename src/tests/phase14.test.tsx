import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {CourierMapCanvas} from '@/features/couriers/CourierMapCanvas';
import {
  DEFAULT_EGYPT_MAPBOX_CENTER,
  buildExternalMapPinUrl,
  computeDistanceKm,
  computeRouteTotalDistanceKm,
  isValidCoordinatePair,
  isValidMapboxPublicToken,
  toMapboxLngLat,
} from '@/lib/maps';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {
  CourierLivePosition,
  CourierMovementsTimelineResult,
  CourierRecord,
  TenantMapsSettingsRecord,
} from '@/types/couriers';
import type {CourierPortalTasksFeed, TenantDeliveryPolicyRecord} from '@/types/delivery';
import type {TenantMessagingSettings} from '@/types/messaging';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListCouriers = vi.fn();
const mockGetLiveCouriersPositions = vi.fn();
const mockListCourierMovementsTimeline = vi.fn();
const mockRecordCourierLocationEvent = vi.fn();
const mockGetTenantMapsSettings = vi.fn();
const mockUpdateTenantMapsSettings = vi.fn();
const mockPurgeExpiredCourierLocations = vi.fn();
const mockListExceptionReasons = vi.fn();
const mockGetTenantDeliveryPolicy = vi.fn();
const mockListCourierMyTasks = vi.fn();
const mockRecordDeliveryExecution = vi.fn();
const mockGetTenantMessagingSettings = vi.fn();

const mockMapInstance = {
  addControl: vi.fn(),
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'load') cb();
  }),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(() => undefined),
  flyTo: vi.fn(),
  fitBounds: vi.fn(),
  resize: vi.fn(),
  remove: vi.fn(),
};
const mockMapConstructor = vi.fn((_opts?: unknown) => mockMapInstance);
const mockMarkerSetLngLat = vi.fn();
const mockMarkerInstance = {
  setLngLat: vi.fn((coords: [number, number]) => {
    mockMarkerSetLngLat(coords);
    return mockMarkerInstance;
  }),
  setPopup: vi.fn(() => mockMarkerInstance),
  addTo: vi.fn(() => mockMarkerInstance),
  togglePopup: vi.fn(),
  remove: vi.fn(),
};
const mockBoundsExtend = vi.fn();

vi.mock('mapbox-gl', () => {
  const MapMock = function (this: unknown, opts: unknown) {
    return mockMapConstructor(opts);
  };
  const MarkerMock = function (this: unknown) {
    return mockMarkerInstance;
  };
  const PopupMock = function (this: unknown) {
    return {
      setDOMContent: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    };
  };
  const NavigationControlMock = function (this: unknown) {
    return {};
  };
  const LngLatBoundsMock = function (this: unknown) {
    return {
      extend: mockBoundsExtend,
    };
  };

  return {
    default: {
      accessToken: '',
      Map: MapMock,
      Marker: MarkerMock,
      Popup: PopupMock,
      NavigationControl: NavigationControlMock,
      LngLatBounds: LngLatBoundsMock,
    },
  };
});

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/security/securityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/security/securityService')>();
  return {
    ...actual,
    getMyTenantPermissions: (...args: unknown[]) => mockGetMyTenantPermissions(...args),
  };
});

vi.mock('@/features/definitions/definitionsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/definitions/definitionsService')>();
  return {
    ...actual,
    listBranches: (...args: unknown[]) => mockListBranches(...args),
    listExceptionReasons: (...args: unknown[]) => mockListExceptionReasons(...args),
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
    getLiveCouriersPositions: (...args: unknown[]) => mockGetLiveCouriersPositions(...args),
    listCourierMovementsTimeline: (...args: unknown[]) => mockListCourierMovementsTimeline(...args),
    recordCourierLocationEvent: (...args: unknown[]) => mockRecordCourierLocationEvent(...args),
    getTenantMapsSettings: (...args: unknown[]) => mockGetTenantMapsSettings(...args),
    updateTenantMapsSettings: (...args: unknown[]) => mockUpdateTenantMapsSettings(...args),
    purgeExpiredCourierLocations: (...args: unknown[]) => mockPurgeExpiredCourierLocations(...args),
  };
});

vi.mock('@/features/delivery/deliveryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/delivery/deliveryService')>();
  return {
    ...actual,
    getTenantDeliveryPolicy: (...args: unknown[]) => mockGetTenantDeliveryPolicy(...args),
    listCourierMyTasks: (...args: unknown[]) => mockListCourierMyTasks(...args),
    recordDeliveryExecution: (...args: unknown[]) => mockRecordDeliveryExecution(...args),
  };
});

vi.mock('@/features/messaging/messagingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/messaging/messagingService')>();
  return {
    ...actual,
    getUnreadNotificationsCount: vi.fn().mockResolvedValue(0),
    subscribeToMessagingUpdates: vi.fn().mockReturnValue(() => undefined),
    getTenantMessagingSettings: (...args: unknown[]) => mockGetTenantMessagingSettings(...args),
  };
});

const tenantAlpha: TenantRecord = {
  id: 'ten-alpha',
  code: 'TEN_ALPHA',
  slug: 'alpha-express',
  name: 'ألفا إكسبريس للشحن',
  status: 'active',
  default_currency: 'EGP',
  default_timezone: 'Africa/Cairo',
  default_locale: 'ar-EG',
  created_at: '2026-11-21T00:00:00Z',
  updated_at: '2026-11-21T00:00:00Z',
};

const membershipOwner: TenantMembershipRecord = {
  id: 'mem-owner',
  tenant_id: 'ten-alpha',
  user_id: 'user-owner-1',
  username: 'owner_alpha',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const membershipCourier: TenantMembershipRecord = {
  id: 'mem-courier',
  tenant_id: 'ten-alpha',
  user_id: 'user-courier-1',
  username: 'mandob_1',
  account_subject_type: AccountSubjectType.COURIER,
  role_key: 'delivery_agent',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const sampleCourier: CourierRecord = {
  id: 'crr-1',
  tenant_id: 'ten-alpha',
  code: 'CR-001',
  name: 'كريم المنصور',
  branch_id: 'br-1',
  ledger_account_id: null,
  custody_account_id: null,
  default_route_id: 'rt-1',
  commission_list_id: 'cl-1',
  default_commission_type: 'fixed_amount',
  default_commission_value: 25,
  country_id: null,
  governorate_id: null,
  city_id: null,
  region_id: null,
  phone: null,
  mobile: '01099887766',
  po_box: null,
  postal_code: null,
  address_line: null,
  email: null,
  is_active: true,
  archived_at: null,
  created_at: '2026-11-21T08:00:00Z',
};

const livePositionsSample: readonly CourierLivePosition[] = [
  {
    courier_id: 'crr-1',
    courier_code: 'CR-001',
    courier_name: 'كريم المنصور',
    courier_mobile: '01099887766',
    branch_id: 'br-1',
    branch_name: 'الفرع الرئيسي',
    is_active: true,
    last_event_id: 'ev-1',
    event_type: 'delivery_attempt',
    lat: 30.04442,
    lng: 31.235712,
    accuracy_meters: 10,
    speed_mps: null,
    heading_deg: null,
    source: 'gps_browser',
    last_recorded_at: '2026-11-21T11:30:00Z',
    last_shipment_id: 'shp-1',
    last_shipment_number: 'SHP-0001401',
    active_shipments_count: 3,
    today_events_count: 2,
  },
];

const timelineSample: CourierMovementsTimelineResult = {
  courier: {
    id: 'crr-1',
    code: 'CR-001',
    name: 'كريم المنصور',
    mobile: '01099887766',
    branch_id: 'br-1',
    branch_name: 'الفرع الرئيسي',
    is_active: true,
  },
  date_from: '2026-11-21',
  date_to: '2026-11-21',
  events: [
    {
      id: 'ev-start',
      tenant_id: 'ten-alpha',
      courier_id: 'crr-1',
      device_id: 'dev-1',
      shipment_id: null,
      shipment_number: null,
      shipment_status: null,
      recipient_name: null,
      recipient_address: null,
      delivery_list_id: null,
      delivery_list_code: null,
      event_type: 'shift_start',
      lat: 30.04442,
      lng: 31.235712,
      accuracy_meters: 14,
      speed_mps: null,
      heading_deg: null,
      source: 'gps_browser',
      notes: 'انطلاق من الفرع',
      recorded_at: '2026-11-21T09:00:00Z',
    },
    {
      id: 'ev-deliv',
      tenant_id: 'ten-alpha',
      courier_id: 'crr-1',
      device_id: 'dev-1',
      shipment_id: 'shp-1',
      shipment_number: 'SHP-0001401',
      shipment_status: 'delivered',
      recipient_name: 'أحمد سامي',
      recipient_address: 'مدينة نصر',
      delivery_list_id: null,
      delivery_list_code: null,
      event_type: 'delivery_attempt',
      lat: 30.06263,
      lng: 31.32967,
      accuracy_meters: 8,
      speed_mps: null,
      heading_deg: null,
      source: 'delivery_pod',
      notes: 'تسليم بنجاح',
      recorded_at: '2026-11-21T10:15:00Z',
    },
  ],
  active_shipments: [],
};

const defaultMapsSettings: TenantMapsSettingsRecord = {
  tenant_id: 'ten-alpha',
  location_retention_days: 90,
  gps_ping_interval_seconds: 60,
  require_gps_on_delivery: false,
};

const defaultDeliveryPolicy: TenantDeliveryPolicyRecord = {
  tenant_id: 'ten-alpha',
  max_delivery_attempts: 3,
  retry_extra_fee: 0,
  require_pod_on_delivery: false,
};

const defaultMessagingSettings: TenantMessagingSettings = {
  tenant_id: 'ten-alpha',
  message_retention_days: 365,
  attachment_max_size_mb: 5,
  notify_on_shipment_status: true,
  notify_on_new_message: true,
  notify_on_settlement: true,
};

describe('Phase 14 - Mapbox GL JS, Live Courier Movements & GPS Retention', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-owner-1', email: 'owner@internal.test'},
      profile: {id: 'user-owner-1', display_name: 'أحمد مالك الشركة', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipOwner],
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    mockGetMyTenantPermissions.mockResolvedValue({
      client_id: null,
      courier_id: null,
      branch_ids: ['br-1'],
      permissions: [
        {permission_key: 'couriers.read', scope: PermissionScope.TENANT},
        {permission_key: 'couriers.locations_read', scope: PermissionScope.TENANT},
        {permission_key: 'couriers.locations_record', scope: PermissionScope.TENANT},
        {permission_key: 'operations.delivery.execute', scope: PermissionScope.TENANT},
      ],
    });

    mockListBranches.mockResolvedValue([
      {id: 'br-1', tenant_id: 'ten-alpha', code: 'MAIN', name: 'الفرع الرئيسي', is_main: true, is_active: true},
    ]);
    mockListCouriers.mockResolvedValue([sampleCourier]);
    mockGetLiveCouriersPositions.mockResolvedValue(livePositionsSample);
    mockListCourierMovementsTimeline.mockResolvedValue(timelineSample);
    mockRecordCourierLocationEvent.mockImplementation(async (_ten, payload) => ({
      id: 'ev-new-1',
      tenant_id: 'ten-alpha',
      courier_id: payload.courier_id ?? 'crr-1',
      device_id: 'dev-1',
      shipment_id: payload.shipment_id ?? null,
      delivery_list_id: payload.delivery_list_id ?? null,
      event_type: payload.event_type,
      lat: payload.lat,
      lng: payload.lng,
      accuracy_meters: payload.accuracy_meters ?? 10,
      speed_mps: null,
      heading_deg: null,
      source: payload.source ?? 'manual_pin',
      notes: payload.notes ?? null,
      recorded_at: '2026-11-21T12:00:00Z',
    }));
    mockGetTenantMapsSettings.mockResolvedValue(defaultMapsSettings);
    mockUpdateTenantMapsSettings.mockImplementation(async (_ten, payload) => ({
      tenant_id: 'ten-alpha',
      ...payload,
    }));
    mockPurgeExpiredCourierLocations.mockResolvedValue(14);
    mockListExceptionReasons.mockResolvedValue([
      {id: 'exc-1', tenant_id: 'ten-alpha', code: 'NO_ANS', name: 'لا يرد', is_active: true},
    ]);
    mockGetTenantDeliveryPolicy.mockResolvedValue(defaultDeliveryPolicy);
    mockGetTenantMessagingSettings.mockResolvedValue(defaultMessagingSettings);
  });

  it('validates Mapbox [lng, lat] order helpers, pk.* token validator, and Haversine distances cleanly', () => {
    expect(DEFAULT_EGYPT_MAPBOX_CENTER).toEqual([31.235712, 30.04442]);
    expect(toMapboxLngLat({lat: 30.04442, lng: 31.235712})).toEqual([31.235712, 30.04442]);

    expect(isValidMapboxPublicToken('pk.eyJ1IjoidGVzdCJ9.sig123')).toBe(true);
    expect(isValidMapboxPublicToken('pk.eyJ1IjoidGVzdCJ9.[Redacted]')).toBe(false);
    expect(isValidMapboxPublicToken('sk.secret_token.123')).toBe(false);

    expect(isValidCoordinatePair(30.04442, 31.235712)).toBe(true);
    expect(isValidCoordinatePair(95, 31.2)).toBe(false);
    expect(isValidCoordinatePair(30, 190)).toBe(false);

    const dist = computeDistanceKm(
      {lat: 30.04442, lng: 31.235712},
      {lat: 30.06263, lng: 31.32967},
    );
    expect(dist).toBeGreaterThan(8);
    expect(dist).toBeLessThan(12);

    expect(
      computeRouteTotalDistanceKm([
        {lat: 30.04442, lng: 31.235712},
        {lat: 30.06263, lng: 31.32967},
      ]),
    ).toBeCloseTo(dist, 2);

    expect(buildExternalMapPinUrl(30.04442, 31.235712)).toContain(
      'https://www.openstreetmap.org/?mlat=30.04442&mlon=31.235712',
    );
  });

  it('initializes Mapbox GL JS strictly with [lng, lat] order for center, markers, bounds, and route GeoJSON', () => {
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'pk.headerPart.signaturePart');

    render(
      <CourierMapCanvas
        drawRouteLine={true}
        markers={[
          {
            id: 'm-1',
            lat: 30.04442,
            lng: 31.235712,
            title: 'بداية الوردية',
            subtitle: 'القاهرة',
            tone: 'start',
            orderNumber: 1,
          },
          {
            id: 'm-2',
            lat: 30.06263,
            lng: 31.32967,
            title: 'نقطة تسليم',
            subtitle: 'مدينة نصر',
            tone: 'delivery',
            orderNumber: 2,
          },
        ]}
      />,
    );

    expect(screen.getByTestId('mapbox-canvas-container')).toBeInTheDocument();
    expect(mockMapConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [31.32967, 30.06263],
      }),
    );
    expect(mockMarkerSetLngLat).toHaveBeenNthCalledWith(1, [31.235712, 30.04442]);
    expect(mockMarkerSetLngLat).toHaveBeenNthCalledWith(2, [31.32967, 30.06263]);
    expect(mockBoundsExtend).toHaveBeenNthCalledWith(1, [31.235712, 30.04442]);
    expect(mockBoundsExtend).toHaveBeenNthCalledWith(2, [31.32967, 30.06263]);
    expect(mockMapInstance.addSource).toHaveBeenCalledWith(
      'courier-route-source',
      expect.objectContaining({
        type: 'geojson',
        data: expect.objectContaining({
          features: [
            expect.objectContaining({
              geometry: {
                type: 'LineString',
                coordinates: [
                  [31.235712, 30.04442],
                  [31.32967, 30.06263],
                ],
              },
            }),
          ],
        }),
      }),
    );
  });

  it('renders live couriers map fallback, switches to timeline view, and records manual pin', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/movements']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'تحركات مندوب الشحن والخريطة الحية'})).toBeInTheDocument();
      expect(screen.getAllByText('SHP-0001401').length).toBeGreaterThanOrEqual(1);
    });

    // Fallback tracking board renders live coordinates cleanly
    expect(
      screen.getByText('لوحة التتبع والإحداثيات (وضع التهيئة الميدانية لـ Mapbox GL JS)'),
    ).toBeInTheDocument();

    // Switch to timeline via row action
    fireEvent.click(screen.getByRole('button', {name: 'عرض المسار'}));

    await waitFor(() => {
      expect(mockListCourierMovementsTimeline).toHaveBeenCalledWith(
        'ten-alpha',
        'crr-1',
        expect.any(String),
        expect.any(String),
      );
      expect(screen.getAllByText('انطلاق من الفرع').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('تسليم بنجاح')).toBeInTheDocument();
    });

    // Open manual pin form & save location
    fireEvent.click(screen.getByRole('button', {name: 'تثبيت نقطة يدوية'}));
    fireEvent.change(screen.getByLabelText('ملاحظة ميدانية'), {
      target: {value: 'نقطة تجمع وسط البلد'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ النقطة'}));

    await waitFor(() => {
      expect(mockRecordCourierLocationEvent).toHaveBeenCalledWith(
        'ten-alpha',
        expect.objectContaining({
          courier_id: 'crr-1',
          source: 'manual_pin',
          notes: 'نقطة تجمع وسط البلد',
        }),
      );
    });
  });

  it('allows bound courier in CourierPortalPage to share GPS shift location and enforce required GPS on delivery', async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-courier-1', email: 'mandob@internal.test'},
      profile: {id: 'user-courier-1', display_name: 'كريم المنصور', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipCourier],
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });
    mockGetMyTenantPermissions.mockResolvedValue({
      client_id: null,
      courier_id: 'crr-1',
      branch_ids: ['br-1'],
      permissions: [
        {permission_key: 'operations.delivery.execute', scope: PermissionScope.ASSIGNED},
        {permission_key: 'couriers.locations_record', scope: PermissionScope.ASSIGNED},
      ],
    });
    mockGetTenantMapsSettings.mockResolvedValue({
      tenant_id: 'ten-alpha',
      location_retention_days: 60,
      gps_ping_interval_seconds: 30,
      require_gps_on_delivery: true,
    });

    const feed: CourierPortalTasksFeed = {
      courier: {id: 'crr-1', code: 'CR-001', name: 'كريم المنصور', branch_id: 'br-1', mobile: '01099887766'},
      delivery_lists: [],
      pickup_lists: [],
      shipments: [
        {
          id: 'shp-1',
          tenant_id: 'ten-alpha',
          shipment_number: 'SHP-0001401',
          barcode_token: 'BC-1401',
          client_id: 'cl-1',
          client_name: 'متجر النيل',
          origin_branch_id: 'br-1',
          current_branch_id: 'br-1',
          destination_branch_id: null,
          assigned_courier_id: 'crr-1',
          movement_type_id: null,
          shipment_type_id: 'st-1',
          shipment_type_code: 'FDP',
          service_id: 'srv-1',
          payment_term_id: 'pt-1',
          payment_term_code: 'COD',
          price_mode: 'shipping_excluded',
          operational_status: 'out_for_delivery',
          is_created_confirmed: true,
          is_collected_from_courier: false,
          is_settled_to_client: false,
          is_courier_commission_paid: false,
          entered_amount: 450,
          prepaid_balance_amount: 0,
          total_shipping_fee: 65,
          return_fee: 40,
          recipient_collect_amount: 450,
          client_net_payout: 385,
          delivered_amount: null,
          pieces_count: 1,
          delivered_pieces_count: 0,
          returned_pieces_count: 0,
          partial_return_custody: 'none',
          exchange_status: 'none',
          actual_weight_kg: 2,
          chargeable_weight_kg: 2,
          allow_package_opening: false,
          package_description: 'طرد إلكترونيات',
          external_reference: null,
          notes: null,
          pickup_date: '2026-11-21',
          pickup_time_from: null,
          pickup_time_to: null,
          current_snapshot_id: null,
          sender_governorate_id: 'gov-1',
          sender_region_id: 'reg-1',
          recipient_governorate_id: 'gov-1',
          recipient_region_id: 'reg-1',
          delivery_attempts_count: 0,
          last_exception_reason_id: null,
          delivered_at: null,
          returned_at: null,
          cancelled_at: null,
          recipient_name: 'أحمد سامي',
          recipient_mobile: '01055544433',
          recipient_address: 'مدينة نصر',
          created_at: '2026-11-21T09:00:00Z',
          updated_at: '2026-11-21T09:30:00Z',
        },
      ],
    };
    mockListCourierMyTasks.mockResolvedValue(feed);
    mockRecordDeliveryExecution.mockResolvedValue({
      shipment_id: 'shp-1',
      operational_status: 'delivered',
      delivery_attempts_count: 1,
      accrued_courier_commission: 25,
      auto_returned_by_limit: false,
    });

    // Stub browser geolocation
    const mockGetCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 30.05612,
          longitude: 31.33011,
          accuracy: 9.4,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        } as GeolocationCoordinates,
        timestamp: Date.now(),
        toJSON: () => ({}),
      });
    });
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {getCurrentPosition: mockGetCurrentPosition},
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/courier-portal']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-0001401')).toBeInTheDocument();
    });

    // Courier triggers shift_start GPS ping
    fireEvent.click(screen.getByRole('button', {name: /بدء الوردية \(GPS\)/}));
    await waitFor(() => {
      expect(mockRecordCourierLocationEvent).toHaveBeenCalledWith(
        'ten-alpha',
        expect.objectContaining({
          event_type: 'shift_start',
          lat: 30.05612,
          lng: 31.33011,
          source: 'gps_browser',
        }),
      );
    });

    // Open route map tab
    fireEvent.click(screen.getByRole('button', {name: /خريطة مساري/}));
    expect(
      screen.getByText('لوحة التتبع والإحداثيات (وضع التهيئة الميدانية لـ Mapbox GL JS)'),
    ).toBeInTheDocument();

    // Go back to shipments & execute delivery with required GPS check
    fireEvent.click(screen.getByRole('button', {name: /شحنات المهام المسندة/}));
    fireEvent.click(screen.getByRole('button', {name: 'تسجيل التسليم / التعذر'}));

    await waitFor(() => {
      expect(screen.getByText('توثيق إحداثيات الموقع (GPS) *')).toBeInTheDocument();
    });

    // Trying to submit without capturing GPS fails due to require_gps_on_delivery = true
    fireEvent.click(screen.getByRole('button', {name: 'حفظ نتيجة التوصيل'}));
    await waitFor(() => {
      expect(
        screen.getByText('سياسة الشركة تتطلب توثيق إحداثيات الموقع الميداني (GPS) قبل حفظ نتيجة التوصيل.'),
      ).toBeInTheDocument();
    });

    // Capture GPS & submit delivery execution
    fireEvent.click(screen.getByRole('button', {name: 'التقاط الموقع الآن'}));
    await waitFor(() => {
      expect(screen.getByText(/30\.05612, 31\.33011/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'حفظ نتيجة التوصيل'}));
    await waitFor(() => {
      expect(mockRecordDeliveryExecution).toHaveBeenCalled();
      expect(mockRecordCourierLocationEvent).toHaveBeenCalledWith(
        'ten-alpha',
        expect.objectContaining({
          shipment_id: 'shp-1',
          event_type: 'delivery_attempt',
          source: 'delivery_pod',
        }),
      );
    });
  });

  it('allows Tenant Admin to configure ADR-022 Maps & GPS retention policy and purge expired logs', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/settings']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('سياسة الخرائط وتتبع مواقع المندوبين')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('مدة الاحتفاظ بسجل مواقع المندوبين (بالأيام)'), {
      target: {value: '45'},
    });
    fireEvent.change(screen.getByLabelText('فاصل تحديث الموقع الميداني (بالثواني)'), {
      target: {value: '30'},
    });
    fireEvent.click(screen.getByLabelText(/إلزام توثيق إحداثيات GPS عند تسجيل التسليم/));
    fireEvent.click(screen.getByRole('button', {name: 'حفظ سياسة المواقع'}));

    await waitFor(() => {
      expect(mockUpdateTenantMapsSettings).toHaveBeenCalledWith('ten-alpha', {
        location_retention_days: 45,
        gps_ping_interval_seconds: 30,
        require_gps_on_delivery: true,
      });
    });

    fireEvent.click(screen.getByRole('button', {name: 'تنظيف السجلات المنتهية'}));
    await waitFor(() => {
      expect(mockPurgeExpiredCourierLocations).toHaveBeenCalledWith('ten-alpha');
      expect(screen.getByText(/14 سجل محذوف/)).toBeInTheDocument();
    });
  });
});
