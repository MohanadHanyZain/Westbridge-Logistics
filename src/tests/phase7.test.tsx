import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';
import {
  WAREHOUSE_PRINT_LAYOUT_LABELS,
  type PickupListDetail,
  type PickupListRecord,
  type WarehouseManifestDetail,
  type WarehouseManifestRecord,
} from '@/types/operations';
import type {ShipmentListItem} from '@/types/shipments';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListMovementTypes = vi.fn();
const mockListCouriers = vi.fn();
const mockListCourierRoutes = vi.fn();
const mockListClients = vi.fn();
const mockRepriceShipment = vi.fn();

const mockListPickupLists = vi.fn();
const mockGetPickupListDetail = vi.fn();
const mockCreatePickupList = vi.fn();
const mockAddShipmentsToPickupList = vi.fn();
const mockRemoveShipmentFromPickupList = vi.fn();
const mockApprovePickupList = vi.fn();

const mockListWarehouseManifests = vi.fn();
const mockGetWarehouseManifestDetail = vi.fn();
const mockCreateWarehouseManifest = vi.fn();
const mockAddShipmentsToWarehouseManifest = vi.fn();
const mockRemoveShipmentFromWarehouseManifest = vi.fn();
const mockApproveWarehouseManifest = vi.fn();
const mockListBranchInboundTransferShipments = vi.fn();
const mockListEligibleShipmentsForOperation = vi.fn();
const mockAdminReleaseStuckTransfer = vi.fn();

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
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listMovementTypes: (...args: unknown[]) => mockListMovementTypes(...args),
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
    listCourierRoutes: (...args: unknown[]) => mockListCourierRoutes(...args),
  };
});

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
  };
});

vi.mock('@/features/shipments/shipmentsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/shipments/shipmentsService')>();
  return {
    ...actual,
    repriceShipment: (...args: unknown[]) => mockRepriceShipment(...args),
  };
});

vi.mock('@/features/operations/operationsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/operations/operationsService')>();
  return {
    ...actual,
    listPickupLists: (...args: unknown[]) => mockListPickupLists(...args),
    getPickupListDetail: (...args: unknown[]) => mockGetPickupListDetail(...args),
    createPickupList: (...args: unknown[]) => mockCreatePickupList(...args),
    addShipmentsToPickupList: (...args: unknown[]) => mockAddShipmentsToPickupList(...args),
    removeShipmentFromPickupList: (...args: unknown[]) => mockRemoveShipmentFromPickupList(...args),
    approvePickupList: (...args: unknown[]) => mockApprovePickupList(...args),
    listWarehouseManifests: (...args: unknown[]) => mockListWarehouseManifests(...args),
    getWarehouseManifestDetail: (...args: unknown[]) => mockGetWarehouseManifestDetail(...args),
    createWarehouseManifest: (...args: unknown[]) => mockCreateWarehouseManifest(...args),
    addShipmentsToWarehouseManifest: (...args: unknown[]) => mockAddShipmentsToWarehouseManifest(...args),
    removeShipmentFromWarehouseManifest: (...args: unknown[]) =>
      mockRemoveShipmentFromWarehouseManifest(...args),
    approveWarehouseManifest: (...args: unknown[]) => mockApproveWarehouseManifest(...args),
    listBranchInboundTransferShipments: (...args: unknown[]) =>
      mockListBranchInboundTransferShipments(...args),
    listEligibleShipmentsForOperation: (...args: unknown[]) =>
      mockListEligibleShipmentsForOperation(...args),
    adminReleaseStuckTransfer: (...args: unknown[]) => mockAdminReleaseStuckTransfer(...args),
  };
});

const tenantAlpha: TenantRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'ALPHA',
  slug: 'alpha-express',
  name: 'شركة ألفا للشحن',
  status: 'active',
  default_timezone: 'Africa/Cairo',
  default_currency: 'EGP',
  default_locale: 'ar-EG',
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
};

const membershipOwner: TenantMembershipRecord = {
  id: 'aaaa1111-1111-1111-1111-111111111111',
  tenant_id: tenantAlpha.id,
  user_id: 'user-alpha-1',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const membershipBranchManager: TenantMembershipRecord = {
  ...membershipOwner,
  id: 'bbbb2222-2222-2222-2222-222222222222',
  user_id: 'user-bm-1',
  username: 'bm_cairo',
  role_key: 'branch_manager',
};

const sampleShipment: ShipmentListItem = {
  id: 'shp-101',
  tenant_id: tenantAlpha.id,
  shipment_number: 'SHP-0000101',
  barcode_token: 'SFB-10101010',
  client_id: 'cl-1',
  origin_branch_id: 'br-1',
  current_branch_id: 'br-1',
  destination_branch_id: 'br-2',
  assigned_courier_id: null,
  movement_type_id: 'mov-1',
  shipment_type_id: 'st-fdp',
  shipment_type_code: 'FDP',
  service_id: 'srv-1',
  payment_term_id: 'pt-cod',
  payment_term_code: 'COD',
  price_mode: 'shipping_excluded',
  operational_status: 'created',
  is_created_confirmed: true,
  is_collected_from_courier: false,
  is_settled_to_client: false,
  is_courier_commission_paid: false,
  entered_amount: 450,
  prepaid_balance_amount: 450,
  total_shipping_fee: 65,
  return_fee: 35,
  recipient_collect_amount: 515,
  client_net_payout: 450,
  delivered_amount: null,
  pieces_count: 2,
  delivered_pieces_count: 0,
  returned_pieces_count: 0,
  partial_return_custody: 'none',
  exchange_status: 'none',
  actual_weight_kg: 1.5,
  chargeable_weight_kg: 1.5,
  allow_package_opening: true,
  package_description: 'أجهزة منزلية صغيرة',
  external_reference: null,
  notes: null,
  pickup_date: '2026-11-19',
  pickup_time_from: null,
  pickup_time_to: null,
  current_snapshot_id: 'snap-1',
  sender_governorate_id: 'gov-1',
  sender_region_id: 'reg-1',
  recipient_governorate_id: 'gov-2',
  recipient_region_id: 'reg-2',
  delivery_attempts_count: 0,
  last_exception_reason_id: null,
  delivered_at: null,
  returned_at: null,
  cancelled_at: null,
  created_at: '2026-11-19T08:00:00Z',
  updated_at: '2026-11-19T08:00:00Z',
  sender_name: 'متجر النيل',
  sender_mobile: '01010002000',
  recipient_name: 'أحمد صلاح',
  recipient_mobile: '01299887766',
  recipient_address: 'سموحة - الإسكندرية',
  tracking_token: 'TRK-P7-001',
};

const sampleShipment2: ShipmentListItem = {
  ...sampleShipment,
  id: 'shp-102',
  shipment_number: 'SHP-0000102',
  barcode_token: 'SFB-20202020',
  recipient_name: 'سارة علي',
};

const samplePickupHeader: PickupListRecord = {
  id: 'pkp-1',
  tenant_id: tenantAlpha.id,
  list_code: 'PKP-000001',
  list_date: '2026-11-19',
  branch_id: 'br-1',
  courier_id: 'cr-1',
  route_id: 'rt-1',
  movement_type_id: 'mov-1',
  client_id: null,
  status: 'draft',
  notes: 'التقاط مسائي',
  approved_by: null,
  approved_at: null,
  created_at: '2026-11-19T09:00:00Z',
  updated_at: '2026-11-19T09:00:00Z',
  shipments_count: 0,
};

const sampleWrhHeader: WarehouseManifestRecord = {
  id: 'wrh-1',
  tenant_id: tenantAlpha.id,
  manifest_code: 'WRH-000001',
  manifest_type: 'intake',
  manifest_date: '2026-11-19',
  branch_id: 'br-2',
  target_branch_id: null,
  source_transfer_manifest_id: null,
  courier_id: null,
  movement_type_id: 'mov-2',
  status: 'draft',
  notes: 'استلام وردية الصباح',
  approved_by: null,
  approved_at: null,
  released_at: null,
  released_by: null,
  release_reason: null,
  created_at: '2026-11-19T09:30:00Z',
  updated_at: '2026-11-19T09:30:00Z',
  shipments_count: 0,
};

const sampleTrfHeader: WarehouseManifestRecord = {
  id: 'trf-1',
  tenant_id: tenantAlpha.id,
  manifest_code: 'TRF-000001',
  manifest_type: 'transfer_out',
  manifest_date: '2026-11-19',
  branch_id: 'br-1',
  target_branch_id: 'br-2',
  source_transfer_manifest_id: null,
  courier_id: null,
  movement_type_id: 'mov-3',
  status: 'in_transit',
  notes: 'رحلة الإسكندرية الصباحية',
  approved_by: 'user-alpha-1',
  approved_at: '2026-11-19T10:00:00Z',
  released_at: null,
  released_by: null,
  release_reason: null,
  created_at: '2026-11-19T09:45:00Z',
  updated_at: '2026-11-19T10:00:00Z',
  shipments_count: 1,
};

describe('Phase 7: Operations (Pickup Lists, Warehouse Intake & 2-Step Branch Transfers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-alpha-1'}},
      user: {id: 'user-alpha-1'},
      profile: {
        id: 'user-alpha-1',
        display_name: 'مالك ألفا',
        avatar_path: null,
        is_platform_user: false,
        is_active: true,
      },
      platformAdmin: null,
      memberships: [membershipOwner],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    mockGetMyTenantPermissions.mockResolvedValue({
      membership_id: membershipOwner.id,
      role_key: 'company_owner',
      account_subject_type: AccountSubjectType.STAFF,
      client_id: null,
      courier_id: null,
      branch_ids: [],
      permissions: [{permission_key: 'operations.pickup.approve', scope: PermissionScope.TENANT}],
    });

    mockListBranches.mockResolvedValue([
      {
        id: 'br-1',
        tenant_id: tenantAlpha.id,
        code: 'CAI',
        name: 'فرع القاهرة الرئيسي',
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        address_line: 'مدينة نصر',
        phone: '0223456789',
        manager_name: null,
        is_main: true,
        is_active: true,
      },
      {
        id: 'br-2',
        tenant_id: tenantAlpha.id,
        code: 'ALX',
        name: 'فرع الإسكندرية',
        governorate_id: 'gov-2',
        region_id: 'reg-2',
        address_line: 'سموحة',
        phone: '034567890',
        manager_name: null,
        is_main: false,
        is_active: true,
      },
    ]);

    mockListGovernorates.mockResolvedValue([
      {id: 'gov-1', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-01', name: 'القاهرة', default_branch_id: 'br-1', is_active: true},
      {id: 'gov-2', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-02', name: 'الإسكندرية', default_branch_id: 'br-2', is_active: true},
    ]);

    mockListRegions.mockResolvedValue([
      {id: 'reg-1', tenant_id: tenantAlpha.id, governorate_id: 'gov-1', city_id: null, code: 'EG-01-R01', name: 'مدينة نصر', default_branch_id: 'br-1', is_active: true},
      {id: 'reg-2', tenant_id: tenantAlpha.id, governorate_id: 'gov-2', city_id: null, code: 'EG-02-R01', name: 'سموحة', default_branch_id: 'br-2', is_active: true},
    ]);

    mockListMovementTypes.mockResolvedValue([
      {id: 'mov-1', tenant_id: tenantAlpha.id, code: 'MOV-001', name: 'التقاط من مقر العميل', is_active: true},
      {id: 'mov-2', tenant_id: tenantAlpha.id, code: 'MOV-002', name: 'استلام بمخزن الفرع', is_active: true},
      {id: 'mov-3', tenant_id: tenantAlpha.id, code: 'MOV-003', name: 'نقل صادر لفرع آخر', is_active: true},
    ]);

    mockListCouriers.mockResolvedValue([
      {
        id: 'cr-1',
        tenant_id: tenantAlpha.id,
        code: 'CR-001',
        name: 'كابتن طارق',
        branch_id: 'br-1',
        ledger_account_id: null,
        custody_account_id: null,
        default_route_id: 'rt-1',
        commission_list_id: null,
        default_commission_type: 'fixed_amount',
        default_commission_value: 25,
        country_id: 'cnt-eg',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        phone: null,
        mobile: '01011223344',
        po_box: null,
        postal_code: null,
        address_line: null,
        email: null,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListCourierRoutes.mockResolvedValue([
      {
        id: 'rt-1',
        tenant_id: tenantAlpha.id,
        code: 'GENERAL',
        name: 'خط السير العام',
        branch_id: null,
        is_system: true,
        is_active: true,
      },
    ]);

    mockListClients.mockResolvedValue([
      {
        id: 'cl-1',
        tenant_id: tenantAlpha.id,
        code: 'C-0001',
        name: 'متجر النيل',
        branch_id: 'br-1',
        price_list_id: 'pl-0',
        tax_profile: 'none',
        default_payment_term_id: 'pt-cod',
        default_shipment_type_id: 'st-fdp',
        default_price_mode: 'shipping_excluded',
        allow_package_opening: true,
        country_id: 'cnt-eg',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        phone: null,
        mobile: '01010002000',
        address_line: 'مدينة نصر',
        email: null,
        ledger_account_id: null,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListPickupLists.mockResolvedValue([]);
    mockListWarehouseManifests.mockResolvedValue([]);
    mockListBranchInboundTransferShipments.mockResolvedValue([]);
    mockListEligibleShipmentsForOperation.mockResolvedValue([]);
  });

  it('renders العمليات اليومية sidebar group with 3 operation links', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/pickup']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'قوائم الالتقاط'})).toBeInTheDocument();
    });

    expect(screen.getByRole('button', {name: /العمليات اليومية/})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قوائم الالتقاط'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قوائم الاستلام بالمخزن'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'النقل بين الفروع'})).toBeInTheDocument();
  });

  it('runs PickupListsPage header-first flow, barcode + multi-select attachment, and approval', async () => {
    const detailEmpty: PickupListDetail = {list: samplePickupHeader, items: []};
    const detailAfterBarcode: PickupListDetail = {
      list: samplePickupHeader,
      items: [
        {
          id: 'pi-1',
          tenant_id: tenantAlpha.id,
          pickup_list_id: 'pkp-1',
          shipment_id: sampleShipment.id,
          added_via: 'barcode',
          pickup_completed_at: null,
          notes: null,
          created_at: '2026-11-19T09:05:00Z',
          shipment: sampleShipment,
        },
      ],
    };
    const detailAfterMulti: PickupListDetail = {
      list: samplePickupHeader,
      items: [
        ...detailAfterBarcode.items,
        {
          id: 'pi-2',
          tenant_id: tenantAlpha.id,
          pickup_list_id: 'pkp-1',
          shipment_id: sampleShipment2.id,
          added_via: 'manual',
          pickup_completed_at: null,
          notes: null,
          created_at: '2026-11-19T09:06:00Z',
          shipment: sampleShipment2,
        },
      ],
    };
    const detailApproved: PickupListDetail = {
      list: {...samplePickupHeader, status: 'approved'},
      items: detailAfterMulti.items,
    };

    mockCreatePickupList.mockResolvedValue(samplePickupHeader);
    mockGetPickupListDetail
      .mockResolvedValueOnce(detailEmpty)
      .mockResolvedValueOnce(detailAfterBarcode)
      .mockResolvedValueOnce(detailAfterMulti)
      .mockResolvedValueOnce(detailApproved);
    mockAddShipmentsToPickupList
      .mockResolvedValueOnce({added_count: 1, skipped_count: 0})
      .mockResolvedValueOnce({added_count: 1, skipped_count: 0});
    mockListEligibleShipmentsForOperation.mockResolvedValue([sampleShipment, sampleShipment2]);
    mockApprovePickupList.mockResolvedValue({
      pickup_list_id: 'pkp-1',
      list_code: 'PKP-000001',
      shipments_count: 2,
      status: 'approved',
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/pickup']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'قائمة التقاط جديدة'})).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'قائمة التقاط جديدة'}));

    await waitFor(() => {
      expect(screen.getByLabelText('مندوب الشحن')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('مندوب الشحن'), {target: {value: 'cr-1'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ رأس القائمة'}));

    await waitFor(() => {
      expect(mockCreatePickupList).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('heading', {name: /PKP-000001/})).toBeInTheDocument();
    });

    // Attach via Barcode scanner modal
    fireEvent.click(screen.getByRole('button', {name: /إضافة بالباركود/}));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/امسح الباركود/), {
      target: {value: 'SFB-10101010'},
    });
    fireEvent.click(within(dialog).getByRole('button', {name: 'حفظ وإضافة الشحنة'}));

    await waitFor(() => {
      expect(mockAddShipmentsToPickupList).toHaveBeenCalledWith(
        tenantAlpha.id,
        'pkp-1',
        {barcodeQuery: 'SFB-10101010'},
      );
      expect(screen.getByText('SHP-0000101')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'إغلاق'}));

    // Attach via Multi-select checkbox modal (SHP-0000101 is already attached and filtered out)
    fireEvent.click(screen.getByRole('button', {name: 'اختيار شحنات'}));
    await waitFor(() => {
      expect(screen.getByLabelText('اختيار SHP-0000102')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('اختيار SHP-0000102'));
    fireEvent.click(screen.getByRole('button', {name: /إضافة المحدد \(1\)/}));

    await waitFor(() => {
      expect(mockAddShipmentsToPickupList).toHaveBeenCalledWith(
        tenantAlpha.id,
        'pkp-1',
        {shipmentIds: ['shp-102']},
      );
      expect(screen.getByText('SHP-0000102')).toBeInTheDocument();
    });

    // Approve pickup list
    fireEvent.click(screen.getByRole('button', {name: /اعتماد القائمة \(2\)/}));
    await waitFor(() => {
      expect(mockApprovePickupList).toHaveBeenCalledWith(tenantAlpha.id, 'pkp-1');
    });
  });

  it('runs WarehouseIntakePage inbound transfer import banner, 5 print layouts, ADR-010 weight edit, and approval', async () => {
    const emptyDetail: WarehouseManifestDetail = {manifest: sampleWrhHeader, items: []};
    const inboundRow = {
      transfer_manifest_id: 'trf-1',
      transfer_manifest_code: 'TRF-000001',
      origin_branch_id: 'br-1',
      target_branch_id: 'br-2',
      shipment_id: sampleShipment.id,
      shipment_number: sampleShipment.shipment_number,
      barcode_token: sampleShipment.barcode_token,
      recipient_name: sampleShipment.recipient_name ?? 'أحمد صلاح',
      recipient_mobile: sampleShipment.recipient_mobile ?? '01299887766',
      pieces_count: 2,
      chargeable_weight_kg: 1.5,
      recipient_collect_amount: 515,
    };
    const withItemDetail: WarehouseManifestDetail = {
      manifest: sampleWrhHeader,
      items: [
        {
          id: 'wmi-1',
          tenant_id: tenantAlpha.id,
          manifest_id: 'wrh-1',
          shipment_id: sampleShipment.id,
          added_via: 'manual',
          receive_status: 'pending',
          verified_weight_kg: null,
          received_at: null,
          notes: null,
          created_at: '2026-11-19T09:35:00Z',
          shipment: {...sampleShipment, operational_status: 'in_transit_branch'},
        },
      ],
    };
    const approvedDetail: WarehouseManifestDetail = {
      manifest: {...sampleWrhHeader, status: 'approved'},
      items: withItemDetail.items.map((it) => ({...it, receive_status: 'received'})),
    };

    mockCreateWarehouseManifest.mockResolvedValue(sampleWrhHeader);
    mockGetWarehouseManifestDetail
      .mockResolvedValueOnce(emptyDetail)
      .mockResolvedValueOnce(withItemDetail)
      .mockResolvedValueOnce(withItemDetail)
      .mockResolvedValueOnce(approvedDetail);
    mockListBranchInboundTransferShipments.mockResolvedValue([inboundRow]);
    mockAddShipmentsToWarehouseManifest.mockResolvedValue({added_count: 1, skipped_count: 0});
    mockRepriceShipment.mockResolvedValue({
      snapshot_id: 'snap-2',
      version_number: 2,
      chargeable_weight_kg: 3,
      total_shipping_fee: 95,
    });
    mockApproveWarehouseManifest.mockResolvedValue({
      manifest_id: 'wrh-1',
      manifest_code: 'WRH-000001',
      manifest_type: 'intake',
      status: 'approved',
      shipments_count: 1,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/warehouse']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'قائمة استلام بالمخزن'})).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'قائمة استلام بالمخزن'}));

    await waitFor(() => {
      expect(screen.getByLabelText('فرع المخزن المستلم')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('فرع المخزن المستلم'), {target: {value: 'br-2'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ رأس قائمة الاستلام'}));

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: /WRH-000001/})).toBeInTheDocument();
      expect(screen.getByText(/توجد 1 شحنة واردة قيد النقل موجهة إلى/)).toBeInTheDocument();
    });

    // Verify all 5 warehouse print models exist in the layout selector
    const layoutSelect = screen.getByLabelText('نموذج الطباعة');
    for (const label of Object.values(WAREHOUSE_PRINT_LAYOUT_LABELS)) {
      expect(within(layoutSelect).getByRole('option', {name: label})).toBeInTheDocument();
    }

    // One-click import incoming transfer batch
    fireEvent.click(screen.getByRole('button', {name: /استيراد الشحنات الواردة \(1\)/}));

    await waitFor(() => {
      expect(mockAddShipmentsToWarehouseManifest).toHaveBeenCalledWith(
        tenantAlpha.id,
        'wrh-1',
        {shipmentIds: ['shp-101']},
      );
      expect(screen.getByText('SHP-0000101')).toBeInTheDocument();
    });

    // Quick ADR-010 weight revision from intake table
    fireEvent.click(screen.getByRole('button', {name: 'تعديل الوزن'}));
    const repriceDialog = screen.getByRole('dialog', {name: 'تعديل الوزن الفعلي بالمخزن'});
    const inputs = within(repriceDialog).getAllByRole('spinbutton');
    fireEvent.change(inputs[0], {target: {value: '3'}});
    fireEvent.change(
      within(repriceDialog).getByPlaceholderText(/وزن ميزان الاستلام بالمخزن/),
      {target: {value: 'وزن فعلي عند بوابة المخزن'}},
    );
    fireEvent.click(within(repriceDialog).getByRole('button', {name: 'اعتماد إصدار السعر'}));

    await waitFor(() => {
      expect(mockRepriceShipment).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantAlpha.id,
          shipmentId: 'shp-101',
          actualWeightKg: 3,
          reason: 'وزن فعلي عند بوابة المخزن',
        }),
      );
    });

    // Approve intake manifest -> completes ADR-015 handshake
    fireEvent.click(screen.getByRole('button', {name: /اعتماد الاستلام بالمخزن \(1\)/}));
    await waitFor(() => {
      expect(mockApproveWarehouseManifest).toHaveBeenCalledWith(tenantAlpha.id, 'wrh-1');
    });
  });

  it('enforces ADR-015 admin-only hang release modal on BranchTransfersPage and hides it from branch_manager', async () => {
    const trfDetail: WarehouseManifestDetail = {
      manifest: sampleTrfHeader,
      items: [
        {
          id: 'trfi-1',
          tenant_id: tenantAlpha.id,
          manifest_id: 'trf-1',
          shipment_id: sampleShipment.id,
          added_via: 'barcode',
          receive_status: 'pending',
          verified_weight_kg: null,
          received_at: null,
          notes: null,
          created_at: '2026-11-19T09:50:00Z',
          shipment: {
            ...sampleShipment,
            operational_status: 'in_transit_branch',
            current_branch_id: 'br-1',
          },
        },
      ],
    };

    mockListWarehouseManifests.mockResolvedValue([sampleTrfHeader]);
    mockGetWarehouseManifestDetail.mockResolvedValue(trfDetail);
    mockListBranchInboundTransferShipments.mockResolvedValue([
      {
        transfer_manifest_id: 'trf-1',
        transfer_manifest_code: 'TRF-000001',
        origin_branch_id: 'br-1',
        target_branch_id: 'br-2',
        shipment_id: sampleShipment.id,
        shipment_number: sampleShipment.shipment_number,
        barcode_token: sampleShipment.barcode_token,
        recipient_name: 'أحمد صلاح',
        recipient_mobile: '01299887766',
        pieces_count: 2,
        chargeable_weight_kg: 1.5,
        recipient_collect_amount: 515,
      },
    ]);
    mockAdminReleaseStuckTransfer.mockResolvedValue({
      shipment_id: sampleShipment.id,
      action: 'return_to_origin',
      current_branch_id: 'br-1',
      operational_status: 'in_warehouse',
    });

    // 1) Owner sees TRF-000001, inbound handshake tab, and "فك تعليق إداري" action
    const {unmount} = render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/transfers']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('TRF-000001')).toBeInTheDocument();
    });

    // Switch to inbound tab
    fireEvent.click(screen.getByRole('button', {name: /الشحنات الواردة للفرع/}));
    await waitFor(() => {
      expect(screen.getByText('SHP-0000101')).toBeInTheDocument();
    });

    // Return to transfers list and open TRF-000001 workbench
    fireEvent.click(screen.getByRole('button', {name: /قوائم النقل الصادرة/}));
    fireEvent.click(screen.getByRole('button', {name: 'متابعة / تفاصيل'}));

    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'فك تعليق إداري'})).toBeInTheDocument();
    });

    // Open admin unhang modal & enforce mandatory reason
    fireEvent.click(screen.getByRole('button', {name: 'فك تعليق إداري'}));
    const modal = screen.getByRole('dialog', {name: /فك تعليق شحنة قيد النقل بين الفروع/});
    const confirmBtn = within(modal).getByRole('button', {name: /تأكيد فك التعليق وتسجيل التدقيق/});
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(modal).getByLabelText(/سبب فك التعليق الإداري/), {
      target: {value: 'تعطل سيارة النقل وتقرر إعادة الشحنة لمخزن القاهرة'},
    });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAdminReleaseStuckTransfer).toHaveBeenCalledWith(tenantAlpha.id, {
        manifestId: 'trf-1',
        shipmentId: sampleShipment.id,
        action: 'return_to_origin',
        reason: 'تعطل سيارة النقل وتقرر إعادة الشحنة لمخزن القاهرة',
      });
    });

    unmount();

    // 2) Branch Manager CANNOT see "فك تعليق إداري" (ADR-015 admin/ops manager restriction)
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-bm-1'}},
      user: {id: 'user-bm-1'},
      profile: {
        id: 'user-bm-1',
        display_name: 'مدير فرع القاهرة',
        avatar_path: null,
        is_platform_user: false,
        is_active: true,
      },
      platformAdmin: null,
      memberships: [membershipBranchManager],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });
    mockGetMyTenantPermissions.mockResolvedValue({
      membership_id: membershipBranchManager.id,
      role_key: 'branch_manager',
      account_subject_type: AccountSubjectType.STAFF,
      client_id: null,
      courier_id: null,
      branch_ids: ['br-1'],
      permissions: [{permission_key: 'operations.pickup.approve', scope: PermissionScope.BRANCH}],
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/transfers']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('TRF-000001')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', {name: 'متابعة / تفاصيل'}));

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: /TRF-000001/})).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', {name: 'فك تعليق إداري'})).not.toBeInTheDocument();
  });
});
