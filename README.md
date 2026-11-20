# ShipFlow — منصة SaaS لإدارة شركات الشحن والتوصيل

منصة متعددة الشركات (Multi-Tenant) لإدارة شركات الشحن والتوصيل عبر 5 تطبيقات مترابطة (المنصة المركزية، موقع الشركة، لوحة الإدارة، بوابة العميل، وبوابة المندوب).

> **ملاحظة التسمية:** اسم `ShipFlow` اسم مؤقت مركزي قابل للتغيير من `src/config/brand.ts` أو متغير البيئة `VITE_APP_BRAND_NAME`.

## المرجع والوثائق
- المرجع الرئيسي للمواصفات: `docs/MASTER_SPEC.md`
- سجل القرارات المعتمدة: `docs/decisions/DECISION_LOG.md`
- القرارات المفتوحة (بانتظار اعتماد المالك): `docs/decisions/OPEN_QUESTIONS.md`
- النظرة المعمارية: `docs/architecture/SYSTEM_OVERVIEW.md`
- سجل التغييرات: `docs/CHANGELOG.md`

## أوامر التشغيل والتحقق
```bash
npm install
npm run lint     # فحص TypeScript الصارم
npm run test     # تشغيل اختبارات Vitest
npm run build    # بناء الإنتاج
npm run dev      # تشغيل خادم التطوير على المنفذ 3000
```

## الحالة الحالية
- **المرحلة 0 (مكتملة جاهزة للمراجعة):** تأسيس React + TypeScript + RTL، الوثائق المرجعية، هيكل `supabase/` والمجلدات، وبيئة الاختبار الآلي.
- **المرحلة 1 (تبدأ بعد كلمة «تم»):** Multi-Tenant وAuth وRLS والعضويات.
