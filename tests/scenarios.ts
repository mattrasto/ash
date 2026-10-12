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
  { id: 'chat-schema', title: 'migration is additive and repeatable, and the runtime has no schema privileges', suite: 'workflow', requirements: [], fixture: 'scratchpad / empty' },
  { id: 'chat-organization', title: 'UX01/UX02 titles, archive and activity metadata preserve running conversations', suite: 'workflow', requirements: ['UX01', 'UX02'], fixture: 'scratchpad / empty' },
  { id: 'chat-delivery', title: 'C01/C05 acceptance and concurrent duplicate delivery preserve one input and one execution', suite: 'workflow', requirements: ['C01', 'C05'], fixture: 'scratchpad / empty' },
  { id: 'chat-context', title: 'C03/C04 follow-up context and inspection use the captured request', suite: 'workflow', requirements: ['C03', 'C04'], fixture: 'scratchpad / empty' },
  { id: 'chat-cancellation', title: 'C07 cancellation freezes partial output and queued cancellation has no start time', suite: 'workflow', requirements: ['C07'], fixture: 'scratchpad / empty' },
  { id: 'chat-retries', title: 'C07/C14 retries retain prior outcomes, own their requests, and select only completed answers', suite: 'workflow', requirements: ['C07', 'C14'], fixture: 'scratchpad / empty' },
  { id: 'chat-concurrency', title: 'C08 independent threads can run concurrently', suite: 'workflow', requirements: ['C08'], fixture: 'scratchpad / empty' },
  { id: 'chat-restart', title: 'C11 restart preserves completed data and interrupts undispatched work', suite: 'workflow', requirements: ['C11'], fixture: 'scratchpad / empty' },
  { id: 'chat-limits', title: 'C12 the API captures context limits and rejects oversized input', suite: 'workflow', requirements: ['C12'], fixture: 'scratchpad / empty' },
  { id: 'chat-ownership', title: 'backend ownership and crash recovery cannot silently repeat work', suite: 'workflow', requirements: ['DEV-06'], fixture: 'scratchpad / empty' },
  { id: 'chat-instructions', title: 'queued and retried requests retain the original instruction snapshot', suite: 'workflow', requirements: ['INST-R04'], fixture: 'scratchpad / empty' },
  { id: 'chat-desktop', title: 'desktop sends, inspects, preserves drafts and reconnects during generation', suite: 'workflow', requirements: ['C01', 'C03', 'C04', 'C11'], fixture: 'scratchpad / empty' },
  { id: 'images-snapshot', title: 'upload identity is idempotent, captioning is independent, and request snapshots freeze late descriptions', suite: 'workflow', requirements: ['IM03', 'IM05'], fixture: 'scratchpad / empty' },
  { id: 'images-boundaries', title: 'server rejects invalid uploads, foreign IDs and corrupt bytes before model execution', suite: 'workflow', requirements: ['IM06'], fixture: 'scratchpad / empty' },
  { id: 'images-description-retry', title: 'failed descriptions can be retried without a chat message; restart never redispatches', suite: 'workflow', requirements: ['IM03'], fixture: 'scratchpad / empty' },
  { id: 'images-cleanup', title: 'cleanup removes only unsubmitted uploads and serializes with message retention', suite: 'workflow', requirements: ['IM08'], fixture: 'scratchpad / empty' },
  { id: 'images-desktop', title: 'Electron pick/paste/drop, galleries, native actions, descriptions, draft recovery and Markdown', suite: 'workflow', requirements: ['IM01', 'IM02', 'IM07'], fixture: 'scratchpad / empty' },
  { id: 'openai-credentials', title: 'deterministic mode ignores the local key and the frontend cannot serve it', suite: 'workflow', requirements: ['DEV-08'], fixture: 'scratchpad / empty' },
  { id: 'openai-capture', title: 'captured requests, provider identifiers, usage and duplicate delivery persist', suite: 'workflow', requirements: ['C05', 'CONV-R16'], fixture: 'scratchpad / empty' },
  { id: 'openai-outcomes', title: 'incomplete output fails, retry retains frozen input, and cancellation freezes the Surface', suite: 'workflow', requirements: ['C07', 'C14', 'CONV-R16'], fixture: 'scratchpad / empty' },
  { id: 'openai-desktop', title: 'desktop renders provider usage and live-mode failures without leaking credentials', suite: 'workflow', requirements: ['CONV-R12', 'CONV-R16'], fixture: 'scratchpad / empty' },
  { id: 'openai-budget', title: 'reopen preserves saved results; reset preserves a session’s spent allowance', suite: 'workflow', requirements: ['CONV-R16'], fixture: 'scratchpad / empty' },
  { id: 'openai-interactive', title: 'interactive preview has no session cap or expiry and renders without a countdown', suite: 'workflow', requirements: ['CONV-R16'], fixture: 'scratchpad / empty' },
  { id: 'boundary-fingerprint', title: 'Deleted source files hash consistently before and after staging', suite: 'boundary', requirements: ['DEV-11'], fixture: 'none' },
  { id: 'workflow-port', title: 'Saved frontend port conflicts preserve browser storage', suite: 'workflow', requirements: ['DEV-03', 'DEV-04'], fixture: 'scratchpad' },
  { id: 'chat-persistence', title: 'Keyboard messages and drafts survive desktop reopening', suite: 'desktop', requirements: ['DEV-04'], fixture: 'scratchpad' },
  { id: 'desktop-background', title: 'Hidden windows support interaction without native focus', suite: 'desktop', requirements: ['DEV-11'], fixture: 'scratchpad' },
  { id: 'chat-layout', title: 'Conversation layout at normal and minimum window sizes', suite: 'desktop', requirements: ['DEV-11'], fixture: 'scratchpad' },
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
  title: 'Native desktop behavior and conversation clarity',
  suites: ['workflow', 'desktop'] as Suite[],
  command: 'pnpm dev:verify --fixture scratchpad',
  steps: [
    'Keep your persistent preview open, then run the command in another terminal. Expect a clearly labeled disposable window and unchanged preview data.',
    'Send a message, inspect its Artifact, leave an unsent draft and collapse the sidebar. Reopen the window; expect the conversation, draft and sidebar preference to survive.',
    'Resize to the smallest allowed window and use Tab and Shift+Tab through the controls. Check readable content, visible focus, scrolling, and access to every action.',
    'Switch between Ash and another app or macOS Space. Check window placement and focus against your normal workflow.',
    'Press Ctrl+C in the verification terminal. Expect that window to close while the persistent preview remains usable.',
  ],
}];
