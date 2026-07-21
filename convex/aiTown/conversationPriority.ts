export function canHumanPreemptConversation(
  requesterIsHuman: boolean,
  conversationHasHuman: boolean,
) {
  return requesterIsHuman && !conversationHasHuman;
}

export function canHumanReplaceConversation(requesterIsHuman: boolean, sameInvitee: boolean) {
  return requesterIsHuman && !sameInvitee;
}

export function shouldAutoAcceptHumanInvite(requesterIsHuman: boolean, inviteeIsAgent: boolean) {
  return requesterIsHuman && inviteeIsAgent;
}

export function shouldEnterConversationImmediately(
  requesterIsHuman: boolean,
  inviteeIsAgent: boolean,
) {
  return requesterIsHuman && inviteeIsAgent;
}
