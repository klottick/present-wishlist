export function requiresOwnedGroupCleanup(exitCode: number | null, gracefulWaitTimedOut: boolean): boolean {
  return gracefulWaitTimedOut || (exitCode !== null && exitCode !== 0)
}
