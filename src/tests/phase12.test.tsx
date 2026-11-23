import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {
  buildTenantStorageObjectPath,
  isSafeAppRoute,
  isSafeHttpUrl,
  validateAttachmentFile,
} from '@/features/messaging/messagingService';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {CourierPortalTasksFeed, TenantDeliveryPolicyRecord} from '@/types/delivery';
import type {
  ConversationRecord,
  MessageRecord,
  NotificationRecord,
  ShipmentAttachmentRecord,
  TenantMessagingSettings,
} from '@/types/messaging';
import type {ShipmentFullDetail, ShipmentListItem} from '@/types/shipments';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListClients = vi.fn();
const mockListShippingServices = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListCouriers = vi.fn();
const mockListExceptionReasons = vi.fn();
const mockListShipments = vi.fn();
const mockGetShipmentDetail = vi.fn();
const mockGetTenantDeliveryPolicy = vi.fn();
const mockListCourierMyTasks = vi.fn();

const mockListConversations = vi.fn();
const mockOpenOrGetConversation = vi.fn();
const mockListConversationMessages = vi.fn();
const mockSendConversationMessage = vi.fn();
const mockMarkConversationRead = vi.fn();
const mockListShipmentAttachments = vi.fn();
const mockRegisterShipmentAttachment = vi.fn();
const mockDeleteShipmentAttachment = vi.fn();
const mockUploadPrivateAttachment = vi.fn();
const mockGetSignedAttachmentUrl = vi.fn();
const mockListMyNotifications = vi.fn();
const mockGetUnreadNotificationsCount = vi.fn();
const mockMarkNotificationsRead = vi.fn();
const mockGetTenantMessagingSettings = vi.fn();
const mockUpdateTenantMessagingSettings = vi.fn();

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
    listShippingServices: (...args: unknown[]) => mockListShippingServices(...args),
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listExceptionReasons: (...args: unknown[]) => mockListExceptionReasons(...args),
  };
});

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
  };
});

vi.mock('@/features/shipments/shipmentsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/shipments/shipmentsService')>();
  return {
    ...actual,
    listShipments: (...args: unknown[]) => mockListShipments(...args),
    getShipmentDetail: (...args: unknown[]) => mockGetShipmentDetail(...args),
  };
});

vi.mock('@/features/delivery/deliveryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/delivery/deliveryService')>();
  return {
    ...actual,
    getTenantDeliveryPolicy: (...args: unknown[]) => mockGetTenantDeliveryPolicy(...args),
    listCourierMyTasks: (...args: unknown[]) => mockListCourierMyTasks(...args),
  };
});

vi.mock('@/features/messaging/messagingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/messaging/messagingService')>();
  return {
    ...actual,
    listConversations: (...args: unknown[]) => mockListConversations(...args),
    openOrGetConversation: (...args: unknown[]) => mockOpenOrGetConversation(...args),
    listConversationMessages: (...args: unknown[]) => mockListConversationMessages(...args),
    sendConversationMessage: (...args: unknown[]) => mockSendConversationMessage(...args),
    markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
    listShipmentAttachments: (...args: unknown[]) => mockListShipmentAttachments(...args),
    registerShipmentAttachment: (...args: unknown[]) => mockRegisterShipmentAttachment(...args),
    deleteShipmentAttachment: (...args: unknown[]) => mockDeleteShipmentAttachment(...args),
    uploadPrivateAttachment: (...args: unknown[]) => mockUploadPrivateAttachment(...args),
    getSignedAttachmentUrl: (...args: unknown[]) => mockGetSignedAttachmentUrl(...args),
    listMyNotifications: (...args: unknown[]) => mockListMyNotifications(...args),
    getUnreadNotificationsCount: (...args: unknown[]) => mockGetUnreadNotificationsCount(...args),
    markNotificationsRead: (...args: unknown[]) => mockMarkNotificationsRead(...args),
    getTenantMessagingSettings: (...args: unknown[]) => mockGetTenantMessagingSettings(...args),
    updateTenantMessagingSettings: (...args: unknown[]) => mockUpdateTenantMessagingSettings(...args),
    subscribeToMessagingUpdates: () => () => {},
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

const membershipClient: TenantMembershipRecord = {
  ...membershipOwner,
  id: 'bbbb2222-2222-2222-2222-222222222222',
  user_id: 'user-client-1',
  username: 'nile_store',
  account_subject_type: AccountSubjectType.CLIENT,
  role_key: 'client_owner',
};

const membershipCourier: TenantMembershipRecord = {
  ...membershipOwner,
  id: 'cccc3333-3333-3333-3333-333333333333',
  user_id: 'user-courier-1',
  username: 'mandob_one',
  account_subject_type: AccountSubjectType.COURIER,
  role_key: 'delivery_agent',
};

const sampleShipment: ShipmentListItem = {
  id: 'shp-1201',
  tenant_id: tenantAlpha.id,
  shipment_number: 'SHP-0001201',
  barcode_token: 'SFB-12011201',
  client_id: 'cl-1',
  origin_branch_id: 'br-1',
  current_branch_id: 'br-1',
  destination_branch_id: null,
  assigned_courier_id: 'crr-1',
  movement_type_id: 'mov-1',
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
  entered_amount: 450,
  prepaid_balance_amount: 450,
  total_shipping_fee: 65,
  return_fee: 30,
  recipient_collect_amount: 515,
  client_net_payout: 450,
  delivered_amount: null,
  pieces_count: 1,
  delivered_pieces_count: 0,
  returned_pieces_count: 0,
  partial_return_custody: 'none',
  exchange_status: 'none',
  actual_weight_kg: 1.5,
  chargeable_weight_kg: 1.5,
  allow_package_opening: false,
  package_description: 'إلكترونيات',
  external_reference: null,
  notes: null,
  pickup_date: '2026-11-21',
  pickup_time_from: null,
  pickup_time_to: null,
  current_snapshot_id: 'snap-1',
  sender_governorate_id: 'gov-1',
  sender_region_id: 'reg-1',
  recipient_governorate_id: 'gov-1',
  recipient_region_id: 'reg-1',
  delivery_attempts_count: 0,
  last_exception_reason_id: null,
  delivered_at: null,
  returned_at: null,
  cancelled_at: null,
  created_at: '2026-11-21T08:00:00Z',
  updated_at: '2026-11-21T08:00:00Z',
  client_name: 'متجر النيل',
  sender_name: 'متجر النيل',
  recipient_name: 'رامي حسن',
  recipient_mobile: '01233445566',
  recipient_address: 'مدينة نصر',
};

const sampleDetail: ShipmentFullDetail = {
  shipment: sampleShipment,
  parties: [
    {
      id: 'prt-1',
      tenant_id: tenantAlpha.id,
      shipment_id: sampleShipment.id,
      party_type: 'sender',
      name: 'متجر النيل',
      phone: null,
      mobile: '01010002000',
      governorate_id: 'gov-1',
      city_id: null,
      region_id: 'reg-1',
      address_line: 'مدينة نصر',
    },
    {
      id: 'prt-2',
      tenant_id: tenantAlpha.id,
      shipment_id: sampleShipment.id,
      party_type: 'recipient',
      name: 'رامي حسن',
      phone: null,
      mobile: '01233445566',
      governorate_id: 'gov-1',
      city_id: null,
      region_id: 'reg-1',
      address_line: 'مدينة نصر',
    },
  ],
  packages: [],
  dimensions: [],
  snapshots: [],
  events: [],
  relations: [],
  trackingTokens: [],
  notes: [],
  references: [],
};

const sampleConversation: ConversationRecord = {
  id: 'conv-1',
  tenant_id: tenantAlpha.id,
  entity_type: 'shipment',
  entity_id: sampleShipment.id,
  shipment_id: sampleShipment.id,
  client_id: 'cl-1',
  courier_id: 'crr-1',
  branch_id: 'br-1',
  subject: 'محادثة الشحنة SHP-0001201',
  status: 'open',
  last_message_at: '2026-11-21T10:00:00Z',
  last_message_preview: 'يرجى التأكد من رقم المستلم',
  created_by: 'user-alpha-1',
  created_at: '2026-11-21T09:00:00Z',
  updated_at: '2026-11-21T10:00:00Z',
};

const sampleMessages: MessageRecord[] = [
  {
    id: 'msg-1',
    tenant_id: tenantAlpha.id,
    conversation_id: 'conv-1',
    sender_user_id: 'user-client-1',
    sender_display_name: 'متجر النيل',
    sender_subject_type: 'client',
    visibility: 'external',
    body: 'يرجى التأكد من موعد التسليم اليوم',
    idempotency_key: 'idem-1',
    created_at: '2026-11-21T09:30:00Z',
    attachments: [],
  },
];

const sampleAttachments: ShipmentAttachmentRecord[] = [
  {
    id: 'shp-att-1',
    tenant_id: tenantAlpha.id,
    shipment_id: sampleShipment.id,
    storage_object_id: 'obj-1',
    category: 'waybill',
    notes: 'فاتورة العميل',
    created_by: 'user-alpha-1',
    created_at: '2026-11-21T09:15:00Z',
    storage_object: {
      id: 'obj-1',
      tenant_id: tenantAlpha.id,
      bucket_id: 'shipment-attachments',
      object_path: `${tenantAlpha.id}/shipment/${sampleShipment.id}/2026-11-21/invoice.pdf`,
      entity_type: 'shipment',
      entity_id: sampleShipment.id,
      shipment_id: sampleShipment.id,
      client_id: 'cl-1',
      file_name: 'invoice.pdf',
      mime_type: 'application/pdf',
      size_bytes: 245000,
      visibility: 'external',
      uploaded_by: 'user-alpha-1',
      uploaded_by_name: 'مالك ألفا',
      created_at: '2026-11-21T09:15:00Z',
    },
  },
];

const sampleNotifications: NotificationRecord[] = [
  {
    id: 'notif-1',
    tenant_id: tenantAlpha.id,
    recipient_user_id: 'user-alpha-1',
    category: 'new_message',
    title: 'رسالة واردة · محادثة الشحنة SHP-0001201',
    body: 'متجر النيل: يرجى التأكد من موعد التسليم اليوم',
    entity_type: 'shipment',
    entity_id: sampleShipment.id,
    action_path: `/c/alpha-express/app/shipments/${sampleShipment.id}`,
    is_read: false,
    read_at: null,
    created_at: '2026-11-21T09:30:00Z',
  },
  {
    id: 'notif-2',
    tenant_id: tenantAlpha.id,
    recipient_user_id: 'user-alpha-1',
    category: 'shipment_status',
    title: 'تحديث حالة الشحنة SHP-0001201',
    body: 'انتقلت الشحنة إلى الحالة: out_for_delivery',
    entity_type: 'shipment',
    entity_id: sampleShipment.id,
    action_path: `/c/alpha-express/app/shipments/${sampleShipment.id}`,
    is_read: false,
    read_at: null,
    created_at: '2026-11-21T09:10:00Z',
  },
];

const defaultSettings: TenantMessagingSettings = {
  tenant_id: tenantAlpha.id,
  message_retention_days: 365,
  attachment_max_size_mb: 5,
  notify_on_shipment_status: true,
  notify_on_new_message: true,
  notify_on_settlement: true,
};

const defaultPolicy: TenantDeliveryPolicyRecord = {
  tenant_id: tenantAlpha.id,
  max_delivery_attempts: 3,
  retry_extra_fee: 0,
  require_pod_on_delivery: false,
};

const samplePortalFeed: CourierPortalTasksFeed = {
  courier: {
    id: 'crr-1',
    code: 'CRR-001',
    name: 'كريم المنصور',
    branch_id: 'br-1',
    mobile: '01099990001',
  },
  pickup_lists: [],
  delivery_lists: [],
  shipments: [sampleShipment],
};

describe('Phase 12: Messaging, Private Storage Attachments & Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-alpha-1', email: 'admin@internal.test'},
      profile: {id: 'user-alpha-1', display_name: 'مالك ألفا', is_platform_user: false, is_active: true},
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
        {permission_key: 'messaging.read', scope: PermissionScope.TENANT},
        {permission_key: 'messaging.send', scope: PermissionScope.TENANT},
        {permission_key: 'messaging.internal', scope: PermissionScope.TENANT},
        {permission_key: 'attachments.manage', scope: PermissionScope.TENANT},
        {permission_key: 'shipments.read', scope: PermissionScope.TENANT},
      ],
    });

    mockListBranches.mockResolvedValue([]);
    mockListClients.mockResolvedValue([]);
    mockListShippingServices.mockResolvedValue([]);
    mockListGovernorates.mockResolvedValue([]);
    mockListRegions.mockResolvedValue([]);
    mockListCouriers.mockResolvedValue([]);
    mockListExceptionReasons.mockResolvedValue([]);
    mockListShipments.mockResolvedValue([sampleShipment]);
    mockGetShipmentDetail.mockResolvedValue(sampleDetail);
    mockGetTenantDeliveryPolicy.mockResolvedValue(defaultPolicy);
    mockListCourierMyTasks.mockResolvedValue(samplePortalFeed);

    mockListConversations.mockResolvedValue([sampleConversation]);
    mockOpenOrGetConversation.mockResolvedValue('conv-1');
    mockListConversationMessages.mockResolvedValue(sampleMessages);
    mockSendConversationMessage.mockResolvedValue({
      message_id: 'msg-2',
      conversation_id: 'conv-1',
      attachments_count: 0,
      deduplicated: false,
    });
    mockMarkConversationRead.mockResolvedValue(undefined);

    mockListShipmentAttachments.mockResolvedValue(sampleAttachments);
    mockRegisterShipmentAttachment.mockResolvedValue('shp-att-2');
    mockDeleteShipmentAttachment.mockResolvedValue(undefined);
    mockUploadPrivateAttachment.mockResolvedValue({
      bucket_id: 'shipment-attachments',
      object_path: `${tenantAlpha.id}/shipment/${sampleShipment.id}/2026-11-21/pod.png`,
      file_name: 'pod.png',
      mime_type: 'image/png',
      size_bytes: 12000,
    });
    mockGetSignedAttachmentUrl.mockResolvedValue('https://example.supabase.co/storage/v1/object/sign/test');

    mockListMyNotifications.mockResolvedValue(sampleNotifications);
    mockGetUnreadNotificationsCount.mockResolvedValue(2);
    mockMarkNotificationsRead.mockResolvedValue(2);

    mockGetTenantMessagingSettings.mockResolvedValue(defaultSettings);
    mockUpdateTenantMessagingSettings.mockResolvedValue({
      ...defaultSettings,
      message_retention_days: 730,
      attachment_max_size_mb: 10,
      notify_on_settlement: false,
    });
  });

  it('enforces attachment allowlist, size limit, tenant-isolated path structure, and safe URL validation', () => {
    const validPdf = validateAttachmentFile({name: 'waybill.pdf', type: 'application/pdf', size: 1024 * 1024}, 5);
    expect(validPdf.valid).toBe(true);

    const blockedSvg = validateAttachmentFile({name: 'xss.svg', type: 'image/svg+xml', size: 1024}, 5);
    expect(blockedSvg.valid).toBe(false);

    const blockedExe = validateAttachmentFile({name: 'payload.exe', type: 'application/octet-stream', size: 1024}, 5);
    expect(blockedExe.valid).toBe(false);

    const oversized = validateAttachmentFile({name: 'photo.jpg', type: 'image/jpeg', size: 8 * 1024 * 1024}, 5);
    expect(oversized.valid).toBe(false);

    const path = buildTenantStorageObjectPath(
      tenantAlpha.id,
      'shipment',
      sampleShipment.id,
      'png',
      new Date('2026-11-21T12:00:00Z'),
    );
    expect(path.startsWith(`${tenantAlpha.id}/shipment/${sampleShipment.id}/2026-11-21/`)).toBe(true);
    expect(path.endsWith('.png')).toBe(true);

    expect(isSafeHttpUrl('https://storage.example.com/signed')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAppRoute('/c/alpha-express/app/shipments/1')).toBe(true);
    expect(isSafeAppRoute('//evil.com')).toBe(false);
  });

  it('displays unread notifications count and Phase 12 sidebar links in TenantAdminShellPage', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/messaging']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'مركز الرسائل والإشعارات'})).toBeInTheDocument();
    });

    expect(screen.getByRole('link', {name: 'الرسائل والمحادثات'})).toBeInTheDocument();
    expect(screen.getAllByRole('link', {name: /الإشعارات · 2/}).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', {name: 'إعدادات الشركة والملفات'})).toBeInTheDocument();
  });

  it('supports MessagingCenterPage inbox, idempotent message send, and Notifications mark-all-read', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/messaging']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('يرجى التأكد من موعد التسليم اليوم')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('نص الرسالة'), {
      target: {value: 'سيتم التسليم قبل الساعة 4 مساءً'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'إرسال الرسالة'}));

    await waitFor(() => {
      expect(mockSendConversationMessage).toHaveBeenCalledWith(
        tenantAlpha.id,
        'conv-1',
        'سيتم التسليم قبل الساعة 4 مساءً',
        'external',
        expect.any(String),
        [],
      );
    });

    // Switch to Notifications tab and mark all read
    fireEvent.click(screen.getByRole('button', {name: /الإشعارات/}));
    await waitFor(() => {
      expect(screen.getByText('رسالة واردة · محادثة الشحنة SHP-0001201')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'تحديد الكل كمقروء'}));
    await waitFor(() => {
      expect(mockMarkNotificationsRead).toHaveBeenCalledWith(tenantAlpha.id, null);
    });
  });

  it('renders ShipmentDetailPage Attachments & Messages tabs and hides internal visibility from client accounts', async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-client-1', email: 'nile@internal.test'},
      profile: {id: 'user-client-1', display_name: 'متجر النيل', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipClient],
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });
    mockGetMyTenantPermissions.mockResolvedValue({
      client_id: 'cl-1',
      courier_id: null,
      branch_ids: [],
      permissions: [
        {permission_key: 'messaging.read', scope: PermissionScope.OWN},
        {permission_key: 'messaging.send', scope: PermissionScope.OWN},
        {permission_key: 'attachments.manage', scope: PermissionScope.OWN},
      ],
    });

    render(
      <MemoryRouter initialEntries={[`/c/alpha-express/app/shipments/${sampleShipment.id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'SHP-0001201'})).toBeInTheDocument();
    });

    // Attachments Tab
    fireEvent.click(screen.getByRole('button', {name: /المستندات والمرفقات/}));
    await waitFor(() => {
      expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('نطاق الرؤية')).not.toBeInTheDocument();

    const fileInput = screen.getByLabelText('اختيار ورفع ملف للشحنة');
    const mockFile = new File(['png-bytes'], 'pod.png', {type: 'image/png'});
    fireEvent.change(fileInput, {target: {files: [mockFile]}});

    await waitFor(() => {
      expect(mockUploadPrivateAttachment).toHaveBeenCalled();
      expect(mockRegisterShipmentAttachment).toHaveBeenCalledWith(
        tenantAlpha.id,
        sampleShipment.id,
        expect.objectContaining({
          file_name: 'pod.png',
          visibility: 'external',
        }),
      );
    });

    // Messages Tab (Client cannot select internal visibility)
    fireEvent.click(screen.getByRole('button', {name: 'الرسائل والمحادثة'}));
    await waitFor(() => {
      expect(mockOpenOrGetConversation).toHaveBeenCalledWith(
        tenantAlpha.id,
        'shipment',
        sampleShipment.id,
        'محادثة الشحنة SHP-0001201',
      );
    });
    expect(screen.queryByText(/داخلي للفريق فقط \(مخفي/)).not.toBeInTheDocument();
  });

  it('enables CourierPortalPage Messaging tab for bound couriers', async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-courier-1', email: 'mandob@internal.test'},
      profile: {id: 'user-courier-1', display_name: 'كريم المنصور', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [{
        ...membershipCourier,
        account_subject_type: AccountSubjectType.STAFF,
        role_key: 'company_owner',
      }],
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });
    mockGetMyTenantPermissions.mockResolvedValue({
      client_id: null,
      courier_id: 'crr-1',
      branch_ids: ['br-1'],
      permissions: [
        {permission_key: 'operations.delivery.execute', scope: PermissionScope.ASSIGNED},
        {permission_key: 'messaging.read', scope: PermissionScope.ASSIGNED},
        {permission_key: 'messaging.send', scope: PermissionScope.ASSIGNED},
      ],
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/operations/courier-portal']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-0001201')).toBeInTheDocument();
    });
    expect(screen.getByRole('navigation', {name: 'القائمة الجانبية للمندوب'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'قائمة العملاء'})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'الرسائل والتواصل'}));
    await waitFor(() => {
      expect(screen.getByLabelText('الشحنة محل التواصل:')).toBeInTheDocument();
      expect(screen.getByText('يرجى التأكد من موعد التسليم اليوم')).toBeInTheDocument();
    });
  });

  it('allows Tenant Admin to update retention, attachment size & notification settings and locks out non-admins', async () => {
    const {unmount} = render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/settings']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'إعدادات الشركة والرسائل والمرفقات'})).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('مدة الاحتفاظ بسجل المحادثات والمرفقات (بالأيام)'), {
      target: {value: '730'},
    });
    fireEvent.change(screen.getByLabelText('الحد الأقصى لحجم الملف المرفق (ميجابايت)'), {
      target: {value: '10'},
    });
    fireEvent.click(screen.getByLabelText(/التسويات المالية والتحصيل/));
    fireEvent.click(screen.getByRole('button', {name: 'حفظ الإعدادات'}));

    await waitFor(() => {
      expect(mockUpdateTenantMessagingSettings).toHaveBeenCalledWith(tenantAlpha.id, {
        message_retention_days: 730,
        attachment_max_size_mb: 10,
        notify_on_shipment_status: true,
        notify_on_new_message: true,
        notify_on_settlement: false,
      });
    });

    unmount();

    // Non-admin staff member gets read-only settings view
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'user-staff-2', email: 'support@internal.test'},
      profile: {id: 'user-staff-2', display_name: 'موظف دعم', is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [
        {
          ...membershipOwner,
          user_id: 'user-staff-2',
          username: 'support_agent',
          role_key: 'customer_support',
        },
      ],
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/settings']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/عرض فقط — تعديل سياسات الشركة/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', {name: 'حفظ الإعدادات'})).not.toBeInTheDocument();
  });
});
