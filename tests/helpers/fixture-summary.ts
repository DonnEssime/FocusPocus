import type { Session } from '../../src/core/session';
import { allBlocks } from '../../src/modules/timetrack/blocks';
import type { TimetrackState } from '../../src/modules/timetrack';

/** A readable, format-independent summary of a vault's state, compared against frozen fixtures. */
export function summarize(session: Session) {
  const tt = session.getState<TimetrackState>('timetrack');
  return {
    commands: session.runner.commands().length,
    issues: session.runner.issues(),
    timetrack: {
      dayWindow: tt.dayWindow,
      runningId: tt.runningId,
      tags: tt.tagOrder.map((id) => tt.tags[id]),
      blocks: [...allBlocks(tt.blocks)].map((b) => ({
        ...b,
        start: new Date(b.startMs).toISOString(),
        end: b.endMs === null ? null : new Date(b.endMs).toISOString(),
      })),
    },
    focus: session.getState('focus'),
    app: session.getState('app'),
  };
}
