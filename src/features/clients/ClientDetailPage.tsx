import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Link, useParams} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {
  deleteClientAddress,
  deletePriceExemption,
  getClientById,
  listClientAddresses,
  listClientContacts,
  listClientContractTerms,
  listPriceExemptions,
  saveClientAddress,
  saveClientContact,
  saveClientContractTerm,
  savePriceExemption,
} from '@/features/clients/clientsService';
import {listGovernorates, listRegions} from '@/features/definitions/definitionsService';
import {listClientPriceLists, listTaxProfiles} from '@/features/pricing/pricingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {GovernorateRecord, RegionRecord} from '@/types/definitions';
import type {
  ClientAddressRecord,
  ClientContactRecord,
  ClientContractTermRecord,
  ClientPriceListRecord,
  ClientRecord,
  ExemptionTarget,
  PriceExemptionRecord,
  TaxProfileRecord,
} from '@/types/pricing';
import {ArrowRight, Plus, Trash2} from 'lucide-react';

const EXEMPTION_LABELS: Record<ExemptionTarget, string> = {
  extra_weight: 'إعفاء/خصم الوزن الإضافي',
  collection_fee: 'إعفاء/خصم عمولة التحصيل',
  return_fee: 'إعفاء/خصم رسوم الإرجاع',
};

export function ClientDetailPage() {
  const {clientId = ''} = useParams();
  const {tenant, isAdmin} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [addresses, setAddresses] = useState<readonly ClientAddressRecord[]>([]);
  const [contacts, setContacts] = useState<readonly ClientContactRecord[]>([]);
  const [terms, setTerms] = useState<readonly ClientContractTermRecord[]>([]);
  const [exemptions, setExemptions] = useState<readonly PriceExemptionRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [priceList, setPriceList] = useState<ClientPriceListRecord | null>(null);
  const [taxProfile, setTaxProfile] = useState<TaxProfileRecord | null>(null);
  const [tab, setTab] = useState<'overview' | 'addresses' | 'contacts' | 'terms'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Forms state
  const [addrLabel, setAddrLabel] = useState('');
  const [addrGov, setAddrGov] = useState('');
  const [addrReg, setAddrReg] = useState('');
  const [addrLine, setAddrLine] = useState('');
  const [addrPhone, setAddrPhone] = useState('');

  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactMobile, setContactMobile] = useState('');

  const [termCode, setTermCode] = useState('TRM-001');
  const [termTitle, setTermTitle] = useState('');
  const [termDays, setTermDays] = useState(7);

  const [exTarget, setExTarget] = useState<ExemptionTarget>('extra_weight');
  const [exPercent, setExPercent] = useState(100);
  const [exNotes, setExNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cl, addrs, cnts, trms, exs, govs, regs, pls, tps] = await Promise.all([
        getClientById(tenant.id, clientId),
        listClientAddresses(tenant.id, clientId),
        listClientContacts(tenant.id, clientId),
        listClientContractTerms(tenant.id, clientId),
        listPriceExemptions(tenant.id, clientId),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
        listClientPriceLists(tenant.id),
        listTaxProfiles(tenant.id),
      ]);
      setClient(cl);
      setAddresses(addrs);
      setContacts(cnts);
      setTerms(trms);
      setExemptions(exs);
      setGovernorates(govs);
      setRegions(regs);
      if (cl) {
        setPriceList(pls.find((p) => p.id === cl.price_list_id) ?? null);
        setTaxProfile(tps.find((t) => t.id === cl.tax_profile_id) ?? null);
        setAddrGov((prev) => prev || cl.governorate_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل ملف العميل.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, clientId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddAddress = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveClientAddress(tenant.id, {
        client_id: clientId,
        label: addrLabel,
        governorate_id: addrGov,
        city_id: null,
        region_id: addrReg || null,
        address_line: addrLine,
        phone: addrPhone || null,
        is_default: addresses.length === 0,
      });
      setAddrLabel('');
      setAddrLine('');
      setAddrPhone('');
      setFeedback('تم إضافة عنوان الالتقاط بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة العنوان.');
    }
  };

  const handleAddContact = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveClientContact(tenant.id, {
        client_id: clientId,
        name: contactName,
        role_title: contactRole || null,
        phone: null,
        mobile: contactMobile || null,
        email: null,
        is_primary: contacts.length === 0,
      });
      setContactName('');
      setContactRole('');
      setContactMobile('');
      setFeedback('تم إضافة جهة الاتصال.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة جهة الاتصال.');
    }
  };

  const handleAddTerm = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveClientContractTerm(tenant.id, {
        client_id: clientId,
        term_code: termCode,
        title: termTitle,
        settlement_cycle_days: termDays,
        notes: null,
      });
      setTermTitle('');
      setFeedback('تم إضافة شرط التعاقد.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة شرط التعاقد.');
    }
  };

  const handleAddExemption = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await savePriceExemption(tenant.id, {
        client_id: clientId,
        exemption_target: exTarget,
        discount_percent: exPercent,
        notes: exNotes || null,
      });
      setExNotes('');
      setFeedback('تم إضافة الإعفاء السعري للعميل.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الإعفاء السعري.');
    }
  };

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">جاري تحميل ملف العميل...</p>;
  }

  if (!client) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-700">لم يتم العثور على سجل العميل.</p>
        <Link to={`${basePath}/clients`} className="mt-3 inline-block text-xs font-medium text-slate-900 underline">
          العودة لقائمة العملاء
        </Link>
      </div>
    );
  }

  const govName = governorates.find((g) => g.id === client.governorate_id)?.name ?? '—';
  const regName = regions.find((r) => r.id === client.region_id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to={`${basePath}/clients`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
            <ArrowRight className="h-3.5 w-3.5" />
            العودة لقائمة العملاء
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">
            {client.name} · <span className="font-mono-tabular text-base text-slate-600">{client.code}</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {govName} / {regName} · قائمة الأسعار: {priceList ? `${priceList.code} (${priceList.name})` : '—'}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            {id: 'overview', label: 'البيانات المالية'},
            {id: 'addresses', label: `عناوين الالتقاط (${addresses.length})`},
            {id: 'contacts', label: `جهات الاتصال (${contacts.length})`},
            {id: 'terms', label: `الشروط والإعفاءات (${terms.length + exemptions.length})`},
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
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

      {tab === 'overview' && (
        <section className="grid grid-cols-1 gap-6 rounded-xl border border-slate-200 bg-white p-6 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <h2 className="text-sm font-semibold text-slate-900">بيانات التواصل والعنوان</h2>
            <p className="text-xs text-slate-600">الهاتف: <span className="font-mono-tabular text-slate-900">{client.phone}</span></p>
            <p className="text-xs text-slate-600">الموبايل: <span className="font-mono-tabular text-slate-900">{client.mobile}</span></p>
            <p className="text-xs text-slate-600">البريد: <span className="font-mono-tabular text-slate-900">{client.email ?? '—'}</span></p>
            <p className="text-xs text-slate-600">العنوان: <span className="text-slate-900">{client.address_line}</span></p>
          </div>
          <div className="space-y-3 text-sm">
            <h2 className="text-sm font-semibold text-slate-900">سياسة التسعير والضريبة والسداد</h2>
            <p className="text-xs text-slate-600">
              ملف الضريبة: <span className="font-medium text-slate-900">{taxProfile?.name ?? '—'}</span>
            </p>
            <p className="text-xs text-slate-600">
              نوع السعر الافتراضي:{' '}
              <span className="font-medium text-slate-900">
                {client.default_price_mode === 'shipping_included' ? 'شامل مصاريف الشحن' : 'غير شامل مصاريف الشحن'}
              </span>
            </p>
            <p className="text-xs text-slate-600">
              طريقة التحويل/السداد:{' '}
              <span className="font-medium text-slate-900">
                {client.payout_method === 'bank_transfer'
                  ? `تحويل بنكي (${client.bank_name ?? ''} - ${client.bank_account_number ?? ''})`
                  : client.payout_method === 'vodafone_cash'
                    ? `فودافون كاش (${client.wallet_phone ?? ''})`
                    : 'نقدي'}
              </span>
            </p>
          </div>
        </section>
      )}

      {tab === 'addresses' && (
        <section className="space-y-4">
          {isAdmin && (
            <form onSubmit={handleAddAddress} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-5">
              <input
                required
                value={addrLabel}
                onChange={(e) => setAddrLabel(e.target.value)}
                placeholder="اسم الفرع / المخزن"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <select
                value={addrGov}
                onChange={(e) => setAddrGov(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select
                value={addrReg}
                onChange={(e) => setAddrReg(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">كل مناطق المحافظة</option>
                {regions.filter((r) => r.governorate_id === addrGov).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                required
                value={addrLine}
                onChange={(e) => setAddrLine(e.target.value)}
                placeholder="العنوان التفصيلي"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <button type="submit" className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white">
                <Plus className="h-3.5 w-3.5" />
                إضافة عنوان
              </button>
            </form>
          )}
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {addresses.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">لا توجد عناوين التقاط إضافية مسجلة.</p>
            ) : (
              addresses.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {a.label} {a.is_default ? '· افتراضي' : ''}
                    </p>
                    <p className="text-slate-600">{a.address_line}</p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteClientAddress(tenant.id, a.id).then(loadData)}
                      className="rounded border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === 'contacts' && (
        <section className="space-y-4">
          {isAdmin && (
            <form onSubmit={handleAddContact} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4">
              <input
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="الاسم"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <input
                value={contactRole}
                onChange={(e) => setContactRole(e.target.value)}
                placeholder="الصفة الوظيفية"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <input
                dir="ltr"
                value={contactMobile}
                onChange={(e) => setContactMobile(e.target.value)}
                placeholder="رقم الموبايل"
                className="rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
              <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white">
                إضافة جهة اتصال
              </button>
            </form>
          )}
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {contacts.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">لا توجد جهات اتصال إضافية.</p>
            ) : (
              contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-5 py-3 text-xs">
                  <span className="font-medium text-slate-900">
                    {c.name} · {c.role_title ?? 'مسؤول تواصل'}
                  </span>
                  <span className="font-mono-tabular text-slate-600">{c.mobile ?? c.phone ?? '—'}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === 'terms' && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">شروط التعاقد ودورة التسوية</h2>
            {isAdmin && (
              <form onSubmit={handleAddTerm} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  required
                  dir="ltr"
                  value={termCode}
                  onChange={(e) => setTermCode(e.target.value.toUpperCase())}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                />
                <input
                  required
                  value={termTitle}
                  onChange={(e) => setTermTitle(e.target.value)}
                  placeholder="وصف الشرط"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={termDays}
                  onChange={(e) => setTermDays(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                />
                <button type="submit" className="sm:col-span-3 rounded-lg bg-slate-900 py-1.5 text-xs font-medium text-white">
                  إضافة شرط تعاقد
                </button>
              </form>
            )}
            <div className="divide-y divide-slate-100 text-xs">
              {terms.map((t) => (
                <div key={t.id} className="flex justify-between py-2">
                  <span>{t.term_code} — {t.title}</span>
                  <span className="font-mono-tabular text-slate-600">كل {t.settlement_cycle_days} يوم</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">إعفاءات وخصومات العميل السعرية</h2>
            {isAdmin && (
              <form onSubmit={handleAddExemption} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select
                  value={exTarget}
                  onChange={(e) => setExTarget(e.target.value as ExemptionTarget)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="extra_weight">الوزن الإضافي</option>
                  <option value="collection_fee">عمولة التحصيل</option>
                  <option value="return_fee">رسوم الإرجاع</option>
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={exPercent}
                  onChange={(e) => setExPercent(Number(e.target.value))}
                  placeholder="نسبة الخصم %"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                />
                <input
                  value={exNotes}
                  onChange={(e) => setExNotes(e.target.value)}
                  placeholder="ملاحظة"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                <button type="submit" className="sm:col-span-3 rounded-lg bg-slate-900 py-1.5 text-xs font-medium text-white">
                  إضافة إعفاء سعري
                </button>
              </form>
            )}
            <div className="divide-y divide-slate-100 text-xs">
              {exemptions.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between py-2">
                  <span>
                    {EXEMPTION_LABELS[ex.exemption_target]} · خصم <strong className="font-mono-tabular">{ex.discount_percent}%</strong>
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deletePriceExemption(tenant.id, ex.id).then(loadData)}
                      className="text-red-700 hover:underline"
                    >
                      حذف
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
