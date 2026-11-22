النموذج الأمني الشامل للنظام (Security Model)
1. عزل المستأجرين (Multi-Tenant Isolation & FORCE ROW LEVEL SECURITY)
ملكية البيانات (tenant_id + Composite FKs):
كل سجل تشغيلي أو مالي أو أمني يحمل tenant_id إلزاميًا ومرتبط بمفاتيح أجنبية مركبة (tenant_id, foreign_id) تمنع أي ربط عرضي بين شركتين حتى لو تم تمرير UUID صالح يخص شركة أخرى.
تفعيل وإلزام سياسات الصفوف:
100% من جداول مخطط public مفعّل عليها ENABLE ROW LEVEL SECURITY وFORCE ROW LEVEL SECURITY.
دالة الفحص الحية public.get_launch_readiness_overview() تتحقق مباشرة من كتالوج النظام (pg_class وpg_namespace) بأن عدد الجداول غير المحمية داخل public يساوي 0 قبل أي إطلاق.
حماية الجداول والمخططات الخاصة:
مخطط app_private (auth_identities, webhook_secrets) ومخطط audit (audit_logs, user_sessions_audit) محجوبان بالكامل عن أدوار PUBLIC وanon وauthenticated.
عمود api_tokens.token_hash محجوب عن استعلامات SELECT لدور authenticated على مستوى الأعمدة (column-level grant).
2. الهوية والتفويض وصلاحيات الوصول (Auth & RBAC)
تخزين بيانات الاعتماد: يتولى Supabase Auth كلمات المرور والتوكنات حصريًا. لا توجد أي أعمدة لكلمات المرور داخل جداول public.
تحويل اسم المستخدم الآمن (ADR-004): يتم التحويل عبر app_private.auth_identities وإجراء خادمي ذري يمنع كشف البريد الداخلي أو تعداد المستخدمين (user enumeration)، مع إرجاع رسالة خطأ عامة موحدة عند فشل الدخول.
منع user_metadata في التفويض: تعتمد سياسات RLS والدوال الخادمية حصريًا على auth.uid() ومطابقة الجداول الموثقة (public.platform_admins, public.tenant_memberships, public.role_permissions, public.user_branch_scopes, public.courier_users, public.client_users).
فصل الصلاحيات والاعتماد الثنائي (ADR-018): الفصل بين منشئ المستند ومعتمده في القيود والمستخلصات والتحصيلات، وقصر تعديل الحسابات/الباقات الحرجة على platform_super_admin.
دخول الدعم الفني المراقب (ADR-023): يُحظر الدخول التشخيصي إلا بجلسة زمنية محددة المدة وبسبب إجباري يُوثَّق مباشرة في audit.audit_logs.
3. أمن التكاملات والملفات والتصدير والعمليات الخادمية
رموز API الخارجية (ADR-024): تُحفظ بتجزئة SHA-256 فقط، وتُعرض للمستخدم مرة واحدة عند الإنشاء، ومقيدة بنطاق الشركة أو التاجر وقائمة IPs وتاريخ انتهاء وتفعيل الباقة.
Webhooks الموقعة: حظر العناوين المحلية والداخلية وروابط http:// غير المشفرة (SSRF protection)، وتوقيع الحمولة بـ HMAC-SHA256 عبر X-ShipFlow-Signature.
حاويات Storage الخاصة (ADR-020): حاويات خاصة بالكامل بروابط موقعة قصيرة العمر (300 ثانية) وفحص الامتداد والحجم الأقصى خادميًا.
حماية CSV / Excel (ADR-021): تحييد حقن الصيغ (CSV Formula Injection) عند أي تصدير.
حماية المتصفح (Client Env Guard): التحقق الآلي أثناء التشغيل والاختبارات (assertNoServerSecretsInClientEnv) من خلو متغيرات الواجهة (VITE_*) من SERVICE_ROLE_KEY أو أي أسرار خادم.