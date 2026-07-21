import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import a16zImg from '../assets/a16z.png';
import convexImg from '../assets/convex.svg';
import starImg from '../assets/star.svg';
import helpImg from '../assets/help.svg';
// import { UserButton } from '@clerk/clerk-react';
// import { Authenticated, Unauthenticated } from 'convex/react';
// import LoginButton from './components/buttons/LoginButton.tsx';
import { useState } from 'react';
import ReactModal from 'react-modal';
import MusicButton from './components/buttons/MusicButton.tsx';
import Button from './components/buttons/Button.tsx';
import InteractButton from './components/buttons/InteractButton.tsx';
import FreezeButton from './components/FreezeButton.tsx';
import { MAX_HUMAN_PLAYERS } from '../convex/constants.ts';
import LanguageButton from './components/LanguageButton.tsx';
import { useI18n } from './i18n';

export default function Home() {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const { t } = useI18n();
  return (
    <main className="town-app font-body game-background">

      <ReactModal
        isOpen={helpModalOpen}
        onRequestClose={() => setHelpModalOpen(false)}
        style={modalStyles}
        contentLabel={t('help.modalLabel')}
        ariaHideApp={false}
      >
        <div className="font-body">
          <h1 className="text-center text-6xl font-bold font-display game-title">{t('app.help')}</h1>
          <p>{t('help.welcome')}</p>
          <h2 className="text-4xl mt-4">{t('help.spectatingTitle')}</h2>
          <p>{t('help.spectating')}</p>
          <h2 className="text-4xl mt-4">{t('help.interactivityTitle')}</h2>
          <p>{t('help.interactivity')}</p>
          <p className="text-2xl mt-2">{t('help.controlsTitle')}</p>
          <p className="mt-4">{t('help.navigate')}</p>
          <p className="mt-4">{t('help.conversation')}</p>
          <p className="mt-4">{t('help.capacity', { count: MAX_HUMAN_PLAYERS })}</p>
        </div>
      </ReactModal>
      {/*<div className="p-3 absolute top-0 right-0 z-10 text-2xl">
        <Authenticated>
          <UserButton afterSignOutUrl="/ai-town" />
        </Authenticated>

        <Unauthenticated>
          <LoginButton />
        </Unauthenticated>
      </div> */}

      <div className="town-app-shell">
        <Game />

        <footer className="town-toolbar pointer-events-none">
          <div className="flex gap-4 flex-grow pointer-events-none">
            <FreezeButton />
            <MusicButton />
            <Button href="https://github.com/haiyunw98-cloud/ai-town" imgUrl={starImg}>
              {t('app.github')}
            </Button>
            <InteractButton />
            <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>
              {t('app.help')}
            </Button>
            <LanguageButton />
          </div>
          <div className="town-credits">
            <a href="https://a16z.com"><img src={a16zImg} alt="a16z" /></a>
            <a href="https://convex.dev/c/ai-town"><img src={convexImg} alt="Convex" /></a>
          </div>
        </footer>
        <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
      </div>
    </main>
  );
}

const modalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 75%)',
    zIndex: 12,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '50%',

    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};
