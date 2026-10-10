export type Suite = 'boundary' | 'workflow' | 'desktop';
export interface Scenario {
  id: string;
  title: string;
  suite: Suite;
  requirements: string[];
  fixture: 'none' | 'scratchpad' | 'scratchpad / empty';
}

// Product rules stay in specs/. These IDs identify executable checks, not new requirements.
export const scenarios: Scenario[] = [
  { id: 'boundary-paths', title: 'Storage guards reject escapes', suite: 'boundary', requirements: ['DEV-07'], fixture: 'none' },
  { id: 'boundary-locks', title: 'Lifecycle operations serialize', suite: 'boundary', requirements: ['DEV-01'], fixture: 'none' },
  { id: 'boundary-environment', title: 'Child environments exclude credentials and injection', suite: 'boundary', requirements: ['DEV-08'], fixture: 'none' },
  { id: 'boundary-process', title: 'Forged process ownership cannot stop a process', suite: 'boundary', requirements: ['DEV-06'], fixture: 'none' },
  { id: 'verification-cli', title: 'Verification selection rejects unknown scope', suite: 'boundary', requirements: [], fixture: 'none' },
  { id: 'verification-evidence', title: 'Verification fails closed across suite processes', suite: 'boundary', requirements: ['DEV-11'], fixture: 'none' },
  { id: 'workflow-setup', title: 'Concurrent setup in real detached worktrees', suite: 'workflow', requirements: ['DEV-01', 'DEV-03'], fixture: 'scratchpad' },
  { id: 'workflow-isolation', title: 'Database and file writes stay isolated', suite: 'workflow', requirements: ['DEV-02', 'DEV-05'], fixture: 'scratchpad' },
  { id: 'workflow-restart', title: 'Repeated launch reuses the runtime and preserves data', suite: 'workflow', requirements: ['DEV-04'], fixture: 'scratchpad' },
  { id: 'workflow-desktop', title: 'Desktop state and hot reload stay isolated', suite: 'workflow', requirements: ['DEV-02', 'DEV-11'], fixture: 'scratchpad' },
  { id: 'workflow-reset', title: 'Reset clears owned state and rotates credentials', suite: 'workflow', requirements: ['DEV-07'], fixture: 'scratchpad / empty' },
  { id: 'workflow-crash', title: 'Crash recovery preserves unrelated processes', suite: 'workflow', requirements: ['DEV-03', 'DEV-06'], fixture: 'scratchpad / empty' },
  { id: 'workflow-identity', title: 'Copied workspace identity is rejected', suite: 'workflow', requirements: ['DEV-09'], fixture: 'scratchpad / empty' },
  { id: 'workflow-native', title: 'Native launcher starts and stops its desktop', suite: 'workflow', requirements: ['DEV-06'], fixture: 'scratchpad / empty' },
  { id: 'workflow-disposal', title: 'Disposal recovers from an interrupted database drop', suite: 'workflow', requirements: ['DEV-12'], fixture: 'scratchpad' },
  { id: 'workflow-config', title: 'Docker configuration changes invalidate startup cache', suite: 'workflow', requirements: ['DEV-04'], fixture: 'scratchpad / empty' },
  { id: 'workflow-recreate', title: 'Container recreation reconnects without reseeding', suite: 'workflow', requirements: ['DEV-04'], fixture: 'scratchpad / empty' },
  { id: 'workflow-cleanup', title: 'Verification disposal preserves sibling state', suite: 'workflow', requirements: ['DEV-11', 'DEV-12'], fixture: 'scratchpad / empty' },
  { id: 'scratchpad-persistence', title: 'Keyboard edits survive desktop reopening', suite: 'desktop', requirements: ['DEV-04'], fixture: 'scratchpad' },
  { id: 'scratchpad-layout', title: 'Scratchpad layout at normal and minimum window sizes', suite: 'desktop', requirements: ['DEV-11'], fixture: 'scratchpad' },
];

export function scenario(id: string) {
  const found = scenarios.find(s => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}

export function selectScenarios(profile: string, requested?: string) {
  if (!['quick', 'full'].includes(profile)) throw new Error(`Unknown profile: ${profile}; use quick or full`);
  if (!requested) return scenarios.filter(s => profile === 'full' || s.suite === 'boundary');
  const matched = scenarios.filter(s => s.id === requested || s.requirements.includes(requested));
  if (!matched.length) throw new Error(`No implemented scenario matches ${requested}; use --list`);
  // Stateful suites share ordered setup. Selection deliberately expands to the whole suite.
  const suites = new Set(matched.map(s => s.suite));
  return scenarios.filter(s => suites.has(s.suite));
}

export const manualChecks = [{
  id: 'desktop-experience',
  title: 'Native desktop behavior and scratchpad clarity',
  suites: ['workflow', 'desktop'] as Suite[],
  command: 'pnpm dev:verify --fixture scratchpad',
  steps: [
    'Keep your persistent preview open, then run the command in another terminal. Expect a clearly labeled disposable window and unchanged preview data.',
    'Save a note, add a marker, expand File and client storage checks, and enable Compact scratchpad. Expect clear save feedback and comfortably usable controls.',
    'Resize to the smallest allowed window and use Tab and Shift+Tab through the controls. Check readable content, visible focus, scrolling, and access to every action.',
    'Switch between Ash and another app or macOS Space. Check window placement and focus against your normal workflow.',
    'Press Ctrl+C in the verification terminal. Expect that window to close while the persistent preview remains usable.',
  ],
}];
