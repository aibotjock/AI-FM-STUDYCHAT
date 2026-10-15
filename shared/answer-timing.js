const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400000;

// These are saved provider-call durations, not transcription, audio synthesis,
// first-audio timing, or proof that a clinical check was accurate.
export function answerTimingText(message) {
  const author = message?.ai, review = message?.aiReview;
  if (!author || !review || author.imported || review.imported || author.clientReported || review.clientReported
      || author.endpoint === 'realtime' || review.endpoint === 'realtime'
      || message.importedEvidence || !valid(author.latencyMs) || !valid(review.latencyMs)) return '';
  return `Writing ${(author.latencyMs / 1000).toFixed(1)} s · Checking ${(review.latencyMs / 1000).toFixed(1)} s`;
}
