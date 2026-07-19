export function rendererShouldRun(worldStatus: string | undefined, visibility: string) {
  return worldStatus === 'running' && visibility === 'visible';
}
