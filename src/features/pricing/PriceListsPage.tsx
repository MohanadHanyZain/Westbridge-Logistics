import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {buildTenantBasePath} from '@/config/brand';
import {generateNextCode} from '@/features/definitions/definitionsService';
import {
  clonePriceList,
  createClientPriceList,
  listClientPriceLists,
} from '@/features/pricing/pricingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {ClientPriceListRecord, WeightRoundingRule} from '@/types/pricing';
import {Calculator, Copy, ExternalLink, Plus, Shield} from 'lucide-react';

export function PriceListsPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [lists, setLists] = useState<readonly ClientPriceListRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [volDivisor, setVolDivisor] = useState(5000);
  const [roundingRule, setRoundingRule] = useState<WeightRoundingRule>('ceil_1kg');
  const [saving, setSaving] = useState(false);

  const [cloneSource, setCloneSource] = useState<ClientPriceListRecord | null>(null);
  const [cloneCode, setCloneCode] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneDesc, setCloneDesc] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listClientPriceLists(tenant.id);
      setLists(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قوائم الأسعار.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createClientPriceList(tenant.id, {
        code,
        name,
        description,
        volumetric_divisor: volDivisor,
        weight_rounding_rule: roundingRule,
      });
      setShowCreate(false);
      setName('');
      setDescription('');
      setFeedback('تم إنشاء قائمة الأسعار وإصدارها الأول بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء قائمة الأسعار.');
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async (e: FormEvent) => {
    e.preventDefault();
    if (!cloneSource) return;
    setSaving(true);
    setError(null);
    try {
      await clonePriceList(tenant.id, cloneSource.id, cloneCode, cloneName, cloneDesc || null);
      setCloneSource(null);
      setFeedback('تم نسخ قائمة الأسعار بالكامل (الإصدار + قواعد الالتقاط + قواعد التسليم) بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر نسخ قائمة الأسعار.');
    } finally {
      setSaving(false);
    }
  };

  const columns: readonly DataTableColumn<ClientPriceListRecord>[] = [
    {
      key: 'code',
      header: 'الكود',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold text-slate-900">
          {r.code}
          {r.is_system_default && <Shield className="h-3.5 w-3.5 text-slate-500" aria-label="قائمة افتراضية محمية" />}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'اسم القائمة',
      render: (r) => (
        <div>
          <Link to={`${basePath}/pricing/price-lists/${r.id}`} className="font-medium text-slate-900 hover:underline">
            {r.name}
          </Link>
          {r.description && <p className="text-xs text-slate-500">{r.description}</p>}
        </div>
      ),
    },
    {
      key: 'protection',
      header: 'النوع',
      render: (r) => (
        <span className="text-xs text-slate-600">
          {r.is_system_default ? 'افتراضية محمية (غير قابلة للحذف)' : 'قائمة مخصصة'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span className={`text-xs font-medium ${r.is_active ? 'text-emerald-700' : 'text-slate-500'}`}>
          {r.is_active ? 'فعالة' : 'موقوفة'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Link
            to={`${basePath}/pricing/price-lists/${r.id}`}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-3 w-3" />
            مصفوفة الأسعار
          </Link>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setCloneSource(r);
                setCloneCode(generateNextCode('PL', lists.map((l) => l.code)));
                setCloneName(`${r.name} — نسخة`);
                setCloneDesc(r.description ?? '');
              }}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-3 w-3" />
              نسخ القائمة
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قوائم أسعار الشحن</h1>
          <p className="mt-1 text-xs text-slate-500">
            إدارة قوائم الأسعار، معامل الوزن الحجمي (5000 افتراضيًا)، ونسخ القوائم بكامل مسارات الالتقاط والتسليم.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`${basePath}/pricing/calculator`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Calculator className="h-4 w-4" />
            حاسبة ومعاينة السعر
          </Link>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setCode(generateNextCode('PL', lists.map((l) => l.code)));
                setShowCreate(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              إضافة قائمة أسعار
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

      {showCreate && (
        <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-900">إنشاء قائمة أسعار جديدة</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="pl-code" className="block text-xs font-medium text-slate-700">
                كود القائمة
              </label>
              <input
                id="pl-code"
                required
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="pl-name" className="block text-xs font-medium text-slate-700">
                اسم القائمة
              </label>
              <input
                id="pl-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="pl-divisor" className="block text-xs font-medium text-slate-700">
                معامل الوزن الحجمي
              </label>
              <input
                id="pl-divisor"
                type="number"
                min={100}
                value={volDivisor}
                onChange={(e) => setVolDivisor(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="pl-rounding" className="block text-xs font-medium text-slate-700">
                قاعدة تقريب الوزن
              </label>
              <select
                id="pl-rounding"
                value={roundingRule}
                onChange={(e) => setRoundingRule(e.target.value as WeightRoundingRule)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="ceil_1kg">أقرب 1 كجم للأعلى (CEIL)</option>
                <option value="ceil_half_kg">أقرب 0.5 كجم للأعلى</option>
                <option value="exact">دقيق دون تقريب</option>
              </select>
            </div>
            <div className="sm:col-span-4">
              <label htmlFor="pl-desc" className="block text-xs font-medium text-slate-700">
                الوصف
              </label>
              <input
                id="pl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white">
              {saving ? 'جاري الإنشاء...' : 'حفظ القائمة'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {cloneSource && (
        <form onSubmit={handleClone} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-900">
            نسخ قائمة الأسعار: {cloneSource.code} — {cloneSource.name}
          </h2>
          <p className="text-xs text-slate-500">
            سيتم نسخ جميع قواعد الالتقاط وقواعد التسليم المرتبطة بها والرسوم الإضافية ذريًا داخل إصدار جديد مستقل.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="clone-pl-code" className="block text-xs font-medium text-slate-700">
                الكود الجديد
              </label>
              <input
                id="clone-pl-code"
                required
                dir="ltr"
                value={cloneCode}
                onChange={(e) => setCloneCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="clone-pl-name" className="block text-xs font-medium text-slate-700">
                اسم القائمة الجديدة
              </label>
              <input
                id="clone-pl-name"
                required
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="clone-pl-desc" className="block text-xs font-medium text-slate-700">
                الوصف
              </label>
              <input
                id="clone-pl-desc"
                value={cloneDesc}
                onChange={(e) => setCloneDesc(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white">
              {saving ? 'جاري النسخ...' : 'تنفيذ النسخ الكامل'}
            </button>
            <button type="button" onClick={() => setCloneSource(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs">
              إلغاء
            </button>
          </div>
        </form>
      )}

      <DataTable
        columns={columns}
        rows={lists}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage="لا توجد قوائم أسعار."
      />
    </div>
  );
}
