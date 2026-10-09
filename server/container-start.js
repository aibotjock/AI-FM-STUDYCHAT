import { initializeContainer } from './container-init.js';
try {
  const identity = initializeContainer();
  console.log(`Container ownership initialized. Application UID=${identity.uid} GID=${identity.gid}.`);
  await import('./start.js');
} catch (error) {
  console.error(`Container startup refused: ${error.message}`);
  process.exit(1);
}
