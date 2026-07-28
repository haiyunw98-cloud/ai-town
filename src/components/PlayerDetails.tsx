import { useConvex, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import type { SelectElement } from './Player';
import { Messages } from './Messages';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import type { GameId } from '../../convex/aiTown/ids';
import type { ServerGame } from '../hooks/serverGame';
import { useI18n } from '../i18n';
import { conversationAction } from './conversationAccess';
import ResidentDossier from './ResidentDossier';
import { useEffect, useRef, useState } from 'react';
import { godModeQuickCommands, type GodModeCommandId } from './godMode';
import { waitForInput } from '../hooks/sendInput';

export default function PlayerDetails({
  worldId,
  engineId,
  game,
  playerId,
  setSelectedElement,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const { t } = useI18n();
  const convex = useConvex();
  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId });

  const players = [...game.world.players.values()];
  const humanPlayer = players.find((p) => p.human === humanTokenIdentifier);
  const humanConversation = humanPlayer ? game.world.playerConversation(humanPlayer) : undefined;
  // Always select the other player if we're in a conversation with them.
  if (!playerId && humanPlayer && humanConversation) {
    const otherPlayerIds = [...humanConversation.participants.keys()].filter(
      (p) => p !== humanPlayer.id,
    );
    playerId = otherPlayerIds[0];
  }

  const player = playerId && game.world.players.get(playerId);
  const playerConversation = player && game.world.playerConversation(player);

  const previousConversation = useQuery(
    api.world.previousConversation,
    playerId ? { worldId, playerId } : 'skip',
  );

  const playerDescription = playerId && game.playerDescriptions.get(playerId);

  const startConversation = useSendInput(engineId, 'startConversation');
  const acceptInvite = useSendInput(engineId, 'acceptInvite');
  const rejectInvite = useSendInput(engineId, 'rejectInvite');
  const leaveConversation = useSendInput(engineId, 'leaveConversation');
  const issueObserverCommand = useMutation(api.world.issueObserverCommand);
  const [commandPending, setCommandPending] = useState<GodModeCommandId>();
  const autoStartedResident = useRef<GameId<'players'>>();

  useEffect(() => {
    const alreadyTalkingToSelected = !!player && !!humanConversation?.participants.has(player.id);
    if (
      !player
      || player.human
      || !humanPlayer
      || alreadyTalkingToSelected
      || autoStartedResident.current === player.id
    ) return;
    autoStartedResident.current = player.id;
    void toastOnError(startConversation({ playerId: humanPlayer.id, invitee: player.id }))
      .catch(() => {
        autoStartedResident.current = undefined;
      });
  }, [humanConversation, humanPlayer, player, startConversation]);

  if (!playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        {t('status.selectResident')}
      </div>
    );
  }
  if (!player) {
    return null;
  }
  const isMe = humanPlayer && player.id === humanPlayer.id;
  const residentConversationHasHuman = !!playerConversation && [
    ...playerConversation.participants.keys(),
  ].some((participantId) => !!game.world.players.get(participantId)?.human);
  const inviteAction = conversationAction({
    isMe: !!isMe,
    hasHumanPlayer: !!humanPlayer,
    humanIsBusy: !!humanConversation,
    residentIsBusy: !!playerConversation,
    residentConversationHasHuman,
  });
  const canInvite = inviteAction !== 'unavailable';
  const sameConversation =
    !isMe &&
    humanPlayer &&
    humanConversation &&
    playerConversation &&
    humanConversation.id === playerConversation.id;

  const humanStatus =
    humanPlayer && humanConversation && humanConversation.participants.get(humanPlayer.id)?.status;
  const playerStatus = playerConversation && playerConversation.participants.get(playerId)?.status;

  const haveInvite = sameConversation && humanStatus?.kind === 'invited';
  const waitingForAccept =
    sameConversation && playerConversation.participants.get(playerId)?.status.kind === 'invited';
  const waitingForNearby =
    sameConversation && playerStatus?.kind === 'walkingOver' && humanStatus?.kind === 'walkingOver';

  const inConversationWithMe =
    sameConversation &&
    playerStatus?.kind === 'participating' &&
    humanStatus?.kind === 'participating';

  const onStartConversation = async () => {
    if (!humanPlayer || !playerId) {
      return;
    }
    console.log(`Starting conversation`);
    await toastOnError(startConversation({ playerId: humanPlayer.id, invitee: playerId }));
  };
  const onAcceptInvite = async () => {
    if (!humanPlayer || !humanConversation || !playerId) {
      return;
    }
    await toastOnError(
      acceptInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onRejectInvite = async () => {
    if (!humanPlayer || !humanConversation) {
      return;
    }
    await toastOnError(
      rejectInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onLeaveConversation = async () => {
    if (!humanPlayer || !inConversationWithMe || !humanConversation) {
      return;
    }
    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onCancelConversation = async () => {
    if (!humanPlayer || !humanConversation) return;
    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onObserverCommand = async (command: GodModeCommandId) => {
    if (!player || player.human || commandPending) return;
    setCommandPending(command);
    try {
      const inputId = await issueObserverCommand({
        worldId,
        engineId,
        residentId: player.id,
        command,
      });
      // The command is acknowledged as soon as it is durably queued. Its visible movement is
      // streamed back by the game; waiting for the whole engine queue here can make a busy event
      // look like the button froze even though the instruction was accepted.
      void toastOnError(waitForInput(convex, inputId)).catch(() => undefined);
    } catch {
      // toastOnError already showed the failure.
    } finally {
      setCommandPending(undefined);
    }
  };
  // const pendingSuffix = (inputName: string) =>
  //   [...inflightInputs.values()].find((i) => i.name === inputName) ? ' opacity-50' : '';

  const pendingSuffix = (_inputName: string) => '';
  return (
    <>
      <div className="flex gap-4">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {playerDescription?.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => setSelectedElement(undefined)}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      {!isMe && (
        <ResidentDossier
          worldId={worldId}
          playerId={player.id}
        />
      )}
      {!isMe && (
        <section className="god-mode-controls" aria-label="上帝模式居民指令">
          <header>
            <div><strong>上帝模式</strong><small>点击地图也可派遣这位居民</small></div>
            <span>观察者介入会写入日志</span>
          </header>
          <div>
            {godModeQuickCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                disabled={!!commandPending}
                onClick={() => void onObserverCommand(command.id)}
              >
                <span>{command.emoji}</span>
                {commandPending === command.id ? '下达中…' : command.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {canInvite && (
        <a
          className={
            'observer-action-button mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('startConversation')
          }
          onClick={() => void onStartConversation()}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>
              {t(inviteAction === 'interrupt' ? 'action.interruptConversation' : 'action.startConversation')}
            </span>
          </div>
        </a>
      )}
      {waitingForAccept && (
        <a
          className="observer-action-button mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
          onClick={() => void onCancelConversation()}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>{t('status.waitingForAccept')} · {t('action.cancelConversation')}</span>
          </div>
        </a>
      )}
      {waitingForNearby && (
        <a
          className="observer-action-button mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
          onClick={() => void onCancelConversation()}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>{t('status.walkingOver')} · {t('action.cancelConversation')}</span>
          </div>
        </a>
      )}
      {inConversationWithMe && (
        <a
          className={
            'observer-action-button mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('leaveConversation')
          }
          onClick={() => void onLeaveConversation()}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>{t('action.leaveConversation')}</span>
          </div>
        </a>
      )}
      {haveInvite && (
        <>
          <a
            className={
              'observer-action-button mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('acceptInvite')
            }
            onClick={() => void onAcceptInvite()}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>{t('action.accept')}</span>
            </div>
          </a>
          <a
            className={
              'observer-action-button mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('rejectInvite')
            }
            onClick={() => void onRejectInvite()}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>{t('action.reject')}</span>
            </div>
          </a>
        </>
      )}
      {!playerConversation && player.activity && player.activity.until > Date.now() && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center">
            {player.activity.description}
          </h2>
        </div>
      )}
      <div className="desc my-6">
        <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
          {!isMe && playerDescription?.description}
          {isMe && <i>{t('status.thisIsYou')}</i>}
          {!isMe && inConversationWithMe && (
            <>
              <br />
              <br />(<i>{t('status.conversingWithYou')}</i>)
            </>
          )}
        </p>
      </div>
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
        <>
          <Messages
            worldId={worldId}
            engineId={engineId}
            inConversationWithMe={inConversationWithMe ?? false}
            conversation={{ kind: 'active', doc: playerConversation }}
            humanPlayer={humanPlayer}
            scrollViewRef={scrollViewRef}
          />
        </>
      )}
      {!playerConversation && previousConversation && (
        <>
          <div className="box flex-grow">
            <h2 className="bg-brown-700 text-lg text-center">
              {t('status.previousConversation')}
            </h2>
          </div>
          <Messages
            worldId={worldId}
            engineId={engineId}
            inConversationWithMe={false}
            conversation={{ kind: 'archived', doc: previousConversation }}
            humanPlayer={humanPlayer}
            scrollViewRef={scrollViewRef}
          />
        </>
      )}
    </>
  );
}
