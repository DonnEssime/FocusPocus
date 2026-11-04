import type { MessageCatalog } from './types';

/** Failure reasons produced by the command kernel and the vault. */
export const coreCatalog = {
  'core.invalidCommand': { en: 'This command is malformed.' },
  'core.duplicateCommandId': { en: 'A command with this id already exists.' },
  'core.missingDependency': { en: 'This command depends on {dep}, which is not in the log.' },
  'core.unknownCommand': { en: 'Unknown command type "{type}".' },
  'core.clockOutOfOrder': { en: 'This command is older than the latest command in the log.' },
  'core.invalidUndoTarget': { en: 'That step can no longer be undone or redone.' },
  'core.nothingToUndo': { en: 'Nothing to undo.' },
  'core.nothingToRedo': { en: 'Nothing to redo.' },
  'core.readOnly': { en: 'This vault is open read-only.' },
  'core.batchEmpty': { en: 'A batch must contain at least one command.' },
  'core.batchMixedScopes': { en: 'A batch cannot mix commands from different modules.' },
} as const satisfies MessageCatalog;
