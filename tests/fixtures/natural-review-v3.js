// Provider fixtures choose immutable IDs from the production v3 review prompt.
// Pure legacy/v2 unit fixtures retain their own helper and protocol coverage.
export function providerReviewContext(body) {
  const prompt = typeof body.system === 'string' ? body.system : typeof body.instructions === 'string' ? body.instructions : body.messages.find(message => message.content.includes('NATURAL_REVIEW_DATA=')).content;
  return JSON.parse(prompt.split('NATURAL_REVIEW_DATA=')[1].split('\n')[0]);
}

export function sourceSpanSupport(body, chunkId) {
  const span = providerReviewContext(body).sourceSpans.find(span => span.chunkId === chunkId);
  if (!span) throw new Error(`The synthetic provider has no authorized source span for ${chunkId}.`);
  return { chunkId, spanId: span.spanId };
}

// Callers explicitly supply known social/preference questions, rather than
// treating every question in a medical conversation as harmless by default.
export function conversationQuestions(...quotes) {
  return quotes.map(quote => ({ quote, kind: 'conversation', recallSpanId: null }));
}
