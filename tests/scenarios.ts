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
  { id: 'combined-context', title: 'Topic and filesystem context coexist with independent scope and availability', suite: 'workflow', requirements: ['CTX-R03','CTX-R04','TOOL-R02','TOOL-A11'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-01', title: 'Multi-round filesystem answer and captured source citations', suite: 'workflow', requirements: ['TOOL-A01'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-03', title: 'Filesystem operations enforce canonical scopes', suite: 'workflow', requirements: ['TOOL-A02'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-04', title: 'Revoked and absent configuration grants no access', suite: 'workflow', requirements: ['TOOL-A03'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-05', title: 'Live observations and retries preserve older evidence', suite: 'workflow', requirements: ['TOOL-A04'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-15', title: 'Hidden Electron tool progress, citations and inspection', suite: 'workflow', requirements: ['TOOL-R06'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-16', title: 'Actual backend restart retains saved tool records', suite: 'workflow', requirements: ['TOOL-A09'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-19', title: 'Unavailable filesystem configuration preserves chat and captured diagnostics', suite: 'workflow', requirements: ['TOOL-R02', 'TOOL-A03'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-20', title: 'Recursive patterns and internal symlink roots return eligible files', suite: 'workflow', requirements: ['TOOL-A02'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-21', title: 'UTF-8 truncation preserves readable prefixes and rejects malformed text', suite: 'workflow', requirements: ['TOOL-A05'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-24', title: 'Captured source citations stay unique across calls and opaque source IDs', suite: 'workflow', requirements: ['TOOL-R05', 'TOOL-R07'], fixture: 'scratchpad / empty' },
  { id:'topic-tool-integration',title:'Captured Topic retrieval uses the shared dispatcher and provider contract',suite:'workflow',requirements:['CTX-R03','CTX-R06','CTX-R07','CTX-R08'],fixture:'scratchpad / empty' },
  { id: 'TOOL-02', title: 'Invalid calls never execute', suite: 'workflow', requirements: ['TOOL-A05'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-06', title: 'Oversized and unsupported results are explicit', suite: 'workflow', requirements: ['TOOL-A05'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-07', title: 'Cancellation reaches parallel work and prevents queued dispatch', suite: 'workflow', requirements: ['TOOL-A06'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-08', title: 'Duplicate delivery preserves one execution', suite: 'workflow', requirements: ['TOOL-A08'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-09', title: 'Run limits stop dispatch with retained evidence', suite: 'workflow', requirements: ['TOOL-R09'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-10', title: 'Restart boundaries never replay work', suite: 'workflow', requirements: ['TOOL-A07'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-11', title: 'Stateless provider continuation preserves call identities', suite: 'workflow', requirements: ['TOOL-R08'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-12', title: 'Incomplete provider output never dispatches tools', suite: 'workflow', requirements: ['TOOL-R09'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-13', title: 'Private continuation never reaches public inspection', suite: 'workflow', requirements: ['TOOL-R07'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-14', title: 'Historical readers and immutable storage remain valid', suite: 'workflow', requirements: ['TOOL-R08'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-17', title: 'Parallel results retain proposal order', suite: 'workflow', requirements: ['TOOL-A10'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-18', title: 'Independent retrieval services share the dispatcher', suite: 'workflow', requirements: ['TOOL-A11'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-22', title: 'Byte reservations wait without aborting valid work', suite: 'workflow', requirements: ['TOOL-R09', 'TOOL-A06', 'TOOL-A10'], fixture: 'scratchpad / empty' },
  { id: 'TOOL-23', title: 'Excessive argument nesting returns an error without stopping valid calls', suite: 'workflow', requirements: ['TOOL-A05'], fixture: 'scratchpad / empty' },
  { id:'topics-settings-desktop',title:'Settings preserve ownership and unsaved drafts',suite:'desktop',requirements:['TOP-R01','TOP-R02','TOP-R04','INST-R07','INST-R09'],fixture:'scratchpad' },
  { id:'context-inspection-desktop',title:'Captured context remains inspectable after edits',suite:'desktop',requirements:['CTX-R08','CTX-R09'],fixture:'scratchpad' },
  { id:'topics-organization',title:'Manual Topics and membership preserve threads',suite:'workflow',requirements:['TOP-R01','TOP-R02','TOP-R03','TOP-R04'],fixture:'scratchpad / empty' },
  { id:'instructions-editing',title:'Instruction ownership and concurrent saves remain independent',suite:'workflow',requirements:['INST-R01','INST-R02','INST-R03','INST-R07','INST-R09'],fixture:'scratchpad / empty' },
  { id:'instructions-applicability',title:'Only applicable response instructions enter context',suite:'workflow',requirements:['INST-R05','INST-R06','INST-R09'],fixture:'scratchpad / empty' },
  { id:'context-snapshots',title:'Queued and retried requests preserve accepted context',suite:'workflow',requirements:['INST-R04','CTX-R06'],fixture:'scratchpad / empty' },
  { id:'topic-retrieval',title:'Topic retrieval selects eligible message excerpts',suite:'workflow',requirements:['CTX-R02','CTX-R03'],fixture:'scratchpad / empty' },
  { id:'topic-isolation',title:'Captured Topic scope cannot expand during execution',suite:'workflow',requirements:['CTX-R04','CTX-R07'],fixture:'scratchpad / empty' },
  { id:'context-limits',title:'Bounded selection retains compact factual metadata',suite:'workflow',requirements:['CTX-R05','CTX-R09'],fixture:'scratchpad / empty' },
  { id:'context-compatibility',title:'Legacy context and ownership survive reopening',suite:'workflow',requirements:['CTX-R06','CTX-R08'],fixture:'scratchpad / empty' },
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
  { id: 'chat-organization', title: 'UX01/UX02 titles, archive and activity metadata preserve running threads', suite: 'workflow', requirements: ['UX01', 'UX02'], fixture: 'scratchpad / empty' },
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
  { id: 'openai-interactive', title: 'preview defaults to live, retains its session on restart and requires explicit offline mode', suite: 'workflow', requirements: ['CONV-R16'], fixture: 'scratchpad / empty' },
  { id: 'boundary-fingerprint', title: 'Deleted source files hash consistently before and after staging', suite: 'boundary', requirements: ['DEV-11'], fixture: 'none' },
  { id: 'workflow-port', title: 'Saved frontend port conflicts preserve browser storage', suite: 'workflow', requirements: ['DEV-03', 'DEV-04'], fixture: 'scratchpad' },
  { id: 'chat-persistence', title: 'Keyboard messages and drafts survive desktop reopening', suite: 'desktop', requirements: ['DEV-04'], fixture: 'scratchpad' },
  { id: 'desktop-background', title: 'Hidden windows support interaction without native focus', suite: 'desktop', requirements: ['DEV-11'], fixture: 'scratchpad' },
  { id: 'chat-layout', title: 'Thread layout at normal and minimum window sizes', suite: 'desktop', requirements: ['DEV-11'], fixture: 'scratchpad' },
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
  title: 'Native desktop behavior and thread clarity',
  suites: ['workflow', 'desktop'] as Suite[],
  command: 'pnpm dev:verify --fixture scratchpad',
  steps: [
    'Keep your persistent preview open, then run the command in another terminal. Expect a clearly labeled disposable window and unchanged preview data.',
    'Send a message, inspect its Artifact, leave an unsent draft and collapse the sidebar. Reopen the window; expect the thread, draft and sidebar preference to survive.',
    'Resize to the smallest allowed window and use Tab and Shift+Tab through the controls. Check readable content, visible focus, scrolling, and access to every action.',
    'Switch between Ash and another app or macOS Space. Check window placement and focus against your normal workflow.',
    'Press Ctrl+C in the verification terminal. Expect that window to close while the persistent preview remains usable.',
  ],
}];
