/**
 * ini-section-inheritance-resolver
 *
 * Public entry point. Re-exports parseINI and the typed errors from core.
 * Keeping index.js thin means core.js is self-contained and independently
 * testable; index.js exists solely so consumers can import a single path.
 */
import { parseINI, InheritanceCycleError, UnknownParentError } from './core.js';

export { parseINI, InheritanceCycleError, UnknownParentError };
