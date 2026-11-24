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
    document.title = locale === 'ar'
      ? `${BRAND_CONFIG.appName} | منصة إدارة عمليات الشحن`
      : `${BRAND_CONFIG.appName} | Shipping Operations Platform`;

    const syncLocale = () => {
      const nextLocale = localStorage.getItem('shipflow_locale') === 'en' ? 'en' : 'ar';
      setLocale(nextLocale);
      document.title = nextLocale === 'ar'
        ? `${BRAND_CONFIG.appName} | منصة إدارة عمليات الشحن`
        : `${BRAND_CONFIG.appName} | Shipping Operations Platform`;
    };
    window.addEventListener('shipflow-language-change', syncLocale);
    return () => {
      window.removeEventListener('shipflow-language-change', syncLocale);
    };
  }, []);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }, [dir, locale]);

  useEffect(() => {
    const tagTableCells = () => {
      document.querySelectorAll('table').forEach((table) => {
        table.dataset.responsiveTable = 'true';
        const headers = Array.from(table.querySelectorAll('thead th'), (header) =>
          header.textContent?.trim() ?? '',
        );
        if (headers.length === 0) return;
        table.querySelectorAll('tbody tr').forEach((row) => {
          const cells = Array.from(row.querySelectorAll(':scope > td'));
          if (cells.length !== headers.length) return;
          cells.forEach((cell, index) => {
            cell.setAttribute('data-label', headers[index]);
          });
        });
      });
    };

    tagTableCells();
    const observer = new MutationObserver(tagTableCells);
    observer.observe(document.body, {childList: true, subtree: true});
    return () => observer.disconnect();
  }, []);

  return (
    <div dir={dir} lang={locale} className="min-h-screen">
      {children}
    </div>
  );
}
