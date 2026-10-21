# Read-only filesystem tools

Implemented · [Behavior](../../specs/features/tools.md#initial-filesystem-tools) · [Shared execution](tools.md)

## Configure filesystem access

For the persistent preview, create an ignored `.ash-tools.json` in the checkout. Disposable verification/test instances read optional configuration from their own instance root; they never inherit preview grants. Paths must be canonical absolute paths. Without configuration, `loadFilesystemConfig(configurationDirectory, codeDirectory)` supplies read-only access to the current Ash checkout, as an editable Permission under [PERM-R07](../../specs/features/permissions.md#permission-behavior). The runtime default excludes Git metadata, dependencies, runtime/build data and the credential filename patterns below. Explicit exact/ancestor configuration owns its complete operation set; narrower scopes still restrict subtrees. Other directories need explicit configuration. Offline demonstrations advertise filesystem tools for filesystem requests; ordinary offline chat retains its streaming and cancellation behavior. Live models see all available scopes. The loader without a code-directory argument retains empty-scope behavior for standalone adapters. Every scope explicitly lists its operations; the most-specific scope governs an operation, and ancestor name exclusions remain in force. An empty operation list denies that subtree. Configuration is reread at dispatch and during traversal; captured descriptions never override current access.

Malformed configuration or unavailable scope paths disable filesystem tools without rejecting chat. The request captures a safe `scope_configuration` diagnostic, shown in tool progress and inspection and supplied to the model. Repair the configuration before a new request; saved records retain the earlier limitation. If configuration becomes invalid after capture, current authorization denies the call with configuration revision `unavailable`.

```json
{
  "version": 1,
  "scopes": [{
    "path": "/absolute/path/to/selected/source",
    "operations": ["list", "read", "glob", "search"],
    "excludedNames": [".git", ".ash-dev", "node_modules", ".env*", "*.pem", "*.key"]
  }]
}
```

Returned content is stored with the Run and sent to its configured model. Use synthetic fixtures or deliberately selected source; development grants must exclude credential stores and runtime data. The example exclusions are configuration for this environment, not Ash's eventual protected-resource defaults. Configuration defines the runtime ceiling; [Permissions in Settings](permissions.md#current-implementation) can narrow that access or require a Decision. Edits and retired rules survive startup without reseeding. Inspection captures both capability checks and Permission evaluations.

Read accepts `startLine` and `maxLines`; glob supports `*`, `**` and `?`; search uses literal text with an optional path pattern. Patterns are relative to the canonical traversal root, including when the requested root is an internal symlink. `**/` matches zero or more directories at any position: `src/**/*.ts` includes `src/index.ts` and deeper files. Traversal checks canonical destinations and compares opened-file identities before returning content. Changes during a read fail or produce explicit omissions. These checks provide trusted local application enforcement, not an OS sandbox against hostile processes under the same account.

The [execution limits](../plans/inspectable-tools-tests.md#execution-limits) bound reads, traversal and access-check evidence. Handlers return bounded excerpts with omissions or structured errors when a limit prevents completion. A byte cap may omit an incomplete UTF-8 character at the end of a captured prefix; malformed bytes within that prefix or at the end of a complete file remain unsupported.

## Verification

`tests/integration/filesystem-tools.test.ts` covers TOOL-01, 03–05, 15–16, 19–21, 24: filesystem validation, result/scan limits, scoped reads, configuration recovery, recursive patterns, internal symlink roots, UTF-8 truncation, live observations, hidden Electron inspection, repeated/opaque source IDs and backend restart. Generic dispatch and provider checks remain in `tests/integration/tools.test.ts`.
