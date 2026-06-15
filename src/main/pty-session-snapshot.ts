import { PtySession } from './pty-manager';
import { PtySessionSnapshot } from './pty-backend';

export function toPtySessionSnapshot(session: PtySession): PtySessionSnapshot {
  return {
    id: session.id,
    buffer: session.buffer,
    rawBuffer: session.rawBuffer,
    title: session.title,
    titleLocked: session.titleLocked,
    titleGenerated: session.titleGenerated,
    cwd: session.cwd,
    presetCommand: session.presetCommand,
    themeId: session.themeId,
    provider: session.provider,
    createdAt: session.createdAt,
    resumeId: session.resumeId,
    resumeCommand: session.resumeCommand,
    exitState: (session.ptyProcess as any).exitState,
  };
}

