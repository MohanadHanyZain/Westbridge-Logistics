import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {
  getTenantMapsSettings,
  purgeExpiredCourierLocations,
  updateTenantMapsSettings,
} from '@/features/couriers/couriersService';
import {
  getTenantMessagingSettings,
  updateTenantMessagingSettings,
} from '@/features/messaging/messagingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {Bell, HardDrive, MapPinned, Save, Settings2, ShieldAlert, Trash2} from 'lucide-react';

export function TenantSettingsPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [retentionDays, setRetentionDays] = useState(365);
  const [maxSizeMb, setMaxSizeMb] = useState(5);
  const [notifyShipmentStatus, setNotifyShipmentStatus] = useState(true);
  const [notifyNewMessage, setNotifyNewMessage] = useState(true);
  const [notifySettlement, setNotifySettlement] = useState(true);

  const [locationRetentionDays, setLocationRetentionDays] = useState(90);
  const [gpsPingInterval, setGpsPingInterval] = useState(60);
  const [requireGpsOnDelivery, setRequireGpsOnDelivery] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMaps, setSavingMaps] = useState(false);
  const [purging, setPurging] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        getTenantMessagingSettings(tenant.id),
        getTenantMapsSettings(tenant.id).catch(() => ({
          tenant_id: tenant.id,
          location_retention_days: 90,
          gps_ping_interval_seconds: 60,
          require_gps_on_delivery: false,
        })),
      ]);
      setRetentionDays(s.message_retention_days);
      setMaxSizeMb(s.attachment_max_size_mb);
      setNotifyShipmentStatus(s.notify_on_shipment_status);
      setNotifyNewMessage(s.notify_on_new_message);
      setNotifySettlement(s.notify_on_settlement);

      setLocationRetentionDays(m.location_retention_days);
      setGpsPingInterval(m.gps_ping_interval_seconds);
      setRequireGpsOnDelivery(m.require_gps_on_delivery);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل الإعدادات.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setFeedback(null);
    setSaving(true);
    try {
      const updated = await updateTenantMessagingSettings(tenant.id, {
        message_retention_days: retentionDays,
        attachment_max_size_mb: maxSizeMb,
        notify_on_shipment_status: notifyShipmentStatus,
        notify_on_new_message: notifyNewMessage,
        notify_on_settlement: notifySettlement,
      });
      setRetentionDays(updated.message_retention_days);
      setMaxSizeMb(updated.attachment_max_size_mb);
      setNotifyShipmentStatus(updated.notify_on_shipment_status);
      setNotifyNewMessage(updated.notify_on_new_message);
      setNotifySettlement(updated.notify_on_settlement);
      setFeedback({type: 'success', text: 'تم حفظ إعدادات الرسائل والمرفقات والإشعارات بنجاح.'});
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.'});
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMaps = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setFeedback(null);
    setSavingMaps(true);
    try {
      const updated = await updateTenantMapsSettings(tenant.id, {
        location_retention_days: locationRetentionDays,
        gps_ping_interval_seconds: gpsPingInterval,
        require_gps_on_delivery: requireGpsOnDelivery,
      });
      setLocationRetentionDays(updated.location_retention_days);
      setGpsPingInterval(updated.gps_ping_interval_seconds);
      setRequireGpsOnDelivery(updated.require_gps_on_delivery);
      setFeedback({type: 'success', text: 'تم حفظ سياسة الخرائط وتحديد المواقع (ADR-022) بنجاح.'});
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر حفظ إعدادات الخرائط.'});
    } finally {
      setSavingMaps(false);
    }
  };

  const handlePurgeExpiredLocations = async () => {
    if (!isAdmin) return;
    setFeedback(null);
    setPurging(true);
    try {
      const deletedCount = await purgeExpiredCourierLocations(tenant.id);
      setFeedback({
        type: 'success',
        text: `تم تنظيف سجلات المواقع المنتهية الصلاحية (${deletedCount} سجل محذوف).`,
      });
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تنظيف السجلات.'});
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">إعدادات الشركة والرسائل والمرفقات</h1>
        <p className="mt-1 text-sm text-slate-600">
          تخصيص مدة الاحتفاظ بالرسائل، الحد الأقصى لحجم الملفات المرفقة، وتنبيهات النظام التلقائية (ADR-020).
        </p>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>عرض فقط — تعديل سياسات الشركة والاحتفاظ مقتصر على مالك الشركة أو المدير العام.</span>
        </div>
      )}

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          جاري تحميل إعدادات الشركة...
        </div>
      ) : (
        <form onSubmit={handleSave} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">سياسة التخزين والاحتفاظ بالرسائل</h2>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="set-retention" className="block text-xs font-medium text-slate-700">
                  مدة الاحتفاظ بسجل المحادثات والمرفقات (بالأيام)
                </label>
                <input
                  id="set-retention"
                  type="number"
                  min={30}
                  max={3650}
                  disabled={!isAdmin}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs disabled:bg-slate-50"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  النطاق المسموح: من 30 يومًا حتى 3650 يومًا (الافتراضي: 365 يومًا).
                </p>
              </div>

              <div>
                <label htmlFor="set-max-mb" className="block text-xs font-medium text-slate-700">
                  الحد الأقصى لحجم الملف المرفق (ميجابايت)
                </label>
                <input
                  id="set-max-mb"
                  type="number"
                  min={1}
                  max={25}
                  disabled={!isAdmin}
                  value={maxSizeMb}
                  onChange={(e) => setMaxSizeMb(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs disabled:bg-slate-50"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  الصيغ المسموحة أمنيًا: JPEG, PNG, WEBP, PDF داخل حاويات Supabase Storage الخاصة مع روابط مؤقتة (300 ثانية).
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">تفضيلات الإشعارات الفورية</h2>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={notifyShipmentStatus}
                  onChange={(e) => setNotifyShipmentStatus(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <div>
                  <p className="font-semibold text-slate-900">تغييرات حالة الشحنات والتعذر</p>
                  <p className="mt-0.5 text-slate-500">
                    إرسال إشعار فوري للتاجر والمندوب عند تسجيل حركة أو حالة توصيل جديدة.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={notifyNewMessage}
                  onChange={(e) => setNotifyNewMessage(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <div>
                  <p className="font-semibold text-slate-900">الرسائل الجديدة في المحادثات</p>
                  <p className="mt-0.5 text-slate-500">
                    إشعار الأطراف المصرح لها عند وصول رسالة خارجية أو استفسار من التاجر/المندوب.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={notifySettlement}
                  onChange={(e) => setNotifySettlement(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <div>
                  <p className="font-semibold text-slate-900">التسويات المالية والتحصيل</p>
                  <p className="mt-0.5 text-slate-500">
                    تفعيل تنبيهات قيود التسوية والتحصيل عند اعتماد كشوفات التجار والمندوبين.
                  </p>
                </div>
              </label>
            </div>
          </section>

          {isAdmin && (
            <div className="lg:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</span>
              </button>
            </div>
          )}
            </form>
          )}

          {/* Phase 14 Maps & GPS Location Retention Policy */}
          {!loading && (
            <form onSubmit={handleSaveMaps} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPinned className="h-4 w-4 text-slate-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    سياسة الخرائط وتتبع مواقع المندوبين (ADR-022)
                  </h2>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    disabled={purging}
                    onClick={() => void handlePurgeExpiredLocations()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{purging ? 'جاري التنظيف...' : 'تنظيف السجلات المنتهية'}</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="set-loc-retention" className="block text-xs font-medium text-slate-700">
                    مدة الاحتفاظ بسجل مواقع المندوبين (بالأيام)
                  </label>
                  <input
                    id="set-loc-retention"
                    type="number"
                    min={7}
                    max={365}
                    disabled={!isAdmin}
                    value={locationRetentionDays}
                    onChange={(e) => setLocationRetentionDays(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs disabled:bg-slate-50"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    النطاق المسموح: من 7 أيام حتى 365 يومًا (الافتراضي: 90 يومًا).
                  </p>
                </div>

                <div>
                  <label htmlFor="set-gps-interval" className="block text-xs font-medium text-slate-700">
                    فاصل تحديث الموقع الميداني (بالثواني)
                  </label>
                  <input
                    id="set-gps-interval"
                    type="number"
                    min={15}
                    max={600}
                    disabled={!isAdmin}
                    value={gpsPingInterval}
                    onChange={(e) => setGpsPingInterval(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs disabled:bg-slate-50"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    النطاق المسموح: من 15 إلى 600 ثانية أثناء الوردية النشطة.
                  </p>
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-xs">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={requireGpsOnDelivery}
                  onChange={(e) => setRequireGpsOnDelivery(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <div>
                  <p className="font-semibold text-slate-900">إلزام توثيق إحداثيات GPS عند تسجيل التسليم أو التعذر</p>
                  <p className="mt-0.5 text-slate-500">
                    عند تفعيل هذا الخيار يُطلب من المندوب التقاط الموقع في نافذة تنفيذ التوصيل قبل الحفظ.
                  </p>
                </div>
              </label>

              {isAdmin && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingMaps}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{savingMaps ? 'جاري الحفظ...' : 'حفظ سياسة المواقع'}</span>
                  </button>
                </div>
              )}
            </form>
          )}

      {/* Quick Links to Domain Policies */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">روابط السياسات التشغيلية والمالية الأخرى</h2>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <Link
            to={`${basePath}/clients/registrations`}
            className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
          >
            <p className="font-semibold text-slate-900">إعدادات تسجيل التجار الذاتي</p>
            <p className="mt-0.5 text-slate-500">تفعيل ومراجعة طلبات حسابات التجار</p>
          </Link>
          <Link
            to={`${basePath}/operations/delivery`}
            className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
          >
            <p className="font-semibold text-slate-900">سياسة محاولات التوصيل و POD</p>
            <p className="mt-0.5 text-slate-500">الحد الأقصى للمحاولات ورسوم الإعادة</p>
          </Link>
          <Link
            to={`${basePath}/clients/settlements`}
            className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
          >
            <p className="font-semibold text-slate-900">سياسة الاعتماد المالي المزدوج</p>
            <p className="mt-0.5 text-slate-500">تحديد متطلبات اعتماد المدير العام للتسويات</p>
          </Link>
        </div>
      </section>
    </div>
  );
}