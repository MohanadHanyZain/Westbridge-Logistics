import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {FilterBar} from '@/components/ui/FilterBar';
import {
  generateNextCode,
  listBranches,
  listChartOfAccounts,
  listShipmentTypes,
  listShippingServices,
  saveShippingService,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  BranchRecord,
  ChartOfAccountRecord,
  ShipmentTypeRecord,
  ShippingServiceRecord,
} from '@/types/definitions';
import {CheckCircle2, Edit3, Plus, XCircle} from 'lucide-react';

export function ServicesPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const [services, setServices] = useState<readonly ShippingServiceRecord[]>([]);
  const [shipmentTypes, setShipmentTypes] = useState<readonly ShipmentTypeRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [showForm, setShowForm] = useState(false);
  const [editingService, setEditingService] = useState<ShippingServiceRecord | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [daysMin, setDaysMin] = useState(1);
  const [daysMax, setDaysMax] = useState(3);
  const [branchId, setBranchId] = useState('');
  const [delRevAcctId, setDelRevAcctId] = useState('');
  const [colRevAcctId, setColRevAcctId] = useState('');
  const [commAcctId, setCommAcctId] = useState('');
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sData, tData, bData, aData] = await Promise.all([
        listShippingServices(tenant.id),
        listShipmentTypes(tenant.id),
        listBranches(tenant.id),
        listChartOfAccounts(tenant.id),
      ]);
      setServices(sData);
      setShipmentTypes(tData);
      setBranches(bData);
      setAccounts(aData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل خدمات الشحن.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const leafAccounts = useMemo(() => accounts.filter((a) => !a.is_group && a.is_active), [accounts]);
  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const typeMap = useMemo(() => new Map(shipmentTypes.map((t) => [t.id, t])), [shipmentTypes]);

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return services.filter((s) => {
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
    });
  }, [services, searchQuery, statusFilter]);

  const openCreateForm = () => {
    setEditingService(null);
    setCode(generateNextCode('SRV', services.map((s) => s.code)));
    setName('');
    setDaysMin(1);
    setDaysMax(3);
    setBranchId(branches.find((b) => b.is_main)?.id ?? branches[0]?.id ?? '');
    setDelRevAcctId(leafAccounts.find((a) => a.code === '4101')?.id ?? '');
    setColRevAcctId(leafAccounts.find((a) => a.code === '4102')?.id ?? '');
    setCommAcctId(leafAccounts.find((a) => a.code === '5101')?.id ?? '');
    setSelectedTypeIds(shipmentTypes.map((t) => t.id));
    setIsActive(true);
    setShowForm(true);
  };

  const openEditForm = (srv: ShippingServiceRecord) => {
    setEditingService(srv);
    setCode(srv.code);
    setName(srv.name);
    setDaysMin(srv.estimated_days_min);
    setDaysMax(srv.estimated_days_max);
    setBranchId(srv.branch_id ?? '');
    setDelRevAcctId(srv.delivery_revenue_account_id ?? '');
    setColRevAcctId(srv.collection_revenue_account_id ?? '');
    setCommAcctId(srv.courier_commission_account_id ?? '');
    setSelectedTypeIds([...srv.shipment_type_ids]);
    setIsActive(srv.is_active);
    setShowForm(true);
  };

  const toggleType = (id: string) => {
    setSelectedTypeIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveShippingService(tenant.id, {
        id: editingService?.id,
        code,
        name,
        estimated_days_min: daysMin,
        estimated_days_max: daysMax,
        branch_id: branchId || null,
        delivery_revenue_account_id: delRevAcctId || null,
        collection_revenue_account_id: colRevAcctId || null,
        courier_commission_account_id: commAcctId || null,
        is_active: isActive,
        shipment_type_ids: selectedTypeIds,
      });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ خدمة الشحن.');
    } finally {
      setSaving(false);
    }
  };

  const columns: readonly DataTableColumn<ShippingServiceRecord>[] = [
    {
      key: 'code',
      header: 'الكود',
      className: 'font-mono-tabular font-medium text-slate-900',
      render: (s) => s.code,
    },
    {
      key: 'name',
      header: 'اسم الخدمة',
      className: 'font-medium text-slate-900',
      render: (s) => s.name,
    },
    {
      key: 'days',
      header: 'أيام الشحن',
      className: 'font-mono-tabular text-xs text-slate-600',
      render: (s) =>
        s.estimated_days_min === s.estimated_days_max
          ? `${s.estimated_days_min} يوم`
          : `${s.estimated_days_min}–${s.estimated_days_max} أيام`,
    },
    {
      key: 'branch',
      header: 'الفرع',
      className: 'text-xs text-slate-600',
      render: (s) => (s.branch_id ? branchMap.get(s.branch_id) : null) ?? '—',
    },
    {
      key: 'types',
      header: 'أنواع الطلبات المدعومة',
      className: 'font-mono-tabular text-xs text-slate-700',
      render: (s) =>
        s.shipment_type_ids
          .map((id) => typeMap.get(id)?.code)
          .filter(Boolean)
          .join(' · ') || '—',
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (s) => (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            s.is_active ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          {s.is_active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {s.is_active ? 'فعال' : 'غير فعال'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (s) =>
        isAdmin ? (
          <button
            type="button"
            onClick={() => openEditForm(s)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
          >
            <Edit3 className="h-3.5 w-3.5" />
            تعديل
          </button>
        ) : (
          <span className="text-xs text-slate-400">عرض فقط</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <p className="text-xs font-medium text-slate-500">التعريفات الأساسية · خدمات الشحن</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">خدمات الشحن وأنواع الطلبات</h1>
      </div>

      {!showForm && <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="ابحث باسم أو كود الخدمة..."
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        primaryAction={
          isAdmin ? (
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة خدمة شحن
            </button>
          ) : null
        }
      />}

      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              {editingService ? `تعديل خدمة: ${editingService.name}` : 'إضافة خدمة شحن جديدة'}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              إلغاء
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="srv-name" className="block text-xs font-medium text-slate-700">اسم الخدمة</label>
              <input
                id="srv-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="srv-code" className="block text-xs font-medium text-slate-700">الكود</label>
              <input
                id="srv-code"
                type="text"
                required
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="srv-branch" className="block text-xs font-medium text-slate-700">الفرع</label>
              <select
                id="srv-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">كل الفروع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="srv-days-min" className="block text-xs font-medium text-slate-700">أقل مدة شحن (أيام)</label>
              <input
                id="srv-days-min"
                type="number"
                min={0}
                max={90}
                value={daysMin}
                onChange={(e) => setDaysMin(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="srv-days-max" className="block text-xs font-medium text-slate-700">أقصى مدة شحن (أيام)</label>
              <input
                id="srv-days-max"
                type="number"
                min={daysMin}
                max={120}
                value={daysMax}
                onChange={(e) => setDaysMax(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="srv-active" className="block text-xs font-medium text-slate-700">الحالة</label>
              <select
                id="srv-active"
                value={isActive ? '1' : '0'}
                onChange={(e) => setIsActive(e.target.value === '1')}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="1">فعال</option>
                <option value="0">غير فعال</option>
              </select>
            </div>

            <div>
              <label htmlFor="srv-del-acct" className="block text-xs font-medium text-slate-700">
                حساب إيرادات التوصيل
              </label>
              <select
                id="srv-del-acct"
                value={delRevAcctId}
                onChange={(e) => setDelRevAcctId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">اختر الحساب...</option>
                {leafAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="srv-col-acct" className="block text-xs font-medium text-slate-700">
                حساب إيرادات التحصيل
              </label>
              <select
                id="srv-col-acct"
                value={colRevAcctId}
                onChange={(e) => setColRevAcctId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">اختر الحساب...</option>
                {leafAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="srv-comm-acct" className="block text-xs font-medium text-slate-700">
                حساب عمولات المندوبين
              </label>
              <select
                id="srv-comm-acct"
                value={commAcctId}
                onChange={(e) => setCommAcctId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">اختر الحساب...</option>
                {leafAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <p className="text-xs font-medium text-slate-700">أنواع الطلبات المسموح بها</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {shipmentTypes.map((st) => {
                  const checked = selectedTypeIds.includes(st.id);
                  return (
                    <label
                      key={st.id}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-xs transition-colors ${
                        checked ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleType(st.id)}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900"
                      />
                      <span>
                        <strong className="font-mono-tabular">{st.code}</strong> · {st.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 md:col-span-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white disabled:opacity-60"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ الخدمة'}
              </button>
            </div>
          </form>
        </section>
      )}

      {!showForm && <DataTable
        columns={columns}
        rows={filteredServices}
        rowKey={(s) => s.id}
        loading={loading}
        error={error}
        emptyMessage="لا توجد خدمات شحن مطابقة."
      />}
    </div>
  );
}
