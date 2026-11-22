import {useEffect, useState, type ReactNode} from 'react';
import {BRAND_CONFIG} from '@/config/brand';

interface DirectionProviderProps {
  children: ReactNode;
}

export function DirectionProvider({children}: DirectionProviderProps) {
  const [locale, setLocale] = useState<'ar' | 'en'>(
    typeof localStorage !== 'undefined' && localStorage.getItem('shipflow_locale') === 'en' ? 'en' : 'ar',
  );

  useEffect(() => {
    const locale = localStorage.getItem('shipflow_locale') === 'en' ? 'en' : 'ar';
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale === 'ar' ? 'ar' : 'en';
    document.title = `${BRAND_CONFIG.appName} | منصة إدارة عمليات الشحن`;

    const syncLocale = () => {
      setLocale(localStorage.getItem('shipflow_locale') === 'en' ? 'en' : 'ar');
    };
    const syncTheme = () => {
      document.documentElement.dataset.theme = localStorage.getItem('shipflow_theme') === 'dark' ? 'dark' : 'light';
    };
    syncTheme();
    window.addEventListener('shipflow-language-change', syncLocale);
    window.addEventListener('shipflow-theme-change', syncTheme);
    return () => {
      window.removeEventListener('shipflow-language-change', syncLocale);
      window.removeEventListener('shipflow-theme-change', syncTheme);
    };
  }, []);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }, [dir, locale]);

  return (
    <div dir={dir} lang={locale} className="min-h-screen">
      {children}
    </div>
  );
}
