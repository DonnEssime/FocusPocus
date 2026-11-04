import type { MessageCatalog } from './types';

/** Strings used by the web shell (vault picker, header, footer, layout). */
export const shellCatalog = {
  'shell.appName': { en: 'FocusPocus' },
  'shell.theme.dark': { en: 'Dark' },
  'shell.picker.intro': {
    en: 'All your data lives in a vault folder on this computer. Put it in a synced folder (e.g. Google Drive) to use it on several computers.',
  },
  'shell.picker.choose': { en: 'Open or create a vault folder…' },
  'shell.picker.chooseHint': { en: 'Pick an existing vault, or an empty folder to create a new one.' },
  'shell.picker.reopen': { en: 'Reopen “{name}”' },
  'shell.picker.chooseOther': { en: 'Choose another vault…' },
  'shell.picker.unsupported': {
    en: 'This browser cannot open folders on disk. Please use a recent desktop version of Chrome or Edge.',
  },
  'shell.picker.embedded': {
    en: 'This page is shown inside another app (for example VS Code’s built-in browser), which cannot open folders on disk. Open it directly in Chrome or Edge.',
  },
  'shell.picker.notAVault': {
    en: 'That folder is not empty and is not a FocusPocus vault. Pick an existing vault or an empty folder.',
  },
  'shell.picker.permissionDenied': { en: 'Permission to use the folder was not granted.' },
  'shell.picker.openFailed': { en: 'The vault could not be opened: {error}' },
  'shell.picker.loading': { en: 'Opening vault…' },
  'shell.picker.step.picking': { en: 'Waiting for the folder dialog…' },
  'shell.picker.step.permission': { en: 'Checking permission to edit the folder…' },
  'shell.picker.step.inspecting': { en: 'Reading the folder…' },
  'shell.picker.step.creating': { en: 'Creating a new vault…' },
  'shell.picker.step.loading': { en: 'Loading the vault…' },
  'shell.picker.cancelled': {
    en: 'No folder was opened. If Chrome asked whether this site may edit files in the folder, choose “Edit files”.',
  },
  'shell.undo': { en: 'Undo' },
  'shell.settings': { en: 'Settings' },
  'shell.close': { en: 'Close' },
  'shell.redo': { en: 'Redo' },
  'shell.panel.history': { en: 'History' },
  'shell.unknownPanel': { en: 'Unknown panel “{id}”.' },
  'shell.status.saved': { en: 'All changes saved' },
  'shell.status.pending': { en: 'Saving…' },
  'shell.status.error': { en: 'Could not save to the vault, retrying…' },
  'shell.status.readOnly.newerFormat': {
    en: 'This vault was written by a newer version of FocusPocus. It is open read-only.',
  },
  'shell.status.readOnly.newerData': {
    en: 'Another computer is using a newer version of FocusPocus. This window is now read-only.',
  },
  'shell.status.reload': { en: 'Reload' },
  'shell.status.rejected': { en: '{count} conflicting change(s) were skipped' },
  'shell.status.vault': { en: 'Vault: {name}' },
  'shell.status.closeVault': { en: 'Close vault' },
} as const satisfies MessageCatalog;
