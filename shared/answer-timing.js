const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400000;

// These are saved provider-call durations, not transcription, audio synthesis,
// first-audio timing, or proof that a clinical check was accurate.
export function answerTimingText(message) {
  const author = message?.ai, review = message?.aiReview;
  if (!author || author.imported || author.clientReported || author.endpoint === 'realtime'
      || message.importedEvidence || !valid(author.latencyMs)) return '';
  if (!review) return `Writing ${(author.latencyMs / 1000).toFixed(1)} s`;
  if (review.imported || review.clientReported || review.endpoint === 'realtime' || !valid(review.latencyMs)) return '';
  return `Writing ${(author.latencyMs / 1000).toFixed(1)} s · Checking ${(review.latencyMs / 1000).toFixed(1)} s`;
}
