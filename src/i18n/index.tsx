import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { catalogs, MessageKey } from './catalogs';

export type Locale = 'zh-CN' | 'en';

const STORAGE_KEY = 'aitown.locale';

export function normalizeLocale(value?: string | null): Locale {
  const normalized = value?.toLowerCase();
  if (normalized?.startsWith('en')) return 'en';
  if (normalized?.startsWith('zh')) return 'zh-CN';
  return 'zh-CN';
}

export function formatMessage(
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  const template = catalogs[locale][key] ?? catalogs.en[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder,
  );
}

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | undefined>(undefined);

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  return normalizeLocale(window.localStorage.getItem(STORAGE_KEY) ?? window.navigator.language);
}

export function I18nProvider({ children }: React.PropsWithChildren): JSX.Element {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const setLocale = useCallback((nextLocale: Locale) => updateLocale(nextLocale), []);
  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) =>
      formatMessage(locale, key, values),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export type { MessageKey } from './catalogs';
