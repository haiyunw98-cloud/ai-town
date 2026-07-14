import { useI18n } from '../i18n';

export default function LanguageButton() {
  const { locale, setLocale, t } = useI18n();
  const isChinese = locale === 'zh-CN';
  return (
    <button
      type="button"
      className="button language-button text-white shadow-solid text-xl pointer-events-auto"
      aria-label={t(isChinese ? 'language.switchToEnglish' : 'language.switchToChinese')}
      onClick={() => setLocale(isChinese ? 'en' : 'zh-CN')}
    >
      <span className="inline-block bg-clay-700 px-3 py-2">
        {t(isChinese ? 'language.english' : 'language.chinese')}
      </span>
    </button>
  );
}
