import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {
  CourierPortalTasksFeed,
  DeliveryListDetail,
  DeliveryListRecord,
  ReturnManifestDetail,
  ReturnManifestRecord,
  TenantDeliveryPolicyRecord,
} from '@/types/delivery';
import type {ShipmentListItem} from '@/types/shipments';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListCouriers = vi.fn();
const mockListCourierRoutes = vi.fn();
const mockListMovementTypes = vi.fn();
const mockListOperationalRefs = vi.fn();
const mockListExceptionReasons = vi.fn();
const mockListClients = vi.fn();
const mockListShippingServices = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListShipments = vi.fn();

const mockGetTenantDeliveryPolicy = vi.fn();
const mockUpdateTenantDeliveryPolicy = vi.fn();
const mockListDeliveryLists = vi.fn();
const mockGetDeliveryListDetail = vi.fn();
const mockCreateDeliveryList = vi.fn();
const mockAddShipmentsToDeliveryList = vi.fn();
const mockRemoveShipmentFromDeliveryList = vi.fn();
const mockApproveDeliveryList = vi.fn();
const mockListEligibleShipmentsForDelivery = vi.fn();
const mockRecordDeliveryExecution = vi.fn();

const mockListReturnManifests = vi.fn();
const mockGetReturnManifestDetail = vi.fn();
const mockCreateReturnManifest = vi.fn();
const mockAddShipmentsToReturnManifest = vi.fn();
const mockRemoveShipmentFromReturnManifest = vi.fn();
const mockApproveReturnManifest = vi.fn();
const mockListEligibleShipmentsForReturns = vi.fn();

const mockListCourierMyTasks = vi.fn();

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
    listMovementTypes: (...args: unknown[]) => mockListMovementTypes(...args),
    listOperationalRefs: (...args: unknown[]) => mockListOperationalRefs(...args),
    listExceptionReasons: (...args: unknown[]) => mockListExceptionReasons(...args),
    listShippingServices: (...args: unknown[]) => mockListShippingServices(...args),
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
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
    listShipments: (...args: unknown[]) => mockListShipments(...args),
  };
});

vi.mock('@/features/delivery/deliveryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/delivery/deliveryService')>();
  return {
    ...actual,
    getTenantDeliveryPolicy: (...args: unknown[]) => mockGetTenantDeliveryPolicy(...args),
    updateTenantDeliveryPolicy: (...args: unknown[]) => mockUpdateTenantDeliveryPolicy(...args),
    listDeliveryLists: (...args: unknown[]) => mockListDeliveryLists(...args),
    getDeliveryListDetail: (...args: unknown[]) => mockGetDeliveryListDetail(...args),
    createDeliveryList: (...args: unknown[]) => mockCreateDeliveryList(...args),
    addShipmentsToDeliveryList: (...args: unknown[]) => mockAddShipmentsToDeliveryList(...args),
    removeShipmentFromDeliveryList: (...args: unknown[]) => mockRemoveShipmentFromDeliveryList(...args),
    approveDeliveryList: (...args: unknown[]) => mockApproveDeliveryList(...args),
    listEligibleShipmentsForDelivery: (...args: unknown[]) => mockListEligibleShipmentsForDelivery(...args),
    recordDeliveryExecution: (...args: unknown[]) => mockRecordDeliveryExecution(...args),
    listReturnManifests: (...args: unknown[]) => mockListReturnManifests(...args),
    getReturnManifestDetail: (...args: unknown[]) => mockGetReturnManifestDetail(...args),
    createReturnManifest: (...args: unknown[]) => mockCreateReturnManifest(...args),
    addShipmentsToReturnManifest: (...args: unknown[]) => mockAddShipmentsToReturnManifest(...args),
    removeShipmentFromReturnManifest: (...args: unknown[]) => mockRemoveShipmentFromReturnManifest(...args),
    approveReturnManifest: (...args: unknown[]) => mockApproveReturnManifest(...args),
    listEligibleShipmentsForReturns: (...args: unknown[]) => mockListEligibleShipmentsForReturns(...args),
    listCourierMyTasks: (...args: unknown[]) => mockListCourierMyTasks(...args),
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

const membershipCourier: TenantMembershipRecord = {
  ...membershipOwner,
  id: 'cccc3333-3333-3333-3333-333333333333',
  user_id: 'user-courier-1',
  username: 'mandob_one',
  account_subject_type: AccountSubjectType.COURIER,
  role_key: 'delivery_agent',
};

const sampleOutShipment: ShipmentListItem = {
  id: 'shp-801',
  tenant_id: tenantAlpha.id,
  shipment_number: 'SHP-0000801',
  barcode_token: 'SFB-80180180',
  client_id: 'cl-1',
  origin_branch_id: 'br-1',
  current_branch_id: 'br-1',
  destination_branch_id: null,
  assigned_courier_id: 'crr-1',
  movement_type_id: 'mov-5',
  shipment_type_id: 'st-fdp',
  shipment_type_code: 'FDP',
  service_id: 'srv-1',
  payment_term_id: 'pt-cod',
  payment_term_code: 'COD',
  price_mode: 'shipping_excluded',
  operational_status: 'out_for_delivery',
  is_created_confirmed: true,
  is_collected_from_courier: false,
  is_settled_to_client: false,
  is_courier_commission_paid: false,
  entered_amount: 400,
  prepaid_balance_amount: 400,
  total_shipping_fee: 60,
  return_fee: 30,
  recipient_collect_amount: 460,
  client_net_payout: 400,
  delivered_amount: null,
  pieces_count: 2,
  delivered_pieces_count: 0,
  returned_pieces_count: 0,
  partial_return_custody: 'none',
  exchange_status: 'none',
  actual_weight_kg: 1.5,
  chargeable_weight_kg: 1.5,
  allow_package_opening: false,
  package_description: 'طرد ملابس',
  external_reference: null,
  notes: null,
  pickup_date: '2026-11-19',
  pickup_time_from: null,
  pickup_time_to: null,
  current_snapshot_id: 'snap-1',
  sender_governorate_id: 'gov-1',
  sender_region_id: 'reg-1',
  recipient_governorate_id: 'gov-1',
  recipient_region_id: 'reg-1',
  delivery_attempts_count: 1,
  last_exception_reason_id: null,
  delivered_at: null,
  returned_at: null,
  cancelled_at: null,
  return_liability: 'none',
  applied_return_fee: 0,
  return_collected_from_recipient: 0,
  accrued_courier_commission: 0,
  created_at: '2026-11-19T08:00:00Z',
  updated_at: '2026-11-19T08:00:00Z',
  client_name: 'متجر النيل',
  sender_name: 'راسل النيل',
  recipient_name: 'أحمد المستلم',
  recipient_mobile: '01299998888',
  recipient_address: 'المعادي - شارع 9',
};

const sampleReturnShipment: ShipmentListItem = {
  ...sampleOutShipment,
  id: 'shp-802',
  shipment_number: 'SHP-0000802',
  barcode_token: 'SFB-80280280',
  shipment_type_code: 'PTP',
  operational_status: 'delivered',
  partial_return_custody: 'none',
  exchange_status: 'with_courier',
  delivered_amount: 250,
  accrued_courier_commission: 25,
};

const defaultPolicy: TenantDeliveryPolicyRecord = {
  tenant_id: tenantAlpha.id,
  max_delivery_attempts: 3,
  retry_extra_fee: 10,
  require_pod_on_delivery: false,
};

const sampleDeliveryList: DeliveryListRecord = {
  id: 'dlv-1',
  tenant_id: tenantAlpha.id,
  list_code: 'DLV-000001',
  list_type: 'delivery',
  list_date: '2026-11-19',
  branch_id: 'br-1',
  courier_id: 'crr-1',
  route_id: 'rt-1',
  movement_type_id: 'mov-5',
  status: 'draft',
  notes: null,
  approved_at: null,
  closed_at: null,
  created_at: '2026-11-19T09:00:00Z',
  updated_at: '2026-11-19T09:00:00Z',
  shipments_count: 1,
  pending_count: 1,
};

const sampleDeliveryDetail: DeliveryListDetail = {
  list: sampleDeliveryList,
  items: [
    {
      id: 'dlvi-1',
      tenant_id: tenantAlpha.id,
      delivery_list_id: 'dlv-1',
      shipment_id: sampleOutShipment.id,
      added_via: 'barcode',
      execution_outcome: 'pending',
      delivered_amount: null,
      delivered_pieces_count: null,
      exception_reason_id: null,
      return_type_code: null,
      applied_return_fee: 0,
      return_collected_amount: 0,
      attempt_overridden: false,
      outcome_notes: null,
      executed_at: null,
      created_at: '2026-11-19T09:05:00Z',
      shipment: sampleOutShipment,
    },
  ],
};

const sampleReturnManifest: ReturnManifestRecord = {
  id: 'rth-1',
  tenant_id: tenantAlpha.id,
  manifest_code: 'RTH-000001',
  manifest_type: 'courier_return_inbound',
  manifest_date: '2026-11-19',
  branch_id: 'br-1',
  courier_id: 'crr-1',
  client_id: null,
  movement_type_id: 'mov-7',
  status: 'draft',
  notes: null,
  approved_at: null,
  created_at: '2026-11-19T10:00:00Z',
  updated_at: '2026-11-19T10:00:00Z',
  shipments_count: 1,
};

const sampleReturnDetail: ReturnManifestDetail = {
  manifest: sampleReturnManifest,
  items: [
    {
      id: 'rmi-1',
      tenant_id: tenantAlpha.id,
      return_manifest_id: 'rth-1',
      shipment_id: sampleReturnShipment.id,
      added_via: 'manual',
      handover_status: 'pending',
      notes: null,
      completed_at: null,
      created_at: '2026-11-19T10:05:00Z',
      shipment: sampleReturnShipment,
    },
  ],
};

const samplePortalFeed: CourierPortalTasksFeed = {
  courier: {
    id: 'crr-1',
    code: 'CRR-001',
    name: 'كريم المنصور',
    branch_id: 'br-1',
    mobile: '01099990001',
  },
  pickup_lists: [
    {
      id: 'pkp-1',
      list_code: 'PKP-000001',
      list_date: '2026-11-19',
      branch_id: 'br-1',
      status: 'approved',
      notes: 'التقاط صباحي',
      shipments_count: 2,
    },
  ],
  delivery_lists: [
    {
      id: 'dlv-1',
      list_code: 'DLV-000001',
      list_type: 'delivery',
      list_date: '2026-11-19',
      branch_id: 'br-1',
      status: 'approved',
      notes: null,
      shipments_count: 1,
      pending_count: 1,
    },
  ],
  shipments: [sampleOutShipment, sampleReturnShipment],
};

describe('Phase 8: Delivery Lists, Redelivery, Returns, POD, Attempts Policy & Courier Portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-alpha-1', email: 'admin@internal.test'},
      profile: {id: 'user-alpha-1', display_name: 'أحمد الإداري', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipOwner],
      signOut: vi.fn(),
      refreshSessionData: vi.fn(),
    });

    mockGetMyTenantPermissions.mockResolvedValue({
      client_id: null,
      courier_id: null,
      branch_ids: ['br-1'],
      permissions: [
        {permission_key: 'operations.pickup.approve', scope: PermissionScope.TENANT},
        {permission_key: 'operations.delivery.execute', scope: PermissionScope.TENANT},
        {permission_key: 'shipments.read', scope: PermissionScope.TENANT},
      ],
    });

    mockListBranches.mockResolvedValue([
      {
        id: 'br-1',
        tenant_id: tenantAlpha.id,
        code: 'BR-001',
        name: 'فرع القاهرة الرئيسي',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        phone: null,
        address_line: null,
        is_main: true,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
        updated_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListCouriers.mockResolvedValue([
      {
        id: 'crr-1',
        tenant_id: tenantAlpha.id,
        code: 'CRR-001',
        name: 'كريم المنصور',
        branch_id: 'br-1',
        commission_list_id: 'clst-1',
        default_route_id: 'rt-1',
        vehicle_id: null,
        driver_id: null,
        ledger_account_id: null,
        custody_account_id: null,
        country_id: null,
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        phone: null,
        mobile: '01099990001',
        po_box: null,
        postal_code: null,
        address_line: null,
        email: null,
        default_commission_type: 'fixed_amount',
        default_commission_value: 25,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
        updated_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListCourierRoutes.mockResolvedValue([
      {
        id: 'rt-1',
        tenant_id: tenantAlpha.id,
        code: 'GENERAL',
        name: 'خط السير العام',
        branch_id: 'br-1',
        vehicle_id: null,
        driver_id: null,
        notes: null,
        is_protected: true,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListMovementTypes.mockResolvedValue([
      {id: 'mov-5', tenant_id: tenantAlpha.id, code: 'MOV-005', name: 'خروج للتوصيل مع المندوب', is_active: true},
      {id: 'mov-7', tenant_id: tenantAlpha.id, code: 'MOV-007', name: 'إعادة للمخزن بعد التعذر', is_active: true},
      {id: 'mov-8', tenant_id: tenantAlpha.id, code: 'MOV-008', name: 'تسليم المرتجع للراسل', is_active: true},
    ]);

    mockListOperationalRefs.mockResolvedValue({
      paymentMethods: [],
      paymentTerms: [],
      deliveryTypes: [],
      sequences: [],
    });

    mockListExceptionReasons.mockResolvedValue([
      {
        id: 'exc-1',
        tenant_id: tenantAlpha.id,
        code: 'EXC-01',
        name: 'العميل لا يرد / الهاتف مغلق',
        category: 'delivery_failure',
        requires_note: false,
        is_system: true,
        is_active: true,
      },
    ]);

    mockListClients.mockResolvedValue([
      {
        id: 'cl-1',
        tenant_id: tenantAlpha.id,
        code: 'CL-001',
        name: 'متجر النيل',
        trade_name: null,
        branch_id: 'br-1',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        price_list_id: 'pl-1',
        tax_profile_id: 'tp-1',
        credit_limit: 0,
        settlement_term_days: 7,
        phone: null,
        mobile: '01011112222',
        email: null,
        address_line: 'القاهرة',
        status: 'active',
        registration_source: 'admin_created',
        notes: null,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
        updated_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListShippingServices.mockResolvedValue([]);
    mockListGovernorates.mockResolvedValue([{id: 'gov-1', code: 'EG-01', name: 'القاهرة'}]);
    mockListRegions.mockResolvedValue([{id: 'reg-1', governorate_id: 'gov-1', code: 'EG-01-R01', name: 'مدينة نصر'}]);
    mockListShipments.mockResolvedValue([sampleOutShipment]);

    mockGetTenantDeliveryPolicy.mockResolvedValue(defaultPolicy);
    mockUpdateTenantDeliveryPolicy.mockResolvedValue({
      tenant_id: tenantAlpha.id,
      max_delivery_attempts: 2,
      retry_extra_fee: 15,
      require_pod_on_delivery: true,
    });

    mockListDeliveryLists.mockResolvedValue([sampleDeliveryList]);
    mockGetDeliveryListDetail.mockResolvedValue(sampleDeliveryDetail);
    mockCreateDeliveryList.mockResolvedValue({
      id: 'dlv-2',
      list_code: 'DLV-000002',
      list_type: 'delivery',
      status: 'draft',
    });
    mockAddShipmentsToDeliveryList.mockResolvedValue({added_count: 1, skipped_count: 0});
    mockApproveDeliveryList.mockResolvedValue({
      id: 'dlv-1',
      list_code: 'DLV-000001',
      status: 'approved',
      shipments_count: 1,
    });
    mockListEligibleShipmentsForDelivery.mockResolvedValue([sampleOutShipment]);
    mockRecordDeliveryExecution.mockResolvedValue({
      shipment_id: sampleOutShipment.id,
      from_status: 'out_for_delivery',
      to_status: 'return_to_sender',
      delivery_attempts_count: 2,
      max_delivery_attempts: 3,
      auto_returned_by_limit: false,
      accrued_courier_commission: 0,
      return_liability: 'recipient_paid_fee',
      applied_return_fee: 0,
      return_collected_from_recipient: 45,
    });

    mockListReturnManifests.mockResolvedValue([sampleReturnManifest]);
    mockGetReturnManifestDetail.mockResolvedValue(sampleReturnDetail);
    mockCreateReturnManifest.mockResolvedValue({
      id: 'rth-2',
      manifest_code: 'RTH-000002',
      manifest_type: 'courier_return_inbound',
      status: 'draft',
    });
    mockAddShipmentsToReturnManifest.mockResolvedValue({added_count: 1, skipped_count: 0});
    mockApproveReturnManifest.mockResolvedValue({
      id: 'rth-1',
      manifest_code: 'RTH-000001',
      status: 'approved',
      shipments_count: 1,
    });
    mockListEligibleShipmentsForReturns.mockResolvedValue([sampleReturnShipment]);
    mockListCourierMyTasks.mockResolvedValue(samplePortalFeed);
  });

  it('displays Phase 8 Daily Operations links in the tenant sidebar', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/delivery']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'قوائم التوصيل (DLV)'})).toBeInTheDocument();
    });

    expect(screen.getByRole('link', {name: 'قوائم التوصيل'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قوائم إعادة التوصيل'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قوائم المرتجعات'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'بوابة المندوب'})).toBeInTheDocument();
  });

  it('supports ADR-017 delivery attempts policy config, admin override toggle, and delivery list approval', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/delivery']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('DLV-000001')).toBeInTheDocument();
    });

    // Update ADR-017 delivery policy
    fireEvent.click(screen.getByRole('button', {name: /سياسة المحاولات/}));
    const maxAttemptsInput = screen.getByLabelText('الحد الأقصى لمحاولات التوصيل');
    fireEvent.change(maxAttemptsInput, {target: {value: '2'}});
    fireEvent.click(screen.getByLabelText('إلزام التوقيع أو رمز OTP عند التسليم (POD)'));
    fireEvent.click(screen.getByRole('button', {name: 'حفظ السياسة'}));

    await waitFor(() => {
      expect(mockUpdateTenantDeliveryPolicy).toHaveBeenCalledWith(tenantAlpha.id, 2, 10, true);
    });

    // Open DLV workbench, enable admin attempt override, add via barcode, and approve
    fireEvent.click(screen.getByRole('button', {name: 'تجهيز واعتماد'}));
    await waitFor(() => {
      expect(screen.getByText('SHP-0000801')).toBeInTheDocument();
    });

    const overrideCheckbox = screen.getByLabelText(/تجاوز إداري لحد محاولات التوصيل/);
    fireEvent.click(overrideCheckbox);

    fireEvent.click(screen.getByRole('button', {name: 'مسح بالباركود'}));
    fireEvent.change(screen.getByLabelText('امسح الباركود أو أدخل رقم البوليصة'), {
      target: {value: 'SFB-80180180'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ وإضافة الشحنة'}));

    await waitFor(() => {
      expect(mockAddShipmentsToDeliveryList).toHaveBeenCalledWith(
        tenantAlpha.id,
        'dlv-1',
        [],
        'SFB-80180180',
        true,
      );
    });

    fireEvent.click(screen.getByRole('button', {name: 'إغلاق'}));
    fireEvent.click(screen.getByRole('button', {name: 'اعتماد القائمة وخروج للتوصيل'}));

    await waitFor(() => {
      expect(mockApproveDeliveryList).toHaveBeenCalledWith(tenantAlpha.id, 'dlv-1');
    });
  });

  it('launches DeliveryExecutionModal from Out-for-Delivery shipments list and records ADR-016 recipient return collection', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/shipments/out-for-delivery']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-0000801')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'تسجيل النتيجة'}));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Select return_to_sender + ADR-016 Mode 3: recipient_paid_fee
    fireEvent.click(screen.getByRole('button', {name: 'تحويل للمرتجع (للراسل)'}));

    fireEvent.change(screen.getByLabelText('سياسة تحمل رسوم المرتجع'), {
      target: {value: 'recipient_paid_fee'},
    });

    const collectedInput = screen.getByLabelText(/المبلغ المحصل من المستلم عند الباب/);
    fireEvent.change(collectedInput, {target: {value: '45'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ نتيجة التوصيل'}));

    await waitFor(() => {
      expect(mockRecordDeliveryExecution).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          shipment_id: sampleOutShipment.id,
          outcome: 'return_to_sender',
          return_type_code: 'recipient_paid_fee',
          return_collected_amount: 45,
        }),
      );
    });
  });

  it('handles 3-stage Returns Workflow (RTH inbound + PTP custody + RTN client handover)', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/returns']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('RTH-000001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'تجهيز واعتماد'}));
    await waitFor(() => {
      expect(screen.getByText('SHP-0000802')).toBeInTheDocument();
      expect(screen.getByText(/عهدة استبدال \(PTP\): في عهدة المندوب/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'اعتماد قائمة المرتجعات'}));
    await waitFor(() => {
      expect(mockApproveReturnManifest).toHaveBeenCalledWith(tenantAlpha.id, 'rth-1');
    });

    // Switch back and open Stage 3 tab (RTN)
    fireEvent.click(screen.getByRole('button', {name: 'العودة للقوائم'}));
    fireEvent.click(screen.getByRole('button', {name: /3\. تسليم المرتجعات للعميل النهائي/}));

    await waitFor(() => {
      expect(mockListReturnManifests).toHaveBeenCalledWith(tenantAlpha.id, 'client_return_handover');
    });
  });

  it('binds Courier Portal strictly to bound courier account and submits OTP POD delivery', async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-courier-1', email: 'mandob_one@internal.test'},
      profile: {id: 'user-courier-1', display_name: 'كريم المنصور', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipCourier],
      signOut: vi.fn(),
      refreshSessionData: vi.fn(),
    });
    mockGetMyTenantPermissions.mockResolvedValue({
      client_id: null,
      courier_id: 'crr-1',
      branch_ids: ['br-1'],
      permissions: [{permission_key: 'operations.delivery.execute', scope: PermissionScope.ASSIGNED}],
    });
    mockGetTenantDeliveryPolicy.mockResolvedValue({
      tenant_id: tenantAlpha.id,
      max_delivery_attempts: 3,
      retry_extra_fee: 0,
      require_pod_on_delivery: true,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/courier-portal']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-0000801')).toBeInTheDocument();
    });

    // Bound courier does NOT see staff courier preview dropdown
    expect(screen.queryByLabelText('معاينة مهام المندوب:')).not.toBeInTheDocument();
    expect(mockListCourierMyTasks).toHaveBeenCalledWith(tenantAlpha.id, null);

    // Quick barcode scan opens POD execution modal directly
    fireEvent.change(screen.getByLabelText('مسح باركود الشحنة'), {
      target: {value: 'SFB-80180180'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'فتح تنفيذ الشحنة'}));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('وسيلة إثبات التسليم (POD)'), {
      target: {value: 'otp'},
    });
    fireEvent.click(screen.getByLabelText('تأكيد مطابقة الرمز مع المستلم'));
    fireEvent.click(screen.getByRole('button', {name: 'حفظ نتيجة التوصيل'}));

    await waitFor(() => {
      expect(mockRecordDeliveryExecution).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          shipment_id: sampleOutShipment.id,
          outcome: 'delivered',
          pod_method: 'otp',
          pod_otp_verified: true,
        }),
      );
    });
  });
});
