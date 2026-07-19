import { useApp } from '@pixi/react';
import { useEffect, useState } from 'react';
import { rendererShouldRun } from './rendererRuntime';

export default function PixiRuntimeGate({ worldStatus }: { worldStatus?: string }) {
  const app = useApp();
  const [visibility, setVisibility] = useState(() => document.visibilityState);

  useEffect(() => {
    const update = () => setVisibility(document.visibilityState);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (rendererShouldRun(worldStatus, visibility)) {
      app.ticker.start();
      return;
    }
    app.render();
    app.ticker.stop();
  }, [app, visibility, worldStatus]);

  return null;
}
