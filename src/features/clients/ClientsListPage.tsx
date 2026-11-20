import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {ConfirmDialog} from '@/components/ui/ConfirmDialog';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {FilterBar} from '@/components/ui/FilterBar';
import {buildTenantBasePath} from '@/config/brand';
import {
  approveRegistrationRequest,
  archiveClient,
  cloneClientRecord,
  listClientRegistrationRequests,
  listClients,
  rejectRegistrationRequest,
  saveClient,
  type SaveClientInput,
} from '@/features/clients/clientsService';
import {
  generateNextCode,
  listBranches,
  listChartOfAccounts,
  listCountries,
  listGovernorates,
  listOperationalRefs,
  listRegions,
  listShipmentTypes,
} from '@/features/definitions/definitionsService';
import {listClientPriceLists, listTaxProfiles} from '@/features/pricing/pricingService';
import * as tenantService from '@/features/tenants/tenantService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  BranchRecord,
  ChartOfAccountRecord,
  CountryRecord,
  GovernorateRecord,
  PaymentTermRecord,
  RegionRecord,
  ShipmentTypeRecord,
} from '@/types/definitions';
import {
  EGYPTIAN_BANKS,
  type ClientCategory,
  type ClientPriceListRecord,
  type ClientRecord,
  type ClientRegistrationRequestRecord,
  type PayoutMethod,
  type PriceMode,
  type TaxProfileRecord,
  type TradeDirection,
} from '@/types/pricing';
import {Archive, Check, Copy, Edit3, Eye, Plus, X} from 'lucide-react';

const CATEGORY_LABELS: Record<ClientCategory, string> = {
  standard: 'عادي',
  vip: 'VIP',
  corporate: 'شركات',
  ecommerce: 'متجر إلكتروني',
};

const PAYOUT_LABELS: Record<PayoutMethod, string> = {
  cash: 'نقدي',
  bank_transfer: 'حساب بنكي',
  vodafone_cash: 'فودافون كاش',
};

export interface ClientsListPageProps {
  readonly initialMode?: 'list' | 'create' | 'registrations';
}

export function ClientsListPage({initialMode = 'list'}: ClientsListPageProps) {
  const {tenant, isAdmin} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [tab, setTab] = useState<'clients' | 'requests'>(initialMode === 'registrations' ? 'requests' : 'clients');
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [requests, setRequests] = useState<readonly ClientRegistrationRequestRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [countries, setCountries] = useState<readonly CountryRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [priceLists, setPriceLists] = useState<readonly ClientPriceListRecord[]>([]);
  const [taxProfiles, setTaxProfiles] = useState<readonly TaxProfileRecord[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<readonly PaymentTermRecord[]>([]);
  const [shipmentTypes, setShipmentTypes] = useState<readonly ShipmentTypeRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [govFilter, setGovFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<SaveClientInput | null>(null);

  const [cloneSource, setCloneSource] = useState<ClientRecord | null>(null);
  const [cloneCode, setCloneCode] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<ClientRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ClientRegistrationRequestRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Phase 11: Public Storefront & Self-Registration Admin Settings
  const [allowSelfReg, setAllowSelfReg] = useState(false);
  const [autoApproveClients, setAutoApproveClients] = useState(false);
  const [publicTagline, setPublicTagline] = useState('');
  const [publicSupportPhone, setPublicSupportPhone] = useState('');
  const [publicSupportEmail, setPublicSupportEmail] = useState('');
  const [savingRegSettings, setSavingRegSettings] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        cRows,
        rRows,
        bRows,
        aRows,
        cntRows,
        gRows,
        regRows,
        plRows,
        tpRows,
        opsRefs,
        stRows,
      ] = await Promise.all([
        listClients(tenant.id),
        listClientRegistrationRequests(tenant.id),
        listBranches(tenant.id),
        listChartOfAccounts(tenant.id),
        listCountries(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
        listClientPriceLists(tenant.id),
        listTaxProfiles(tenant.id),
        listOperationalRefs(tenant.id),
        listShipmentTypes(tenant.id),
      ]);
      setClients(cRows);
      setRequests(rRows);
      setBranches(bRows);
      setAccounts(aRows.filter((a) => !a.is_group && a.is_active));
      setCountries(cntRows);
      setGovernorates(gRows);
      setRegions(regRows);
      setPriceLists(plRows);
      setTaxProfiles(tpRows);
      setPaymentTerms(opsRefs.paymentTerms);
      setShipmentTypes(stRows);

      if (
        Object.keys(tenantService).includes('getTenantRegistrationSettings') &&
        typeof tenantService.getTenantRegistrationSettings === 'function'
      ) {
        try {
          const regSettings = await tenantService.getTenantRegistrationSettings(tenant.id);
          setAllowSelfReg(regSettings.allow_client_self_registration);
          setAutoApproveClients(regSettings.auto_approve_clients);
          setPublicTagline(regSettings.public_tagline ?? '');
          setPublicSupportPhone(regSettings.public_support_phone ?? '');
          setPublicSupportEmail(regSettings.public_support_email ?? '');
        } catch {
          // Non-blocking for non-admin staff roles
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات العملاء.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveRegSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !Object.keys(tenantService).includes('updateTenantRegistrationSettings') ||
      typeof tenantService.updateTenantRegistrationSettings !== 'function'
    ) {
      return;
    }
    setSavingRegSettings(true);
    setError(null);
    setFeedback(null);
    try {
      await tenantService.updateTenantRegistrationSettings(tenant.id, {
        allow_client_self_registration: allowSelfReg,
        auto_approve_clients: autoApproveClients,
        public_tagline: publicTagline || null,
        public_support_phone: publicSupportPhone || null,
        public_support_email: publicSupportEmail || null,
      });
      setFeedback('تم حفظ إعدادات الموقع العام والتسجيل الذاتي للتجار بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات التسجيل الذاتي.');
    } finally {
      setSavingRegSettings(false);
    }
  };

  const govNameMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regionNameMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);
  const priceListMap = useMemo(() => new Map(priceLists.map((p) => [p.id, p])), [priceLists]);
  const taxMap = useMemo(() => new Map(taxProfiles.map((t) => [t.id, t])), [taxProfiles]);

  const defaultTaxId = useMemo(
    () => taxProfiles.find((t) => t.tax_mode === 'none' || t.is_default)?.id ?? taxProfiles[0]?.id ?? '',
    [taxProfiles],
  );
  const defaultPriceListId = useMemo(
    () => priceLists.find((p) => p.is_system_default || p.code === '0')?.id ?? priceLists[0]?.id ?? '',
    [priceLists],
  );

  const buildDefaultFormState = useCallback((): SaveClientInput => {
    const defaultGovId = governorates[0]?.id ?? '';
    const defaultRegId = regions.find((r) => r.governorate_id === defaultGovId)?.id ?? regions[0]?.id ?? '';
    return {
      code: generateNextCode('CL', clients.map((c) => c.code)),
      name: '',
      branch_id: null,
      ledger_account_id: null,
      country_id: countries[0]?.id ?? null,
      governorate_id: defaultGovId,
      city_id: null,
      region_id: defaultRegId,
      price_list_id: defaultPriceListId,
      tax_profile_id: defaultTaxId,
      default_payment_term_id: paymentTerms[0]?.id ?? null,
      default_shipment_type_id: shipmentTypes[0]?.id ?? null,
      default_price_mode: 'shipping_excluded',
      allow_package_opening: false,
      client_category: 'standard',
      activity_type: '',
      trade_direction: 'b2c',
      payout_method: 'cash',
      bank_name: EGYPTIAN_BANKS[0],
      bank_account_number: '',
      wallet_phone: '',
      phone: '',
      mobile: '',
      po_box: '',
      postal_code: '',
      address_line: '',
      email: '',
      is_active: true,
    };
  }, [clients, countries, defaultPriceListId, defaultTaxId, governorates, paymentTerms, regions, shipmentTypes]);

  useEffect(() => {
    if (initialMode === 'registrations') {
      setTab('requests');
      setShowForm(false);
    } else if (initialMode === 'create') {
      setTab('clients');
      if (!loading) {
        setFormState((prev) => prev ?? buildDefaultFormState());
        setShowForm(true);
      }
    } else {
      setTab('clients');
      setShowForm(false);
    }
  }, [initialMode, loading, buildDefaultFormState]);

  const openCreateForm = () => {
    setFormState(buildDefaultFormState());
    setShowForm(true);
    setFeedback(null);
  };

  const openEditForm = (row: ClientRecord) => {
    setFormState({
      id: row.id,
      code: row.code,
      name: row.name,
      branch_id: row.branch_id,
      ledger_account_id: row.ledger_account_id,
      country_id: row.country_id,
      governorate_id: row.governorate_id,
      city_id: row.city_id,
      region_id: row.region_id,
      price_list_id: row.price_list_id,
      tax_profile_id: row.tax_profile_id,
      default_payment_term_id: row.default_payment_term_id,
      default_shipment_type_id: row.default_shipment_type_id,
      default_price_mode: row.default_price_mode,
      allow_package_opening: row.allow_package_opening,
      client_category: row.client_category,
      activity_type: row.activity_type ?? '',
      trade_direction: row.trade_direction,
      payout_method: row.payout_method,
      bank_name: row.bank_name ?? EGYPTIAN_BANKS[0],
      bank_account_number: row.bank_account_number ?? '',
      wallet_phone: row.wallet_phone ?? '',
      phone: row.phone,
      mobile: row.mobile,
      po_box: row.po_box ?? '',
      postal_code: row.postal_code ?? '',
      address_line: row.address_line,
      email: row.email ?? '',
      is_active: row.is_active,
    });
    setShowForm(true);
    setFeedback(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!formState) return;
    setSaving(true);
    setError(null);
    try {
      await saveClient(tenant.id, formState);
      setShowForm(false);
      setFormState(null);
      setFeedback('تم حفظ بيانات العميل بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ العميل.');
    } finally {
      setSaving(false);
    }
  };

  const handleCloneSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!cloneSource) return;
    setSaving(true);
    try {
      await cloneClientRecord(tenant.id, cloneSource.id, cloneCode, cloneName);
      setCloneSource(null);
      setFeedback('تم نسخ سجل العميل بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر نسخ العميل.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archiveClient(tenant.id, archiveTarget.id);
      setArchiveTarget(null);
      setFeedback('تمت أرشفة العميل.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر أرشفة العميل.');
    }
  };

  const handleApproveRequest = async (req: ClientRegistrationRequestRecord) => {
    try {
      await approveRegistrationRequest(tenant.id, req, {
        clientCode: generateNextCode('CL', clients.map((c) => c.code)),
        priceListId: defaultPriceListId,
        taxProfileId: defaultTaxId,
      });
      setFeedback(`تم اعتماد طلب ${req.company_name} وإضافته لقائمة العملاء.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر اعتماد طلب التسجيل.');
    }
  };

  const handleRejectRequest = async () => {
    if (!rejectTarget) return;
    try {
      await rejectRegistrationRequest(tenant.id, rejectTarget.id, rejectReason);
      setRejectTarget(null);
      setRejectReason('');
      setFeedback('تم رفض طلب التسجيل.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر رفض الطلب.');
    }
  };

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (govFilter && c.governorate_id !== govFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.mobile.toLowerCase().includes(q)
      );
    });
  }, [clients, search, govFilter]);

  const formRegions = useMemo(
    () => regions.filter((r) => !formState?.governorate_id || r.governorate_id === formState.governorate_id),
    [regions, formState?.governorate_id],
  );

  const clientColumns: readonly DataTableColumn<ClientRecord>[] = [
    {
      key: 'code',
      header: 'الكود',
      render: (r) => <span className="font-mono-tabular font-semibold text-slate-900">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'العميل',
      render: (r) => (
        <div>
          <Link to={`${basePath}/clients/${r.id}`} className="font-medium text-slate-900 hover:underline">
            {r.name}
          </Link>
          <p className="text-xs text-slate-500">
            {CATEGORY_LABELS[r.client_category]} · {r.trade_direction.toUpperCase()}
          </p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'المحافظة / المنطقة',
      render: (r) => (
        <span className="text-xs text-slate-700">
          {govNameMap.get(r.governorate_id) ?? '—'} · {regionNameMap.get(r.region_id) ?? '—'}
        </span>
      ),
    },
    {
      key: 'priceList',
      header: 'قائمة الأسعار',
      render: (r) => {
        const pl = priceListMap.get(r.price_list_id);
        return (
          <span className="text-xs text-slate-700">
            {pl ? `${pl.code} — ${pl.name}` : '—'}
          </span>
        );
      },
    },
    {
      key: 'tax',
      header: 'الضريبة / السداد',
      render: (r) => {
        const tx = taxMap.get(r.tax_profile_id);
        return (
          <span className="text-xs text-slate-600">
            {tx?.tax_mode === 'none' ? 'بدون ضريبة' : `${tx?.rate_percent ?? 0}% (${tx?.tax_mode === 'inclusive' ? 'شاملة' : 'مضافة'})`} · {PAYOUT_LABELS[r.payout_method]}
          </span>
        );
      },
    },
    {
      key: 'mobile',
      header: 'الموبايل',
      render: (r) => <span className="font-mono-tabular text-xs text-slate-700">{r.mobile}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span className={`text-xs font-medium ${r.is_active ? 'text-emerald-700' : 'text-slate-500'}`}>
          {r.is_active ? 'فعال' : 'موقوف'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Link
            to={`${basePath}/clients/${r.id}`}
            title="عرض التفاصيل"
            className="rounded border border-slate-200 p-1 text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3.5 w-3.5" />
          </Link>
          {isAdmin && (
            <>
              <button
                type="button"
                title="تعديل"
                onClick={() => openEditForm(r)}
                className="rounded border border-slate-200 p-1 text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="نسخ العميل"
                onClick={() => {
                  setCloneSource(r);
                  setCloneCode(generateNextCode('CL', clients.map((c) => c.code)));
                  setCloneName(`${r.name} (نسخة)`);
                }}
                className="rounded border border-slate-200 p-1 text-slate-700 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="أرشفة"
                onClick={() => setArchiveTarget(r)}
                className="rounded border border-red-200 p-1 text-red-700 hover:bg-red-50"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const requestColumns: readonly DataTableColumn<ClientRegistrationRequestRecord>[] = [
    {
      key: 'company',
      header: 'اسم العميل / المتجر',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.company_name}</p>
          <p className="text-xs text-slate-500">{r.email}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'الموقع',
      render: (r) => (
        <span className="text-xs text-slate-700">
          {govNameMap.get(r.governorate_id) ?? '—'} · {regionNameMap.get(r.region_id) ?? '—'}
        </span>
      ),
    },
    {
      key: 'payout',
      header: 'وسيلة السداد',
      render: (r) => <span className="text-xs text-slate-700">{PAYOUT_LABELS[r.payout_method]}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span
          className={`text-xs font-medium ${
            r.status === 'approved'
              ? 'text-emerald-700'
              : r.status === 'rejected'
                ? 'text-red-700'
                : 'text-amber-700'
          }`}
        >
          {r.status === 'pending' ? 'قيد المراجعة' : r.status === 'approved' ? 'معتمد' : 'مرفوض'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'قرار الإدارة',
      render: (r) =>
        r.status === 'pending' && isAdmin ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleApproveRequest(r)}
              className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800"
            >
              <Check className="h-3.5 w-3.5" />
              اعتماد
            </button>
            <button
              type="button"
              onClick={() => setRejectTarget(r)}
              className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
              رفض
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-500">{r.rejection_reason ?? '—'}</span>
        ),
    },
  ];

  const pendingRequestsCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {initialMode === 'create'
              ? 'إنشاء عميل جديد'
              : initialMode === 'registrations'
                ? 'الحسابات المسجلة (طلبات الاعتماد)'
                : 'قائمة العملاء'}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {initialMode === 'registrations'
              ? 'مراجعة الحسابات المسجلة عبر موقع الشركة واعتمادها أو رفضها (دون فتح حساب دخول تلقائي).'
              : 'إدارة ملفات العملاء وربط قوائم الأسعار والضرائب وبيانات التحصيل والسداد.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab('clients')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'clients' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              قائمة العملاء ({clients.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('requests')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'requests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الحسابات المسجلة ({pendingRequestsCount})
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              إنشاء عميل جديد
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {feedback}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      {showForm && formState && (
        <form onSubmit={handleSave} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {formState.id ? 'تعديل بيانات العميل' : 'إنشاء عميل جديد'}
            </h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:text-slate-900">
              إغلاق
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="client-code" className="block text-xs font-medium text-slate-700">
                كود العميل
              </label>
              <input
                id="client-code"
                required
                dir="ltr"
                value={formState.code}
                onChange={(e) => setFormState({...formState, code: e.target.value.toUpperCase()})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="client-name" className="block text-xs font-medium text-slate-700">
                اسم العميل / المتجر *
              </label>
              <input
                id="client-name"
                required
                value={formState.name}
                onChange={(e) => setFormState({...formState, name: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="client-branch" className="block text-xs font-medium text-slate-700">
                الفرع (اتركه فارغًا لتغطية كل الفروع)
              </label>
              <select
                id="client-branch"
                value={formState.branch_id ?? ''}
                onChange={(e) => setFormState({...formState, branch_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">كل الفروع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="client-ledger" className="block text-xs font-medium text-slate-700">
                حساب الأستاذ (اختياري)
              </label>
              <select
                id="client-ledger"
                value={formState.ledger_account_id ?? ''}
                onChange={(e) => setFormState({...formState, ledger_account_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">الحساب الافتراضي</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="client-gov" className="block text-xs font-medium text-slate-700">
                المحافظة / الإقليم *
              </label>
              <select
                id="client-gov"
                required
                value={formState.governorate_id}
                onChange={(e) => {
                  const nextGov = e.target.value;
                  const firstReg = regions.find((r) => r.governorate_id === nextGov)?.id ?? '';
                  setFormState({...formState, governorate_id: nextGov, region_id: firstReg});
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} — {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="client-region" className="block text-xs font-medium text-slate-700">
                المنطقة *
              </label>
              <select
                id="client-region"
                required
                value={formState.region_id}
                onChange={(e) => setFormState({...formState, region_id: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {formRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="client-pricelist" className="block text-xs font-medium text-slate-700">
                قائمة الأسعار *
              </label>
              <select
                id="client-pricelist"
                required
                value={formState.price_list_id}
                onChange={(e) => setFormState({...formState, price_list_id: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {priceLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.code} — {pl.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="client-tax" className="block text-xs font-medium text-slate-700">
                ملف الضريبة (افتراضي: بدون ضريبة)
              </label>
              <select
                id="client-tax"
                required
                value={formState.tax_profile_id}
                onChange={(e) => setFormState({...formState, tax_profile_id: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {taxProfiles.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="client-trade" className="block text-xs font-medium text-slate-700">
                نوع التعامل *
              </label>
              <select
                id="client-trade"
                value={formState.trade_direction}
                onChange={(e) => setFormState({...formState, trade_direction: e.target.value as TradeDirection})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="b2c">من تاجر إلى مستهلك (B2C)</option>
                <option value="b2b">من تاجر إلى تاجر (B2B)</option>
                <option value="all">جميع الأنواع</option>
              </select>
            </div>

            <div>
              <label htmlFor="client-category" className="block text-xs font-medium text-slate-700">
                تصنيف العميل
              </label>
              <select
                id="client-category"
                value={formState.client_category}
                onChange={(e) => setFormState({...formState, client_category: e.target.value as ClientCategory})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="standard">عادي</option>
                <option value="ecommerce">متجر إلكتروني</option>
                <option value="corporate">شركات</option>
                <option value="vip">VIP</option>
              </select>
            </div>

            <div>
              <label htmlFor="client-pricemode" className="block text-xs font-medium text-slate-700">
                نوع السعر الافتراضي
              </label>
              <select
                id="client-pricemode"
                value={formState.default_price_mode}
                onChange={(e) => setFormState({...formState, default_price_mode: e.target.value as PriceMode})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="shipping_excluded">غير شامل مصاريف الشحن</option>
                <option value="shipping_included">شامل مصاريف الشحن</option>
              </select>
            </div>

            <div>
              <label htmlFor="client-open" className="block text-xs font-medium text-slate-700">
                إمكانية فتح الطرد
              </label>
              <select
                id="client-open"
                value={formState.allow_package_opening ? 'yes' : 'no'}
                onChange={(e) => setFormState({...formState, allow_package_opening: e.target.value === 'yes'})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="no">غير مسموح</option>
                <option value="yes">مسموح بفتح الطرد</option>
              </select>
            </div>

            <div>
              <label htmlFor="client-payout" className="block text-xs font-medium text-slate-700">
                نوع الدفع / السداد للعميل
              </label>
              <select
                id="client-payout"
                value={formState.payout_method}
                onChange={(e) => setFormState({...formState, payout_method: e.target.value as PayoutMethod})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="cash">نقدي</option>
                <option value="bank_transfer">حساب بنكي</option>
                <option value="vodafone_cash">فودافون كاش</option>
              </select>
            </div>

            {formState.payout_method === 'bank_transfer' && (
              <>
                <div>
                  <label htmlFor="client-bank" className="block text-xs font-medium text-slate-700">
                    اسم البنك
                  </label>
                  <select
                    id="client-bank"
                    value={formState.bank_name ?? EGYPTIAN_BANKS[0]}
                    onChange={(e) => setFormState({...formState, bank_name: e.target.value})}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {EGYPTIAN_BANKS.map((bank) => (
                      <option key={bank} value={bank}>
                        {bank}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="client-iban" className="block text-xs font-medium text-slate-700">
                    رقم الحساب البنكي
                  </label>
                  <input
                    id="client-iban"
                    dir="ltr"
                    value={formState.bank_account_number ?? ''}
                    onChange={(e) => setFormState({...formState, bank_account_number: e.target.value})}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
                  />
                </div>
              </>
            )}

            {formState.payout_method === 'vodafone_cash' && (
              <div>
                <label htmlFor="client-wallet" className="block text-xs font-medium text-slate-700">
                  رقم محفظة فودافون كاش
                </label>
                <input
                  id="client-wallet"
                  dir="ltr"
                  value={formState.wallet_phone ?? ''}
                  onChange={(e) => setFormState({...formState, wallet_phone: e.target.value})}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
                />
              </div>
            )}

            <div>
              <label htmlFor="client-phone" className="block text-xs font-medium text-slate-700">
                رقم التليفون *
              </label>
              <input
                id="client-phone"
                required
                dir="ltr"
                value={formState.phone}
                onChange={(e) => setFormState({...formState, phone: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="client-mobile" className="block text-xs font-medium text-slate-700">
                رقم الموبايل *
              </label>
              <input
                id="client-mobile"
                required
                dir="ltr"
                value={formState.mobile}
                onChange={(e) => setFormState({...formState, mobile: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="client-address" className="block text-xs font-medium text-slate-700">
                العنوان بالتفصيل *
              </label>
              <input
                id="client-address"
                required
                value={formState.address_line}
                onChange={(e) => setFormState({...formState, address_line: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="client-email" className="block text-xs font-medium text-slate-700">
                البريد الإلكتروني (اختياري)
              </label>
              <input
                id="client-email"
                type="email"
                dir="ltr"
                value={formState.email ?? ''}
                onChange={(e) => setFormState({...formState, email: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="client-activity" className="block text-xs font-medium text-slate-700">
                النشاط التجاري
              </label>
              <input
                id="client-activity"
                value={formState.activity_type ?? ''}
                onChange={(e) => setFormState({...formState, activity_type: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ بيانات العميل'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {cloneSource && (
        <form onSubmit={handleCloneSubmit} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">نسخ سجل العميل: {cloneSource.name}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="clone-cl-code" className="block text-xs font-medium text-slate-700">
                كود العميل الجديد
              </label>
              <input
                id="clone-cl-code"
                required
                dir="ltr"
                value={cloneCode}
                onChange={(e) => setCloneCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="clone-cl-name" className="block text-xs font-medium text-slate-700">
                اسم العميل الجديد
              </label>
              <input
                id="clone-cl-name"
                required
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
              تأكيد النسخ
            </button>
            <button type="button" onClick={() => setCloneSource(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {tab === 'clients' ? (
        <>
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="بحث باسم العميل أو الكود أو الموبايل..."
            extraControls={
              <select
                aria-label="تصفية بالمحافظة"
                value={govFilter}
                onChange={(e) => setGovFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">كل المحافظات</option>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            }
          />
          <DataTable
            columns={clientColumns}
            rows={filteredClients}
            rowKey={(r) => r.id}
            loading={loading}
            emptyMessage="لا يوجد عملاء مسجلون حتى الآن. اضغط على «إنشاء عميل جديد» للبدء."
          />
        </>
      ) : (
        <div className="space-y-6">
          {isAdmin && (
            <form
              onSubmit={handleSaveRegSettings}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    إعدادات الموقع العام والتسجيل الذاتي للتجار
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    تحكم في إتاحة نموذج تسجيل المتاجر عبر صفحة الشركة العامة وسياسة الاعتماد التلقائي.
                  </p>
                </div>
                <Link
                  to={buildTenantBasePath(tenant.slug)}
                  className="text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                >
                  معاينة الموقع العام للشركة
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSelfReg}
                    onChange={(e) => setAllowSelfReg(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="block font-semibold text-slate-900">
                      تفعيل التسجيل الذاتي للتجار عبر الموقع العام
                    </span>
                    <span className="mt-0.5 block text-slate-500">
                      يظهر نموذج تسجيل المتاجر في صفحة الشركة العامة /c/{tenant.slug}
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoApproveClients}
                    onChange={(e) => setAutoApproveClients(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="block font-semibold text-slate-900">
                      الاعتماد التلقائي الفوري للتجار الجدد
                    </span>
                    <span className="mt-0.5 block text-slate-500">
                      إنشاء ملف العميل تلقائيًا بالقائمة الافتراضية دون انتظار مراجعة يدوية.
                    </span>
                  </span>
                </label>

                <div className="md:col-span-2">
                  <label htmlFor="pub-tagline" className="block text-xs font-medium text-slate-700">
                    الوصف التعريفي بالموقع العام للشركة
                  </label>
                  <input
                    id="pub-tagline"
                    type="text"
                    value={publicTagline}
                    onChange={(e) => setPublicTagline(e.target.value)}
                    placeholder="مثال: حلول شحن وتوصيل سريعة لجميع محافظات الجمهورية مع تحصيل فوري."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="pub-phone" className="block text-xs font-medium text-slate-700">
                    هاتف الدعم العام
                  </label>
                  <input
                    id="pub-phone"
                    type="text"
                    dir="ltr"
                    value={publicSupportPhone}
                    onChange={(e) => setPublicSupportPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="pub-email" className="block text-xs font-medium text-slate-700">
                    بريد الدعم العام
                  </label>
                  <input
                    id="pub-email"
                    type="email"
                    dir="ltr"
                    value={publicSupportEmail}
                    onChange={(e) => setPublicSupportEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={savingRegSettings}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingRegSettings ? 'جاري الحفظ...' : 'حفظ إعدادات الموقع العام'}
                </button>
              </div>
            </form>
          )}

          <DataTable
            columns={requestColumns}
            rows={requests}
            rowKey={(r) => r.id}
            loading={loading}
            emptyMessage="لا توجد طلبات تسجيل إلكترونية في قائمة الانتظار."
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="تأكيد أرشفة العميل"
        description={`هل تريد أرشفة العميل «${archiveTarget?.name ?? ''}»؟ ستبقى جميع شحناته وحساباته التاريخية محفوظة.`}
        confirmLabel="أرشفة العميل"
        onConfirm={() => void handleArchive()}
        onCancel={() => setArchiveTarget(null)}
      />

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">رفض طلب تسجيل: {rejectTarget.company_name}</h2>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="سبب الرفض (اختياري)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectTarget(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs">
                إلغاء
              </button>
              <button type="button" onClick={() => void handleRejectRequest()} className="rounded-lg bg-red-700 px-4 py-2 text-xs font-medium text-white">
                تأكيد الرفض
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}