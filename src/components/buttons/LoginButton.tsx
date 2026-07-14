import { SignInButton } from '@clerk/clerk-react';
import { useI18n } from '../../i18n';

export default function LoginButton() {
  const { t } = useI18n();
  return (
    <SignInButton>
      <button className="button text-white shadow-solid">
        <div className="inline-block bg-clay-700">
          <span>{t('action.login')}</span>
        </div>
      </button>
    </SignInButton>
  );
}
