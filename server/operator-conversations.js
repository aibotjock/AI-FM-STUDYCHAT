// Operator records remain durable for paid-request idempotency but stay out of
// the learner's chat, backup and default conversation selection.
const protocols = new Map([
  ['Operator source check · synthetic board study', new Set(['study-source-selector-source-v1-gpt-4.1-mini'])],
  ['Operator conversation check · synthetic study', new Set(['study-dialogue-v1-plan-gpt-4.1-mini', 'study-dialogue-v1-followup-gpt-4.1-mini', 'study-dialogue-v2-followup-gpt-4.1-mini', 'study-dialogue-v3-followup-gpt-4.1-mini'])],
  ['Operator natural conversation check · synthetic study', new Set(['natural-dialogue-v1-hello-gpt-4.1-mini', 'natural-dialogue-v1-context-gpt-4.1-mini', 'natural-dialogue-v1-study-gpt-4.1-mini'])],
]);

export function isOperatorTitle(title) { return protocols.has(title); }

export function isOperatorConversation(conversation) {
  const protocol = protocols.get(conversation?.title);
  if (!protocol || !Array.isArray(conversation.messages)) return false;
  const users = conversation.messages.filter(message => message?.role === 'user');
  if (conversation.internalCheck === true) return users.every(message => protocol.has(message.requestId));
  // Older checks predate the server marker. Require the exact reserved title
  // plus all known protocol identities; a similarly named learner chat stays.
  return users.length > 0 && users.every(message => protocol.has(message.requestId)) &&
    !conversation.messages.some(message => message?.importedEvidence || message?.ai?.imported);
}

export function learnerState(state) {
  return { ...state, conversations: state.conversations.filter(conversation => !isOperatorConversation(conversation)) };
}

export function preserveOperatorConversations(current, imported) {
  const operators = current.conversations.filter(isOperatorConversation);
  const reservedIds = new Set(operators.map(conversation => conversation.id));
  if (imported.conversations.some(conversation => reservedIds.has(conversation.id) || isOperatorTitle(conversation.title))) throw new Error('A learner backup cannot replace internal check records.');
  if (operators.length + imported.conversations.length > 500) throw new Error('The combined conversation limit has been reached.');
  return { ...imported, conversations: [...imported.conversations, ...operators] };
}
