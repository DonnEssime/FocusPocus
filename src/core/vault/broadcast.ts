import type { Command } from '../command/types';

/** Messages exchanged between windows of the same browser that have the same vault open. */
export type SyncMessage =
  | { kind: 'hello'; from: string }
  | { kind: 'commands'; from: string; cmds: Command[] };

export interface BroadcastPort {
  post(message: SyncMessage): void;
  onMessage(listener: (message: SyncMessage) => void): () => void;
  close(): void;
}

/** BroadcastChannel-backed port (available in browsers and Node). One channel per vault. */
export function createBroadcastChannelPort(vaultId: string): BroadcastPort {
  const channel = new BroadcastChannel(`focuspocus:${vaultId}`);
  return {
    post: (message) => channel.postMessage(message),
    onMessage(listener) {
      const handler = (event: MessageEvent) => listener(event.data as SyncMessage);
      channel.addEventListener('message', handler as EventListener);
      return () => channel.removeEventListener('message', handler as EventListener);
    },
    close: () => channel.close(),
  };
}
