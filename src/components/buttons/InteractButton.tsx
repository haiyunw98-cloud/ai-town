import Button from './Button';
import interactImg from '../../../assets/interact.svg';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
// import { SignInButton } from '@clerk/clerk-react';
import { useServerGame } from '../../hooks/serverGame';

export default function InteractButton() {
  // const { isAuthenticated } = useConvexAuth();
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const game = useServerGame(worldId);
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const userPlayerId =
    game && [...game.world.players.values()].find((p) => p.human === humanTokenIdentifier)?.id;
  const isPlaying = !!userPlayerId;
  // if (!isAuthenticated || game === undefined) {
  //   return (
  //     <SignInButton>
  //       <Button imgUrl={interactImg}>Interact</Button>
  //     </SignInButton>
  //   );
  // }
  return (
    <Button imgUrl={interactImg}>
      {isPlaying ? '上帝模式' : '正在接入'}
    </Button>
  );
}
