/** The inventory describes loaded topics, never the clinical content of a source. */
export function buildLibraryContext(references, { referenceDirectory } = {}) {
  const available = typeof references?.inventory === 'function';
  const topics = available ? references.inventory().map(topic => [topic.id, topic.title, topic.recordType, topic.current]) : [];
  const directoryAvailable = Array.isArray(referenceDirectory?.sources);
  const directorySources = directoryAvailable ? referenceDirectory.sources.map(source => [source.id, source.title, source.referenceType]) : [];
  return { scope: 'catalogue-metadata-only', available, total: available ? topics.length : null, current: available ? topics.filter(topic => topic[3]).length : null,
    topicColumns: ['id', 'title', 'recordType', 'current'], topics,
    directory: { scope: 'external-links-only', available: directoryAvailable, total: directoryAvailable ? directorySources.length : null, contentSupplied: false,
      columns: ['id', 'title', 'referenceType'], sources: directorySources } };
}
