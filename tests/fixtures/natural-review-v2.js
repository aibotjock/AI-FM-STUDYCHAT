// Provider fixtures choose immutable IDs from the actual server review prompt.
// Legacy persisted-review fixtures retain exact excerpts and do not use this helper.
export function providerReviewContext(body) {
  const prompt = typeof body.system === 'string' ? body.system : typeof body.instructions === 'string' ? body.instructions : body.messages.find(message => message.content.includes('NATURAL_REVIEW_DATA=')).content;
  return JSON.parse(prompt.split('NATURAL_REVIEW_DATA=')[1]);
}

export function sourceSpanSupport(body, chunkId) {
  const span = providerReviewContext(body).sourceSpans.find(span => span.chunkId === chunkId);
  if (!span) throw new Error(`The synthetic provider has no authorized source span for ${chunkId}.`);
  return { chunkId, spanId: span.spanId };
}
