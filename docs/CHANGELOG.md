# سجل التغييرات (CHANGELOG)

## [المرحلة 10] - 2026-11-20
### المضاف
- اعتماد القرار `ADR-019` (الأساس المحاسبي النقدي `Cash Basis` للاعتراف بالإيرادات والمصروفات عند التحصيل والسداد الفعلي بالخزائن، مع إقفال دوري للفترات).
- إنشاء Migration `supabase/migrations/0011_phase10_general_ledger_journal_entries.sql`:
  - جدول قيود اليومية العامة `journal_entries` وبنودها `journal_entry_lines` مع `FORCE ROW LEVEL SECURITY` والتحقق الذري من توازن القيد (`SUM(debit) = SUM(credit)`).
  - تسلسل الترقيم التلقائي لـ `JENT-XXXXXX`.
  - دوال خادمية ذرية: `create_manual_journal_entry`, `approve_journal_entry` (مع تطبيق حوكمة الاعتماد الثنائي `ADR-018` Four-Eyes)، و`get_trial_balance` لحساب ميزان المراجعة والأستاذ العام.
- إنشاء اختبار العزل والتحقق المحاسبي `supabase/tests/rls/phase10_general_ledger_isolation.sql`.
- إضافة قسم **الحسابات العامة والتقارير** وشاشات: **قيود اليومية العامة** (`JournalEntriesPage`) و**ميزان المراجعة والأستاذ** (`TrialBalancePage`)، مع اختبارات `src/tests/phase10.test.tsx`.

## [المرحلة 9] - 2026-11-19
### المضاف
- اعتماد القرار `ADR-018` (الاعتماد الثنائي Four-Eyes مع استثناء المالك الافتراضي للشركات الصغيرة وحد المبلغ المرتفع `high_value_approval_threshold` الذي يتطلب اعتماد المالك أو الأدمن).
- إنشاء Migration `supabase/migrations/0010_phase9_collections_settlements_cashboxes.sql`:
  - توسيع `tenant_settings` بحقول حوكمة الاعتماد (`enforce_four_eyes`, `allow_owner_self_approve`, `high_value_approval_threshold`)، وربط `shipments` بمستندات التحصيل والتسوية وصرف العمولات.
  - تحديث تسلسلات الترقيم التلقائية لـ `COL-XXXXXX` و`CST-XXXXXX` و`CMP-XXXXXX` و`CTR-XXXXXX` و`CTX-XXXXXX` و`RCV-XXXXXX` و`PAY-XXXXXX`.
  - جداول مالية محمية بـ `FORCE ROW LEVEL SECURITY`: `cashbox_transactions` (دفتر حركات غير قابل للتعديل أو الحذف بمشغل قاعدة البيانات)، `courier_collection_vouchers` وبنودها، `client_settlements` وبنودها، `courier_commission_payouts` وبنودها، `cashbox_transfers`، و`cashbox_vouchers`.
  - دوال خادمية ذرية محمية بـ `app_private.user_is_staff_with_permission` و`app_private.assert_finance_approval_policy`: إدارة السياسة المالية، حساب أرصدة الخزائن اللحظي، التحصيل من المندوبين (`COL`)، تسوية العملاء (`CST`) مع خصم المرتجعات (`ADR-016`)، صرف عمولات المندوبين (`CMP`) مع المنع الصارم لصرف عمولة COD قبل توريد النقدية (`ADR-012`)، والتحويلات بين الخزائن وسندات القبض والصرف والإيداع المقدم.
- إنشاء اختبار العزل المالي والرقابة `supabase/tests/rls/phase9_finance_settlements_isolation.sql`.
- إضافة قسم **المالية والخزائن** وشاشات: **إدارة الخزائن والحركات** (`FinanceCashboxesPage`)، **التحصيل النقدي من المناديب** (`CourierCollectionsPage`)، وتفعيل **تسويات العملاء** (`ClientSettlementsPage` مع نافذة الطباعة) و**تسويات وعمولات المندوبين** (`CourierSettlementsPage`)، مع اختبارات `src/tests/phase9.test.tsx`.

## [المرحلة 8] - 2026-11-19
### المضاف
- اعتماد القرارين `ADR-016` (رسوم وتحمل المرتجعات: `no_charge` على الراسل، `sender_partial_fee`، و`recipient_paid_fee` كعهدة تحصيل على المندوب مع عمولة `0` للمرتجع) و`ADR-017` (الحد الأقصى لمحاولات التوصيل `max_delivery_attempts` الافتراضي 3 في `tenant_settings` والتحويل التلقائي للمرتجع ومنع إعادة الجدولة إلا باستثناء الإدارة).
- إنشاء Migration `supabase/migrations/0009_phase8_delivery_returns_courier_portal.sql`:
  - توسيع `tenant_settings` (`max_delivery_attempts`, `retry_extra_fee`, `require_pod_on_delivery`) و`shipments` (حقول تحمل المرتجع، التحصيل عند الباب، عمولة المندوب المستحقة، وإثبات التسليم الرقمي `POD`).
  - تحديث تسلسلات الترقيم لتشمل `DLV-XXXXXX` و`RDL-XXXXXX` و`RTH-XXXXXX` و`RTD-XXXXXX` و`RTN-XXXXXX`.
  - جداول `delivery_lists`, `delivery_list_items`, `return_manifests`, و`return_manifest_items` مع `FORCE ROW LEVEL SECURITY` وصلاحية المندوب المرتبط عبر `app_private.user_get_bound_courier_id`.
  - دوال خادمية ذرية: `update_tenant_delivery_policy`, `create_delivery_list`, `add_shipments_to_delivery_list` (مع فحص سقف المحاولات والاستثناء الإداري)، `remove_shipment_from_delivery_list`, `approve_delivery_list`, `record_delivery_execution` (حساب عمولة `ADR-012` + `POD` + `ADR-016` + `ADR-017`)، `create_return_manifest`, `add_shipments_to_return_manifest`, `remove_shipment_from_return_manifest`, `approve_return_manifest`, و`list_courier_my_tasks`.
- إنشاء اختبار العزل وسير العمل `supabase/tests/rls/phase8_delivery_returns_isolation.sql`.
- إضافة شاشات المرحلة الثامنة: **قوائم التوصيل** و**قوائم إعادة التوصيل** (`DeliveryListsPage`), **قوائم المرتجعات** ثلاثية المراحل (`ReturnsWorkflowPage`), **بوابة المندوب** (`CourierPortalPage`), ونافذة تسجيل النتائج الميدانية والتوقيع/OTP (`DeliveryExecutionModal`) مع ربطها مباشرة في جدول الشحنات قيد التوصيل وإعادة التوصيل، واختبارات `src/tests/phase8.test.tsx`.

## [المرحلة 7] - 2026-11-19
### المضاف
- اعتماد القرار `ADR-015` (مصافحة النقل بين الفروع على خطوتين دون نقل عهدة `current_branch_id` قبل اعتماد الاستلام بالمخزن المستقبِل، وحصر فك التعليق الإداري في `company_owner` / `company_admin` / `operations_manager` مع سبب تدقيقي إلزامي).
- إنشاء Migration `supabase/migrations/0008_phase7_pickup_warehouse_transfers.sql`:
  - تحديث تسلسلات الترقيم التلقائية `app_private.next_document_number` لتوليد أكواد `PKP-XXXXXX` و`WRH-XXXXXX` و`TRF-XXXXXX` لجميع الشركات.
  - جداول `pickup_lists`, `pickup_list_items`, `warehouse_manifests`, و`warehouse_manifest_items` مع `FORCE ROW LEVEL SECURITY` ومفاتيح أجنبية مركبة `(tenant_id, ...)` وصلاحية قراءة آمنة للفرع المستقبِل على قوائم النقل الواردة.
  - دوال خادمية ذرية (`SECURITY DEFINER`): `create_pickup_list`, `add_shipments_to_pickup_list`, `remove_shipment_from_pickup_list`, `approve_pickup_list`, `create_warehouse_manifest`, `add_shipments_to_warehouse_manifest`, `remove_shipment_from_warehouse_manifest`, `approve_warehouse_manifest`, `admin_release_stuck_transfer_or_manifest`, و`list_branch_inbound_transfer_shipments`.
- إنشاء اختبار العزل ومصافحة النقل بين الفروع `supabase/tests/rls/phase7_operations_isolation.sql`.
- إضافة قسم **العمليات اليومية** في القائمة الجانبية لشاشات: **قوائم الالتقاط** (`PickupListsPage`)، **قوائم الاستلام بالمخزن** (`WarehouseIntakePage` مع تعديل الوزن بالمخزن `ADR-010` ونماذج الطباعة الخمسة وشريط الشحنات الواردة من النقل)، و**النقل بين الفروع** (`BranchTransfersPage` مع تبويب الوارد قيد الانتظار وإجراء «فك تعليق إداري»)، مع اختبارات `src/tests/phase7.test.tsx`.

## [المرحلة 6] - 2026-11-19
### المضاف
- اعتماد القرارين `ADR-013` (الأثر المالي لأنواع الدفع: `COD`, `PREPAID`, `POSTPAID`, `CASH_PAID`) و`ADR-014` (معالجة التسليم الجزئي `PDP` على نفس الشحنة، وعهدة طرد الاستبدال الإلزامية `PTP`).
- إنشاء Migration `supabase/migrations/0007_phase6_shipments_barcode_lifecycle.sql`:
  - جداول `shipments`, `shipment_parties`, `shipment_packages`, `shipment_dimensions`, `shipment_status_events` (غير قابلة للتعديل), `shipment_relations`, `shipment_tracking_tokens`, `shipment_notes`, و`shipment_reference_numbers` مع ربط `shipment_price_snapshots.shipment_id` ومنع التعديل المباشر على `shipments` خارج دوال الخادم.
  - دوال خادمية ذرية: `app_private.next_document_number` (تسلسل رقمي `SHP-0000001`), `public.create_shipment` (مع باركود غير قابل للتخمين ولقطة سعر فورية)، `public.transition_shipment_status` (دورة الحياة الكاملة و`PDP`/`PTP`)، `public.reprice_shipment_weight_or_override` (`ADR-010`)، و`public.track_public_shipment` (استعلام تتبع عام منزوع البيانات الشخصية لـ `anon`).
- إنشاء اختبار العزل والتحقق `supabase/tests/rls/phase6_shipments_isolation.sql`.
- إضافة قسم **الشحنات** في القائمة الجانبية لشاشات: قائمة الشحنات، إنشاء شحنة (مع الحقل الشرطي لقيمة الرصيد لـ `COD`/`PREPAID` والتعبئة التلقائية للعميل وحساب السعر الحي من الخادم)، الشحنات بالمخزون، قيد التوصيل، انتظار إعادة التوصيل، المرتجعات والمتعثرة، الباركود والتتبع، صفحة تفاصيل الشحنة بالمؤشرات والمراحل والتبويبات الخمسة، وصفحة التتبع العام `/c/:companySlug/track/:token`، مع اختبارات `src/tests/phase6.test.tsx`.

## [المرحلة 5] - 2026-11-18
### المضاف
- اعتماد القرار `ADR-012` (استحقاق عمولة المندوب عند التسليم مفصولة عن النقدية، وأولوية القواعد: المنطقة المحددة ← المحافظة كاملة ← افتراضي ملف المندوب).
- إنشاء Migration `supabase/migrations/0006_phase5_couriers_commissions_routes.sql`:
  - جداول `vehicles`، `drivers`، `courier_routes` (مع خط السير العام المحمي `GENERAL`)، `courier_route_stops`، `courier_commission_lists` (مع القائمة الافتراضية المحمية `0`)، `courier_commission_rules`، و`couriers`.
  - ربط `public.account_subjects.courier_id` بـ `public.couriers(tenant_id, id)` عبر مفتاح أجنبي مركب، وتحديث دوال إدارة المستخدمين (`srv_provision_tenant_user`, `srv_update_tenant_user_assignment`, `list_tenant_users_directory`) والوظيفة السحابية `tenant-manage-users` لربط حسابات المناديب.
  - إضافة دالة احتساب العمولة الخادمية `public.calculate_courier_commission` وفق التدرج الثلاثي المعتمد في `ADR-012`.
- إنشاء اختبار العزل والعمولات `supabase/tests/rls/phase5_couriers_isolation.sql`.
- إضافة قسم **مندوبو التوصيل** في القائمة الجانبية لشاشات: قائمة المندوبين، إنشاء مندوب، قوائم عمولات المندوبين (مع الحاسبة الخادمية)، خطوط سير المندوبين والسيارات والسائقين، قيد التسوية مع المندوبين، وتحركات مندوب الشحن، مع اختبارات `src/tests/phase5.test.tsx`.

## [المرحلة 4] - 2026-11-18
### المضاف
- إنشاء Migration `supabase/migrations/0005_phase4_rbac_users_scopes.sql`:
  - فصل طبيعة الحساب (`account_subject_type`) عن الدور الوظيفي (`roles`) والصلاحية (`permissions`, `role_permissions`) ونطاق الفروع (`membership_branches`) والكيان المرتبط (`account_subjects` مع مفاتيح أجنبية مركبة للعملاء والفروع وجاهزية ربط المندوب في المرحلة 5).
  - بذر 27 صلاحية معيارية عبر 11 وحدة، و12 دورًا افتراضيًا لكل شركة مع حماية دور `company_owner` على مستوى المشغلات وقاعدة البيانات.
  - دوال خادمية آمنة: `app_private.user_has_permission`، `public.get_my_tenant_permissions`، `public.list_tenant_users_directory`، `public.list_tenant_session_audit`، ودوال `service_role` ذرية (`srv_provision_tenant_user`, `srv_update_tenant_user_assignment`, `srv_set_tenant_user_status`, `srv_mark_tenant_user_password_reset`).
- إنشاء Edge Function مستقلة `supabase/functions/tenant-manage-users/index.ts` لإنشاء المستخدمين وتعديل أدوارهم وفروعهم وإعادة تعيين كلمات المرور وتعطيل/تفعيل الحسابات دون تخزين أي كلمة مرور في جداول التطبيق.
- إنشاء اختبار عزل الصلاحيات والنطاقات `supabase/tests/rls/phase4_rbac_isolation.sql`.
- إضافة قسم **الأمان** في القائمة الجانبية لشاشات: **المستخدمون** (`UsersManagementPage`)، **الأدوار والصلاحيات** (`RolesPermissionsPage`)، و**سجل الدخول والجلسات** (`SessionAuditPage`)، مع اختبارات `src/tests/phase4.test.tsx`.

## [المرحلة 3] - 2026-11-18
### المضاف
- اعتماد القرارات `ADR-007`..`ADR-011` في `docs/decisions/DECISION_LOG.md` وتحديث حالة `OQ-01`..`OQ-05` في `docs/decisions/OPEN_QUESTIONS.md`.
- إعادة تنظيم قسم **العملاء** في القائمة الجانبية ليشمل الأقسام الخمسة: قائمة العملاء، إنشاء عميل، الحسابات المسجلة، قوائم أسعار الشحن، وقيد التسوية مع العملاء (`ClientSettlementsPage`).
- إنشاء Migration `supabase/migrations/0004_phase3_clients_pricing_engine.sql`:
  - جداول `client_price_lists` (بما في ذلك القائمة الافتراضية المحمية `0`)، `price_list_versions`، `pickup_price_rules`، `delivery_price_rules`، `price_surcharges`، `clients`، `price_exemptions`، `client_contacts`، `client_addresses`، `client_contract_terms`، `client_registration_requests`، و`shipment_price_snapshots` غير القابلة للتعديل.
  - دوال خادمية ذرية: `public.clone_price_list`، `public.clone_client_record`، و`public.calculate_shipment_price` (تطبيق الوزن الحجمي، التدرج الهرمي 4 مستويات، الضريبة على الرسوم فقط، ومعادلة شامل/غير شامل مصاريف الشحن).
  - تفعيل `FORCE ROW LEVEL SECURITY` وبذر القوائم والضرائب الافتراضية للشركات الحالية والجديدة.
- إنشاء اختبار عزل البيانات ومحرك التسعير `supabase/tests/rls/phase3_clients_pricing_isolation.sql`.
- إضافة شاشات العملاء وقوائم الأسعار ومصفوفة الالتقاط/التسليم وحاسبة التسعير الخادمية في الواجهة، مع اختبارات `src/tests/phase3.test.tsx`.

## [المرحلة 2] - 2026-11-18
### المضاف
- إنشاء Migration `supabase/migrations/0003_phase2_definitions_geography_defaults.sql`:
  - جداول الجغرافيا (`countries`, `governorates`, `cities`, `regions`)، الفروع (`branches`, `branch_service_areas`)، شجرة الحسابات المبدئية (`chart_of_accounts`)، الخدمات وأنواع الطلبات (`shipment_types`, `shipping_services`, `shipping_service_types`)، أسباب التعذر والإرجاع (`delivery_exception_reasons`)، أنواع الحركات (`movement_types`)، اليوميات المساعدة (`auxiliary_journals`)، أنواع القيود (`journal_entry_types`)، الخزائن وأمنائها (`cashboxes`, `cashbox_custodians`)، وطرق الدفع وتسلسل الترقيم.
  - تفعيل `FORCE ROW LEVEL SECURITY` ومفاتيح أجنبية مركبة `(tenant_id, ...)` على جميع الجداول.
  - دالة `app_private.seed_tenant_phase2_defaults` القابلة لإعادة التكرار (`idempotent`) مع تحديث `app_private.onboard_tenant` وترحيل الشركات الموجودة مسبقًا.
- إنشاء اختبار عزل البيانات `supabase/tests/rls/phase2_definitions_isolation.sql`.
- ترقية بوابة الشركة (`/c/:companySlug/app`) إلى لوحة إدارة جانبية RTL شاملة لمسارات الفروع والجغرافيا والخدمات والأسباب والخزائن والحركات واليوميات والحسابات، مع اختبارات `src/tests/phase2.test.tsx`.

## [المرحلة 1] - 2026-11-18
### المضاف
- إنشاء Migration `supabase/migrations/0001_phase1_multitenant_auth_rls.sql`:
  - تأسيس مخططات `app_private` و`audit` وجداول `tenants`, `tenant_settings`, `tenant_onboarding`, `profiles`, `platform_admins`, `platform_support_access`, `tenant_memberships`, `invitations`, `app_private.auth_identities`, `audit.audit_logs`, `audit.user_sessions_audit`.
  - تفعيل وإلزام `FORCE ROW LEVEL SECURITY` على جميع الجداول المكشوفة دون استخدام `user_metadata` للتفويض.
  - دوال `app_private.bootstrap_platform_super_admin` و`app_private.onboard_tenant` الذرية القابلة لإعادة المحاولة (`idempotency_key`).
- إنشاء Edge Functions خادمية (`supabase/functions/`):
  - `auth-resolve-login`: مصادقة `Username + Password` دون كشف البريد الإلكتروني أو السماح بتعداد المستخدمين.
  - `platform-onboard-tenant`: تأسيس شركة جديدة وإرسال دعوة التفعيل للمالك.
  - `auth-update-credentials`: تحديث آمن لـ `username` وكلمة المرور.
- إنشاء اختبار عزل الشركات `supabase/tests/rls/phase1_tenant_isolation.sql`.
- ربط الواجهة الأمامية بعميل `@supabase/supabase-js` العام وتطبيق مسارات `/platform`, `/platform/login`, `/c/:companySlug`, `/c/:companySlug/login`, `/c/:companySlug/app`, `/auth/set-password`.

## [المرحلة 0] - 2026-11-18
### المضاف
- تأسيس هيكل المشروع الكامل، التوثيق المرجعي، RTL، TypeScript الصارم، وبيئة الاختبار Vitest.
