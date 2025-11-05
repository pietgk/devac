# Session Documentation

This directory contains chronological documentation of development sessions, decisions, and implementations for the CodeGraph project.

## Naming Convention

All session files follow this pattern:
```
NNN-lower-kebab-case.md
```

Where:
- `NNN` = 3-digit sequential number (001, 002, 003, etc.)
- `lower-kebab-case` = descriptive name in lowercase with hyphens
- `.md` = Markdown format

## Examples

- ✅ `021-streaming-architecture.md`
- ✅ `022-neo4j-optimization.md`
- ✅ `023-performance-improvements.md`
- ❌ `STREAMING_ARCHITECTURE.md` (wrong case and location)
- ❌ `streaming_architecture.md` (wrong separator)

## Adding New Sessions

When documenting a new session:

1. **Find the next number**: Check the highest numbered file and add 1
2. **Use kebab-case**: Convert your title to lowercase with hyphens
3. **Create in this directory**: Always create in `docs/sessions/`

```bash
# Example: Creating session 021
cd /Users/grop/ws/CodeGraph
touch docs/sessions/021-your-session-title.md
```

## Session Index

| Number | Title | Date | Topic |
|--------|-------|------|-------|
| 001 | update-entity-id | 2024 | Initial entity ID implementation |
| 002 | cli | 2024 | CLI implementation |
| 003 | implementation-guide | Nov 3, 2025 | Implementation guide |
| 004 | enhancement-summary | Nov 3, 2025 | Enhancement summary |
| 005 | implementation-complete | Nov 3, 2025 | Implementation completion |
| 006 | c4-queries-validated | Nov 3, 2025 | C4 query validation |
| 007 | implementation-success | Nov 3, 2025 | Success report |
| 008 | future-improvements-plan | Nov 3, 2025 | Future improvements planning |
| 009 | implementation-summary | Nov 3, 2025 | Implementation summary |
| 010 | workspace-cli-implementation | Nov 4, 2025 | Workspace CLI feature |
| 011 | implementation-monorepo-fix | Nov 4, 2025 | Monorepo parsing fix |
| 012 | critical-fix-python-timeout | Nov 4, 2025 | Python timeout fix |
| 013 | complete-solution-summary | Nov 4, 2025 | Complete solution summary |
| 014 | memory-fix-solution | Nov 4, 2025 | Memory management fix |
| 015 | live-sync-architecture-spec | Nov 4, 2025 | Live sync architecture |
| 016 | ts-morph-performance-analysis | Nov 5, 2025 | ts-morph performance research |
| 017 | batch-size-test-results | Nov 5, 2025 | Batch size optimization tests |
| 018 | per-file-parsing-test-results | Nov 5, 2025 | Per-file parsing approach |
| 019 | tsconfig-fix-success | Nov 5, 2025 | Root tsconfig issue fix |
| 020 | per-package-tsconfig-implementation | Nov 5, 2025 | Per-package tsconfig solution |

## Root Directory Files

Only these files should remain in the project root:
- `README.md` - Main project documentation
- `CLAUDE.md` - Agent OS instructions
- `QUICK_START.md` - Quick start guide for users

All other session/implementation docs belong in `docs/sessions/`.
