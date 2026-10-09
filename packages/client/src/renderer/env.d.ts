export {};
declare global {
  interface Window { ashPreferences: { getCompact(): Promise<boolean>; setCompact(value: boolean): Promise<void> } }
}
