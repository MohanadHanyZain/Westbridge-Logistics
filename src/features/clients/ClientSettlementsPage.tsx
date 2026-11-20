import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {FilterBar} from '@/components/ui/FilterBar';
import {buildTenantBasePath} from '@/config/brand';
import {listClients} from '@/features/clients/clientsService';
import {listBranches} from '@/features/definitions/definitionsService';
import {
  approveClientSettlement,
  createClientSettlement,
  getCashboxesWithBalances,
  getClientsSettlementOverview,
  getTenantFinancePolicy,
  listClientSettlements,
  listClientUnsettledShipments,
} from '@/features/finance/financeService';
import {listTaxProfiles} from '@/features/pricing/pricingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatCurrency, formatDateTime} from '@/lib/formatters';
import type {BranchRecord} from '@/types/definitions';
import {
  FINANCE_DOC_STATUS_LABELS,
  type CashboxBalanceRecord,
  type ClientSettlementOverviewRecord,
  type ClientSettlementRecord,
  type ClientUnsettledShipmentItem,
  type TenantFinancePolicyRecord,
} from '@/types/finance';
import type {ClientRecord, PayoutMethod, TaxProfileRecord} from '@/types/pricing';
import {CheckCircle2, ExternalLink, FileSpreadsheet, Printer, X} from 'lucide-react';

const PAYOUT_LABELS: Record<PayoutMethod, string> = {
  cash: 'نقدي (من الخزينة)',
  bank_transfer: 'تحويل بنكي',
  vodafone_cash: 'فودافون كاش',
};

const DIRECTION_LABELS: Record<ClientSettlementRecord['cash_direction'], string> = {
  payout_to_client: 'صرف مستحقات للتاجر',
  receipt_from_client: 'تحصيل مستحق من التاجر',
  zero_balance: 'مقاصة صفرية',
};

export function ClientSettlementsPage() {
  const {user} = useAuth();
  const {tenant, membership, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [taxProfiles, setTaxProfiles] = useState<readonly TaxProfileRecord[]>([]);
  const [overview, setOverview] = useState<readonly ClientSettlementOverviewRecord[]>([]);
  const [settlements, setSettlements] = useState<readonly ClientSettlementRecord[]>([]);
  const [cashboxes, setCashboxes] = useState<readonly CashboxBalanceRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [policy, setPolicy] = useState<TenantFinancePolicyRecord>({
    tenant_id: tenant.id,
    enforce_four_eyes: true,
    allow_owner_self_approve: true,
    high_value_approval_threshold: 0,
  });

  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [unsettledShipments, setUnsettledShipments] = useState<readonly ClientUnsettledShipmentItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [includeUncollectedCod, setIncludeUncollectedCod] = useState(false);

  const [branchId, setBranchId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('cash');
  const [payoutReference, setPayoutReference] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('0');
  const [notes, setNotes] = useState('');

  const [printSettlement, setPrintSettlement] = useState<ClientSettlementRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const isAdmin = membership.role_key === 'company_owner' || membership.role_key === 'company_admin';
  const canCreate = can('finance.settlements.create') || can('finance.payouts.approve') || isAdmin;
  const canApprove = can('finance.payouts.approve') || isAdmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRows, tRows, ovRows, cstRows, boxRows, brRows, pol] = await Promise.all([
        listClients(tenant.id),
        listTaxProfiles(tenant.id),
        getClientsSettlementOverview(tenant.id).catch(() => [] as ClientSettlementOverviewRecord[]),
        listClientSettlements(tenant.id).catch(() => [] as ClientSettlementRecord[]),
        getCashboxesWithBalances(tenant.id).catch(() => [] as CashboxBalanceRecord[]),
        listBranches(tenant.id).catch(() => [] as BranchRecord[]),
        getTenantFinancePolicy(tenant.id).catch(() => ({
          tenant_id: tenant.id,
          enforce_four_eyes: true,
          allow_owner_self_approve: true,
          high_value_approval_threshold: 0,
        })),
      ]);
      setClients(cRows);
      setTaxProfiles(tRows);
      setOverview(ovRows);
      setSettlements(cstRows);
      setCashboxes(boxRows);
      setBranches(brRows);
      setPolicy(pol);

      if (!branchId && brRows[0]) setBranchId(brRows[0].id);
      if (!cashboxId && boxRows[0]) setCashboxId(boxRows[0].id);
      if (!selectedClientId) {
        const ready = ovRows.find((o) => o.unsettled_shipments_count > 0) ?? ovRows[0];
        if (ready) {
          setSelectedClientId(ready.client_id);
          setPayoutMethod(ready.payout_method);
        } else if (cRows[0]) {
          setSelectedClientId(cRows[0].id);
          setPayoutMethod(cRows[0].payout_method);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل بيانات تسويات العملاء.',
      });
    } finally {
      setLoading(false);
    }
  }, [tenant.id, branchId, cashboxId, selectedClientId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadClientShipments = useCallback(async () => {
    if (!selectedClientId) {
      setUnsettledShipments([]);
      setSelectedIds(new Set());
      return;
    }
    setLoadingShipments(true);
    try {
      const rows = await listClientUnsettledShipments(tenant.id, selectedClientId);
      setUnsettledShipments(rows);
      const defaultSelected = new Set(rows.filter((r) => !r.awaiting_courier_cash).map((r) => r.shipment_id));
      setSelectedIds(defaultSelected);
    } catch {
      setUnsettledShipments([]);
      setSelectedIds(new Set());
    } finally {
      setLoadingShipments(false);
    }
  }, [tenant.id, selectedClientId]);

  useEffect(() => {
    void loadClientShipments();
  }, [loadClientShipments]);

  const taxMap = useMemo(() => new Map(taxProfiles.map((t) => [t.id, t])), [taxProfiles]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const overviewMap = useMemo(() => new Map(overview.map((o) => [o.client_id, o])), [overview]);
  const cashboxMap = useMemo(() => new Map(cashboxes.map((b) => [b.id, `${b.code} — ${b.name}`])), [cashboxes]);

  const mergedRows = useMemo(() => {
    const baseList: readonly ClientSettlementOverviewRecord[] =
      overview.length > 0
        ? overview
        : clients.map((c) => ({
            client_id: c.id,
            code: c.code,
            name: c.name,
            mobile: c.mobile,
            branch_id: c.branch_id,
            payout_method: c.payout_method,
            bank_name: c.bank_name,
            bank_account_number: c.bank_account_number,
            wallet_phone: c.wallet_phone,
            default_price_mode: c.default_price_mode,
            unsettled_shipments_count: 0,
            awaiting_courier_collection_count: 0,
            gross_cod_amount: 0,
            shipping_fees_deductible: 0,
            return_fees_deductible: 0,
            ready_net_balance: 0,
          }));

    const q = search.trim().toLowerCase();
    if (!q) return baseList;
    return baseList.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.mobile.toLowerCase().includes(q),
    );
  }, [overview, clients, search]);

  const selectedOverview = selectedClientId ? overviewMap.get(selectedClientId) : undefined;
  const selectedClientRecord = selectedClientId ? clientMap.get(selectedClientId) : undefined;

  const handleSelectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    const ov = overviewMap.get(clientId);
    const cl = clientMap.get(clientId);
    if (ov) setPayoutMethod(ov.payout_method);
    else if (cl) setPayoutMethod(cl.payout_method);
    setIncludeUncollectedCod(false);
    setAdjustmentAmount('0');
    setPayoutReference('');
  };

  const toggleShipment = (item: ClientUnsettledShipmentItem) => {
    if (item.awaiting_courier_cash && !includeUncollectedCod) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.shipment_id)) next.delete(item.shipment_id);
      else next.add(item.shipment_id);
      return next;
    });
  };

  const handleToggleIncludeUncollected = (checked: boolean) => {
    setIncludeUncollectedCod(checked);
    if (!checked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of unsettledShipments) {
          if (item.awaiting_courier_cash) next.delete(item.shipment_id);
        }
        return next;
      });
    }
  };

  const selectionSummary = useMemo(() => {
    const selected = unsettledShipments.filter((s) => selectedIds.has(s.shipment_id));
    const grossCod = selected.reduce((sum, s) => sum + Number(s.cod_collected_amount || 0), 0);
    const shippingFees = selected.reduce((sum, s) => sum + Number(s.shipping_fee_deducted || 0), 0);
    const returnFees = selected.reduce((sum, s) => sum + Number(s.return_fee_deducted || 0), 0);
    const adj = Number(adjustmentAmount || 0);
    const net = grossCod - shippingFees - returnFees + (Number.isFinite(adj) ? adj : 0);
    return {count: selected.length, grossCod, shippingFees, returnFees, adj: Number.isFinite(adj) ? adj : 0, net};
  }, [unsettledShipments, selectedIds, adjustmentAmount]);

  const handleCreateSettlement = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || selectedIds.size === 0) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await createClientSettlement(tenant.id, {
        client_id: selectedClientId,
        branch_id: branchId || selectedClientRecord?.branch_id || branches[0]?.id || '',
        cashbox_id: cashboxId || null,
        payout_method: payoutMethod,
        payout_reference: payoutReference.trim() || undefined,
        adjustment_amount: Number(adjustmentAmount || 0),
        include_uncollected_cod: includeUncollectedCod,
        shipment_ids: Array.from(selectedIds),
        notes: notes.trim() || undefined,
      });
      setNotes('');
      setAdjustmentAmount('0');
      setPayoutReference('');
      setFeedback({
        type: 'success',
        text: `تم إنشاء كشف تسوية العميل ${res.settlement_code} بصافي ${formatCurrency(res.net_payable_amount, tenant.default_currency)} وبانتظار الاعتماد.`,
      });
      await Promise.all([loadData(), loadClientShipments()]);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء كشف تسوية العميل.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveSettlement = async (settlementId: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await approveClientSettlement(tenant.id, settlementId);
      setFeedback({
        type: 'success',
        text: 'تم اعتماد كشف التسوية وتقييد الحركة في الخزينة وتحديث حالة الشحنات.',
      });
      await Promise.all([loadData(), loadClientShipments()]);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد كشف التسوية.'});
    } finally {
      setSubmitting(false);
    }
  };

  const isFourEyesBlocked = (createdBy: string | null) => {
    if (!policy.enforce_four_eyes || !createdBy || createdBy !== user?.id) return false;
    if (membership.role_key === 'company_owner' && policy.allow_owner_self_approve) return false;
    return true;
  };

  const totalReadyNet = useMemo(
    () => overview.reduce((sum, o) => sum + Number(o.ready_net_balance || 0), 0),
    [overview],
  );
  const totalUnsettledCount = useMemo(
    () => overview.reduce((sum, o) => sum + Number(o.unsettled_shipments_count || 0), 0),
    [overview],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قيد التسوية مع العملاء</h1>
          <p className="mt-1 text-xs text-slate-500">
            كشوف تسوية مستحقات التجار (CST) من شحنات COD وخصم مصاريف الشحن والمرتجعات (ADR-016) والربط المباشر بالخزائن.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2">
            <span className="text-slate-500">شحنات جاهزة للتسوية: </span>
            <strong className="font-mono-tabular text-slate-900">{totalUnsettledCount}</strong>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2">
            <span className="text-slate-500">صافي المستحق الجاهز: </span>
            <strong className="font-mono-tabular text-emerald-700">
              {formatCurrency(totalReadyNet, tenant.default_currency)}
            </strong>
          </div>
          <Link
            to={`${basePath}/finance/collections`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 hover:bg-slate-50"
          >
            التحصيل من المناديب
          </Link>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-2.5 text-xs ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم العميل أو الكود أو الموبايل..."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Clients Balances List */}
        <div className="space-y-3 lg:col-span-5">
          <h2 className="text-sm font-semibold text-slate-900">أرصدة العملاء قيد التسوية</h2>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {loading ? (
              <p className="p-4 text-xs text-slate-500">جارٍ تحميل ملفات تسوية العملاء...</p>
            ) : mergedRows.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">لا يوجد عملاء مسجلون بعد.</p>
            ) : (
              mergedRows.map((row) => {
                const isSelected = row.client_id === selectedClientId;
                const cl = clientMap.get(row.client_id);
                const tax = cl ? taxMap.get(cl.tax_profile_id) : undefined;
                return (
                  <button
                    key={row.client_id}
                    type="button"
                    onClick={() => handleSelectClient(row.client_id)}
                    className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-right transition-colors ${
                      isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold">
                        <span className="font-mono-tabular opacity-75">{row.code}</span> · {row.name}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {PAYOUT_LABELS[row.payout_method]} ·{' '}
                        {row.default_price_mode === 'shipping_included' ? 'شامل الشحن' : 'غير شامل الشحن'}
                        {tax ? ` · ${tax.name}` : ''}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {row.unsettled_shipments_count} شحنة للتسوية
                        {row.awaiting_courier_collection_count > 0
                          ? ` (${row.awaiting_courier_collection_count} بانتظار توريد المندوب)`
                          : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      <p
                        className={`font-mono-tabular text-xs font-bold ${
                          isSelected
                            ? row.ready_net_balance >= 0
                              ? 'text-emerald-300'
                              : 'text-amber-300'
                            : row.ready_net_balance >= 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                        }`}
                      >
                        {formatCurrency(row.ready_net_balance, tenant.default_currency)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Client Settlement Workbench */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileSpreadsheet className="h-4 w-4 text-slate-600" />
                إعداد كشف تسوية العميل{' '}
                {selectedOverview?.name ?? selectedClientRecord?.name ?? ''}
              </h2>
              {selectedClientId && (
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span>وسيلة السداد: {PAYOUT_LABELS[payoutMethod]}</span>
                  {(selectedOverview?.bank_account_number ?? selectedClientRecord?.bank_account_number) && (
                    <span className="font-mono-tabular">
                      حساب: {selectedOverview?.bank_name ?? selectedClientRecord?.bank_name} ·{' '}
                      {selectedOverview?.bank_account_number ?? selectedClientRecord?.bank_account_number}
                    </span>
                  )}
                  {(selectedOverview?.wallet_phone ?? selectedClientRecord?.wallet_phone) && (
                    <span className="font-mono-tabular">
                      محفظة: {selectedOverview?.wallet_phone ?? selectedClientRecord?.wallet_phone}
                    </span>
                  )}
                  <Link
                    to={`${basePath}/clients/${selectedClientId}`}
                    className="inline-flex items-center gap-1 font-medium text-slate-700 underline hover:text-slate-900"
                  >
                    <ExternalLink className="h-3 w-3" />
                    ملف العميل والشروط
                  </Link>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={includeUncollectedCod}
                onChange={(e) => handleToggleIncludeUncollected(e.target.checked)}
              />
              <span>تضمين شحنات COD بانتظار توريد المندوب</span>
            </label>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-right">تحديد</th>
                  <th className="px-3 py-2 text-right">الشحنة</th>
                  <th className="px-3 py-2 text-right">الدفع والحالة</th>
                  <th className="px-3 py-2 text-right">تحصيل COD</th>
                  <th className="px-3 py-2 text-right">رسوم شحن/مرتجع</th>
                  <th className="px-3 py-2 text-right">صافي للتاجر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingShipments ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                      جارٍ فحص شحنات العميل...
                    </td>
                  </tr>
                ) : unsettledShipments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                      لا توجد شحنات مستحقة للتسوية لهذا العميل حاليًا.
                    </td>
                  </tr>
                ) : (
                  unsettledShipments.map((s) => {
                    const locked = s.awaiting_courier_cash && !includeUncollectedCod;
                    const feesDeducted = Number(s.shipping_fee_deducted || 0) + Number(s.return_fee_deducted || 0);
                    return (
                      <tr key={s.shipment_id} className={locked ? 'bg-amber-50/50 text-slate-500' : ''}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={selectedIds.has(s.shipment_id)}
                            onChange={() => toggleShipment(s)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono-tabular font-semibold text-slate-900">{s.shipment_number}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono-tabular text-[11px]">{s.payment_term_code}</span> ·{' '}
                          <span className="text-[11px]">{s.operational_status}</span>
                          {s.awaiting_courier_cash && (
                            <span className="block text-[10px] font-medium text-amber-700">بانتظار توريد المندوب</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono-tabular text-emerald-700">
                          {formatCurrency(s.cod_collected_amount, tenant.default_currency)}
                        </td>
                        <td className="px-3 py-2 font-mono-tabular text-red-700">
                          -{formatCurrency(feesDeducted, tenant.default_currency)}
                          {s.return_fee_deducted > 0 && (
                            <span className="block text-[10px] text-slate-500">رسوم مرتجع (ADR-016)</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono-tabular font-bold text-slate-900">
                          {formatCurrency(s.net_client_amount, tenant.default_currency)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Calculation Bar */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4">
            <div>
              <span className="block text-[11px] text-slate-500">COD المحصل ({selectionSummary.count})</span>
              <strong className="font-mono-tabular text-slate-900">
                {formatCurrency(selectionSummary.grossCod, tenant.default_currency)}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] text-slate-500">خصم الشحن</span>
              <strong className="font-mono-tabular text-red-700">
                -{formatCurrency(selectionSummary.shippingFees, tenant.default_currency)}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] text-slate-500">خصم المرتجعات</span>
              <strong className="font-mono-tabular text-red-700">
                -{formatCurrency(selectionSummary.returnFees, tenant.default_currency)}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] text-slate-500">
                {selectionSummary.net > 0
                  ? 'صافي صرف للتاجر'
                  : selectionSummary.net < 0
                    ? 'صافي تحصيل من التاجر'
                    : 'رصيد متوازن'}
              </span>
              <strong
                className={`font-mono-tabular text-sm ${
                  selectionSummary.net >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatCurrency(Math.abs(selectionSummary.net), tenant.default_currency)}
              </strong>
            </div>
          </div>

          {canCreate && (
            <form onSubmit={handleCreateSettlement} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="cst-branch" className="block text-xs font-medium text-slate-700">
                  الفرع
                </label>
                <select
                  id="cst-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cst-cashbox" className="block text-xs font-medium text-slate-700">
                  الخزينة / الحساب المالي
                </label>
                <select
                  id="cst-cashbox"
                  value={cashboxId}
                  onChange={(e) => setCashboxId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  <option value="">بدون حركة خزينة</option>
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.code} — {cb.name} ({formatCurrency(cb.current_balance, tenant.default_currency)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cst-method" className="block text-xs font-medium text-slate-700">
                  وسيلة التسوية
                </label>
                <select
                  id="cst-method"
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value as PayoutMethod)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  <option value="cash">نقدي (من الخزينة)</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="vodafone_cash">فودافون كاش</option>
                </select>
              </div>
              <div>
                <label htmlFor="cst-adj" className="block text-xs font-medium text-slate-700">
                  تعديل إضافي (+/-)
                </label>
                <input
                  id="cst-adj"
                  type="number"
                  step="0.01"
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="cst-ref" className="block text-xs font-medium text-slate-700">
                  مرجع التحويل / الإيصال
                </label>
                <input
                  id="cst-ref"
                  type="text"
                  value={payoutReference}
                  onChange={(e) => setPayoutReference(e.target.value)}
                  placeholder="اختياري للتحويل البنكي أو المحفظة"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="cst-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات الكشف
                </label>
                <input
                  id="cst-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={submitting || selectedIds.size === 0 || !branchId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  إنشاء كشف تسوية عميل (CST)
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Settlement Vouchers History */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">سجل كشوف تسويات العملاء (CST)</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 text-right font-semibold">رقم الكشف</th>
                <th className="px-3 py-3 text-right font-semibold">العميل</th>
                <th className="px-3 py-3 text-right font-semibold">وسيلة السداد</th>
                <th className="px-3 py-3 text-right font-semibold">إجمالي COD</th>
                <th className="px-3 py-3 text-right font-semibold">الخصومات</th>
                <th className="px-3 py-3 text-right font-semibold">الصافي</th>
                <th className="px-3 py-3 text-right font-semibold">الحالة</th>
                <th className="px-3 py-3 text-right font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {settlements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    لا توجد كشوف تسوية عملاء مسجلة بعد.
                  </td>
                </tr>
              ) : (
                settlements.map((st) => {
                  const blocked = isFourEyesBlocked(st.created_by);
                  const totalDeducted = Number(st.shipping_fees_deducted || 0) + Number(st.return_fees_deducted || 0);
                  return (
                    <tr key={st.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono-tabular font-semibold text-slate-900">{st.settlement_code}</td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        {clientMap.get(st.client_id)?.name ?? st.client_id}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {PAYOUT_LABELS[st.payout_method]}
                        {st.payout_reference ? (
                          <span className="block font-mono-tabular text-[10px] text-slate-400">{st.payout_reference}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular">
                        {formatCurrency(st.gross_cod_collected, tenant.default_currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular text-red-700">
                        -{formatCurrency(totalDeducted, tenant.default_currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900">
                        {formatCurrency(st.net_payable_amount, tenant.default_currency)}
                        <span className="block text-[10px] font-normal text-slate-500">
                          {DIRECTION_LABELS[st.cash_direction]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{FINANCE_DOC_STATUS_LABELS[st.status]}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {st.status === 'draft' && canApprove ? (
                            blocked ? (
                              <span className="text-[11px] text-amber-700">بانتظار مراجع آخر (ADR-018)</span>
                            ) : (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleApproveSettlement(st.id)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                اعتماد وصرف
                              </button>
                            )
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setPrintSettlement(st)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Printer className="h-3 w-3" />
                            طباعة الكشف
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable Statement Modal (In-App, no window.open) */}
      {printSettlement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`كشف تسوية ${printSettlement.settlement_code}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  كشف تسوية عميل — {printSettlement.settlement_code}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {tenant.name} · {formatDateTime(printSettlement.created_at)}
                </p>
              </div>
              <button
                type="button"
                aria-label="إغلاق نافذة الكشف"
                onClick={() => setPrintSettlement(null)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <dl className="mt-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">العميل</dt>
                <dd className="font-semibold text-slate-900">
                  {clientMap.get(printSettlement.client_id)?.name ?? printSettlement.client_id}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الخزينة</dt>
                <dd className="text-slate-800">
                  {printSettlement.cashbox_id
                    ? cashboxMap.get(printSettlement.cashbox_id) ?? printSettlement.cashbox_id
                    : 'بدون خزينة'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">إجمالي COD المحصل</dt>
                <dd className="font-mono-tabular font-semibold text-slate-900">
                  {formatCurrency(printSettlement.gross_cod_collected, tenant.default_currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">خصم مصاريف الشحن</dt>
                <dd className="font-mono-tabular text-red-700">
                  -{formatCurrency(printSettlement.shipping_fees_deducted, tenant.default_currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">خصم رسوم المرتجعات (ADR-016)</dt>
                <dd className="font-mono-tabular text-red-700">
                  -{formatCurrency(printSettlement.return_fees_deducted, tenant.default_currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">تعديل إضافي</dt>
                <dd className="font-mono-tabular text-slate-900">
                  {formatCurrency(printSettlement.adjustment_amount, tenant.default_currency)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2.5 text-sm font-bold">
                <dt className="text-slate-900">{DIRECTION_LABELS[printSettlement.cash_direction]}</dt>
                <dd className="font-mono-tabular text-emerald-700">
                  {formatCurrency(printSettlement.net_payable_amount, tenant.default_currency)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Printer className="h-3.5 w-3.5" />
                طباعة
              </button>
              <button
                type="button"
                onClick={() => setPrintSettlement(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
