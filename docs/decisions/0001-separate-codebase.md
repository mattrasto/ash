# 0001: Separate Ash codebase

Accepted by the user, 2026-10-09. Resolves G01.

Ash has its own source, configuration and database history so its artifact and recovery requirements can drive the design. Evaluate Asha components individually for reuse. Shared runtime data and migration of personal data require separate scope.
