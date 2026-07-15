export function canHumanPreemptConversation(
  requesterIsHuman: boolean,
  conversationHasHuman: boolean,
) {
  return requesterIsHuman && !conversationHasHuman;
}

export function shouldAutoAcceptHumanInvite(requesterIsHuman: boolean, inviteeIsAgent: boolean) {
  return requesterIsHuman && inviteeIsAgent;
}
