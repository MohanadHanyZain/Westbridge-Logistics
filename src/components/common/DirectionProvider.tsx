import {useEffect, type ReactNode} from 'react';
import {BRAND_CONFIG} from '@/config/brand';

interface DirectionProviderProps {
  children: ReactNode;
}

export function DirectionProvider({children}: DirectionProviderProps) {
  useEffect(() => {
    document.documentElement.dir = BRAND_CONFIG.defaultDirection;
    document.documentElement.lang = BRAND_CONFIG.defaultLanguage;
    document.title = `${BRAND_CONFIG.appName} | منصة إدارة شركات الشحن والتوصيل`;
  }, []);

  return (
    <div dir={BRAND_CONFIG.defaultDirection} lang={BRAND_CONFIG.defaultLanguage} className="min-h-screen">
      {children}
    </div>
  );
}
