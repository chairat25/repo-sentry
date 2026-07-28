export { GitError, runGit, DEFAULT_CMD_TIMEOUT_MS } from './git.js';
export type { GitErrorCode, GitResult } from './git.js';

export {
  analyzeAll,
  analyzeRepo,
  deriveState,
  DEFAULT_CONCURRENCY,
  DEFAULT_FETCH_TIMEOUT_MS,
} from './analyzer.js';

export { discoverRepos, DEFAULT_MAX_DEPTH } from './discovery.js';

export { Scheduler, DEFAULT_INTERVAL_MS } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';

export { isStale } from './types.js';
export type { AnalyzeOptions, RepoState, RepoStatus } from './types.js';

export {
  blockRepo,
  markerDir,
  markerPath,
  readBlocked,
  unblockRepo,
  MARKER_DIR,
  MARKER_FILE,
} from './marker.js';
export type { BlockedRepo } from './marker.js';
