export type DatabaseAddress = { host: string; port: number };
export type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  log?: (message: string) => void;
  probe?: (address: DatabaseAddress) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export function databaseAddress(url: unknown): DatabaseAddress | null;
export function databaseAnswers(address: DatabaseAddress, timeoutMs?: number): Promise<boolean>;
export function waitForDatabase(url: unknown, options?: WaitOptions): Promise<boolean>;
