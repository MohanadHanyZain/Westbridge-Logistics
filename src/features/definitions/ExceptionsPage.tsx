import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {FilterBar} from '@/components/ui/FilterBar';
import {
  generateNextCode,
  listExceptionReasons,
  saveExceptionReason,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {DeliveryExceptionReasonRecord, ExceptionCategory} from '@/types/definitions';
import {CheckCircle2, Edit3, Plus, XCircle} from 'lucide-react';

const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  delivery_failed: 'تعذر تسليم',
  refused: 'رفض استلام',
  return: 'إرجاع للراسل',
  cancellation: 'إلغاء',
  exception: 'استثناء تشغيلي',
};

export function ExceptionsPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const [reasons, setReasons] = useState<readonly DeliveryExceptionReasonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExceptionCategory>('all');

  const [showForm, setShowForm] = useState(false);
  const [editingReason, setEditingReason] = useState<DeliveryExceptionReasonRecord | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ExceptionCategory>('delivery_failed');
  const [requiresNote, setRequiresNote] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReasons(await listExceptionReasons(tenant.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل أسباب التعذر والإرجاع.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredReasons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reasons.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false;
      if (statusFilter === 'inactive' && r.is_active) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
    });
  }, [reasons, searchQuery, statusFilter, categoryFilter]);

  const openCreateForm = () => {
    setEditingReason(null);
    setCode(generateNextCode('RSN', reasons.map((r) => r.code)));
    setName('');
    setCategory('delivery_failed');
    setRequiresNote(false);
    setIsActive(true);
    setShowForm(true);
  };

  const openEditForm = (reason: DeliveryExceptionReasonRecord) => {
    setEditingReason(reason);
    setCode(reason.code);
    setName(reason.name);
    setCategory(reason.category);
    setRequiresNote(reason.requires_note);
    setIsActive(reason.is_active);
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveExceptionReason(tenant.id, {
        id: editingReason?.id,
        code,
        name,
        category,
        requires_note: requiresNote,
        is_active: isActive,
      });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ السبب.');
    } finally {
      setSaving(false);
    }
  };

  const columns: readonly DataTableColumn<DeliveryExceptionReasonRecord>[] = [
    {
      key: 'code',
      header: 'الكود',
      className: 'font-mono-tabular font-medium text-slate-900',
      render: (r) => r.code,
    },
    {
      key: 'name',
      header: 'السبب',
      className: 'font-medium text-slate-900',
      render: (r) => r.name,
    },
    {
      key: 'category',
      header: 'النوع',
      className: 'text-xs text-slate-700',
      render: (r) => CATEGORY_LABELS[r.category],
    },
    {
      key: 'note',
      header: 'ملاحظة إلزامية',
      className: 'text-xs text-slate-600',
      render: (r) => (r.requires_note ? 'نعم' : 'اختيارية'),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            r.is_active ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          {r.is_active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {r.is_active ? 'فعال' : 'غير فعال'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) =>
        isAdmin ? (
          <button
            type="button"
            onClick={() => openEditForm(r)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
          >
            <Edit3 className="h-3.5 w-3.5" />
            تعديل
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <p className="text-xs font-medium text-slate-500">التعريفات الأساسية · أسباب التعذر والرفض</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">أسباب الإلغاء والتعذر والرفض والإرجاع</h1>
      </div>

      {!showForm && <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="ابحث بالكود أو نص السبب..."
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        extraControls={
          <select
            aria-label="تصفية حسب النوع"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | ExceptionCategory)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
          >
            <option value="all">كل الأنواع</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        }
        primaryAction={
          isAdmin ? (
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة سبب جديد
            </button>
          ) : null
        }
      />}

      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            {editingReason ? `تعديل السبب: ${editingReason.code}` : 'إضافة سبب جديد'}
          </h2>
          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label htmlFor="rsn-code" className="block text-xs font-medium text-slate-700">الكود</label>
              <input
                id="rsn-code"
                type="text"
                required
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="rsn-name" className="block text-xs font-medium text-slate-700">نص السبب</label>
              <input
                id="rsn-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="rsn-cat" className="block text-xs font-medium text-slate-700">التصنيف</label>
              <select
                id="rsn-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExceptionCategory)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rsn-note" className="block text-xs font-medium text-slate-700">إلزام المندوب بملاحظة؟</label>
              <select
                id="rsn-note"
                value={requiresNote ? '1' : '0'}
                onChange={(e) => setRequiresNote(e.target.value === '1')}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="0">اختيارية</option>
                <option value="1">مطلوبة</option>
              </select>
            </div>
            <div>
              <label htmlFor="rsn-active" className="block text-xs font-medium text-slate-700">الحالة</label>
              <select
                id="rsn-active"
                value={isActive ? '1' : '0'}
                onChange={(e) => setIsActive(e.target.value === '1')}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="1">فعال</option>
                <option value="0">غير فعال</option>
              </select>
            </div>
            <div className="flex items-end justify-end gap-2 md:col-span-2">
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
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white"
              >
                حفظ السبب
              </button>
            </div>
          </form>
        </section>
      )}

      {!showForm && <DataTable
        columns={columns}
        rows={filteredReasons}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        emptyMessage="لا توجد أسباب مطابقة."
      />}
    </div>
  );
}
