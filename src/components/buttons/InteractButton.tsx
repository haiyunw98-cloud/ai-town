import Button from './Button';
import { toast } from 'react-toastify';
import interactImg from '../../../assets/interact.svg';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
// import { SignInButton } from '@clerk/clerk-react';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../convex/_generated/dataModel';
import { useCallback } from 'react';
import { waitForInput } from '../../hooks/sendInput';
import { useServerGame } from '../../hooks/serverGame';
import { useI18n } from '../../i18n';

export default function InteractButton() {
  const { t } = useI18n();
  // const { isAuthenticated } = useConvexAuth();
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const game = useServerGame(worldId);
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const userPlayerId =
    game && [...game.world.players.values()].find((p) => p.human === humanTokenIdentifier)?.id;
  const join = useMutation(api.world.joinWorld);
  const leave = useMutation(api.world.leaveWorld);
  const isPlaying = !!userPlayerId;

  const convex = useConvex();
  const joinInput = useCallback(
    async (worldId: Id<'worlds'>) => {
      let inputId;
      try {
        inputId = await join({ worldId });
      } catch (error: unknown) {
        if (error instanceof ConvexError) {
          toast.error(String(error.data));
          return;
        }
        throw error;
      }
      try {
        await waitForInput(convex, inputId);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [convex],
  );

  const joinOrLeaveGame = () => {
    if (
      !worldId ||
      // || !isAuthenticated
      game === undefined
    ) {
      return;
    }
    if (isPlaying) {
      console.log(`Leaving game for player ${userPlayerId}`);
      void leave({ worldId });
    } else {
      console.log(`Joining game`);
      void joinInput(worldId);
    }
  };
  // if (!isAuthenticated || game === undefined) {
  //   return (
  //     <SignInButton>
  //       <Button imgUrl={interactImg}>Interact</Button>
  //     </SignInButton>
  //   );
  // }
  return (
    <Button imgUrl={interactImg} onClick={joinOrLeaveGame}>
      {t(isPlaying ? 'action.leaveTown' : 'action.interact')}
    </Button>
  );
}
