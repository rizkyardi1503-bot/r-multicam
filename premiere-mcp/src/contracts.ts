export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PluginRegistration {
  pluginName: string;
  pluginVersion: string;
  hostName?: string;
  hostVersion?: string;
  platform?: string;
  capabilities?: string[];
}

export interface BridgeCommand {
  id: string;
  name: string;
  args: Record<string, JsonValue>;
  createdAt: string;
}

export interface CommandResult {
  ok: boolean;
  result?: JsonValue;
  error?: string;
}

export interface BridgeStatus {
  connected: boolean;
  lastSeenAt: string | null;
  stateUpdatedAt: string | null;
  registration: PluginRegistration | null;
  queuedCommands: number;
  pendingCommands: number;
}
