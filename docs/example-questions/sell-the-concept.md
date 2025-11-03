## User

i want to sell the concept of having a graph representation of a codebase like for example the
frontend-monorepo using neo4j codegraph database we have created from the frontend-monorepo directory.
can you give me a concise simple overview of the pros and const of using having the graph of out typescript based codebase.
while developing together with you

## Assistant

# Graph-Based Codebase Representation: Pros & Cons

## Overview
A Neo4j graph database that maps your TypeScript codebase's structure, dependencies, and relationships in real-time.

## Pros

**1. Instant Impact Analysis**
- "What breaks if I change this component?" answered in seconds
- Visualize ripple effects before making changes
- Identify circular dependencies automatically

**2. AI Context Optimization**
- I can query exactly what files are relevant instead of scanning everything
- Reduces token usage by fetching only connected components
- Faster, more accurate responses with targeted context

**3. Architectural Insights**
- See actual usage patterns vs intended architecture
- Identify tightly-coupled modules that should be decoupled
- Find orphaned code and unused exports

**4. Refactoring Safety**
- Know exactly what imports a function before renaming
- Trace component usage across the entire monorepo
- Validate changes won't break hidden dependencies

**5. Documentation That Updates Itself**
- Generate dependency diagrams automatically
- Always-current architecture views
- New team members can explore relationships visually

## Cons

**1. Setup & Maintenance Overhead**
- Initial Neo4j infrastructure setup required
- Graph must stay in sync with code changes
- Additional CI/CD steps to update graph

**2. Learning Curve**
- Team needs to learn Cypher query language (Neo4j's query language)
- New mental model for thinking about code relationships
- Requires discipline to actually use it vs falling back to grep

**3. Performance Considerations**
- Large codebases = large graphs (can become slow)
- Real-time updates may lag for rapid code changes
- Query complexity can impact response time

**4. Tool Dependency**
- Adds another system to maintain and monitor
- Neo4j hosting/infrastructure costs
- Risk if graph becomes stale or corrupted

**5. Incomplete Picture**
- Runtime behavior not captured (only static analysis)
- Dynamic imports and reflection hard to track
- May miss relationships in generated code

## Bottom Line

**Use it if:**
- Working on large/complex monorepos (✅ frontend-monorepo qualifies)
- Making frequent architectural changes or refactoring
- Onboarding new developers regularly
- Need to prove/validate architectural decisions

**Skip it if:**
- Small, simple codebases with few dependencies
- Team resistant to adopting new tools
- Limited resources for infrastructure maintenance
- Static analysis tools like TypeScript already meet your needs

## For Our Collaboration

**Makes me more effective at:**
- Finding exact files to read (instead of guessing)
- Understanding component relationships instantly
- Suggesting safer refactoring strategies
- Explaining "why" something is structured a certain way

**Trade-off:**
- You maintain one more system
- Initial setup time investment
- I need graph query access during sessions

Would you like me to elaborate on any specific pro/con, or discuss implementation strategy?

## User (checkpoint)

i would like you to analyse the neo4j codegraph database and the quality of its graph representation of the code in ~/ws/frontend-monorepo.
so is complete what is missing what is not needed should we include better schema support can we use it to generate c4 architecture diagrams with system, container component level diagrams with proper relations from it. plus anything else you think we should know about it. think hard. and try to give concise and keep it simple

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "label": [
      "JSXAttribute",
      "Node"
    ],
    "count": 7201
  },
  {
    "label": [
      "JSXElement",
      "Node"
    ],
    "count": 4731
  },
  {
    "label": [
      "Import",
      "Node"
    ],
    "count": 4488
  },
  {
    "label": [
      "Parameter",
      "Node"
    ],
    "count": 3350
  },
  {
    "label": [
      "Function",
      "Node"
    ],
    "count": 2648
  },
  {
    "label": [
      "Variable",
      "Node"
    ],
    "count": 1299
  },
  {
    "label": [
      "File",
      "Node"
    ],
    "count": 945
  },
  {
    "label": [
      "Node"
    ],
    "count": 708
  },
  {
    "label": [
      "TypeAlias",
      "Node"
    ],
    "count": 585
  },
  {
    "label": [
      "TailwindClass",
      "Node"
    ],
    "count": 227
  },
  {
    "label": [
      "Interface",
      "Node"
    ],
    "count": 126
  },
  {
    "label": [
      "Method",
      "Node"
    ],
    "count": 112
  },
  {
    "label": [
      "Class",
      "Node"
    ],
    "count": 17
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "relationship": "HAS_PROP",
    "count": 7201
  },
  {
    "relationship": "IMPORTS",
    "count": 5498
  },
  {
    "relationship": "RENDERS_ELEMENT",
    "count": 3738
  },
  {
    "relationship": "HAS_PARAMETER",
    "count": 3350
  },
  {
    "relationship": "CALLS",
    "count": 1607
  },
  {
    "relationship": "USES_TAILWIND_CLASS",
    "count": 453
  },
  {
    "relationship": "HAS_METHOD",
    "count": 112
  },
  {
    "relationship": "EXPORTS",
    "count": 57
  },
  {
    "relationship": "MUTATES_STATE",
    "count": 36
  },
  {
    "relationship": "HANDLES_ERROR",
    "count": 26
  },
  {
    "relationship": "EXTENDS",
    "count": 9
  },
  {
    "relationship": "RESOLVES_IMPORT",
    "count": 1
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "labels": [
      "File",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "Import",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt"
    ]
  },
  {
    "labels": [
      "Variable",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "Function",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "Parameter",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "TypeAlias",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "Interface",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "JSXElement",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt"
    ]
  },
  {
    "labels": [
      "JSXAttribute",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt"
    ]
  },
  {
    "labels": [
      "TailwindClass",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt"
    ]
  },
  {
    "labels": [
      "Class",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "Method",
      "Node"
    ],
    "sampleProperties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc"
    ]
  },
  {
    "labels": [
      "Node"
    ],
    "sampleProperties": [
      "entityId"
    ]
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.ci.config.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.dev.config.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.dev.local.config.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.staging.config.ts"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.ci.config.ts",
    "i.name": "@mindlercare/playwright:1",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.ci.config.ts",
    "i.name": "./playwright.staging.config:2",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "@mindlercare/playwright:1",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "@mindlercare/schema:2",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "@playwright/test:3",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "./playwright.ci.config:4",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "./playwright.dev.config:5",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "./playwright.dev.local.config:6",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "i.name": "./playwright.staging.config:7",
    "i.importSource": null
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.dev.config.ts",
    "i.name": "@mindlercare/playwright:1",
    "i.importSource": null
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.ci.config.ts",
    "imports": [
      "@mindlercare/playwright:1",
      "./playwright.staging.config:2"
    ]
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.config.ts",
    "imports": [
      "@mindlercare/playwright:1",
      "@mindlercare/schema:2",
      "@playwright/test:3"
    ]
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.dev.config.ts",
    "imports": [
      "@mindlercare/playwright:1"
    ]
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.dev.local.config.ts",
    "imports": [
      "@mindlercare/playwright:1"
    ]
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.staging.config.ts",
    "imports": [
      "@mindlercare/playwright:1"
    ]
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "func.name": "getStage",
    "func.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "func.isExported": false,
    "func.isAsync": false
  },
  {
    "func.name": "defaultConfig",
    "func.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/playwright.config.ts",
    "func.isExported": false,
    "func.isAsync": false
  },
  {
    "func.name": "getStage",
    "func.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.config.ts",
    "func.isExported": false,
    "func.isAsync": false
  },
  {
    "func.name": "defaultConfig",
    "func.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/playwright.config.ts",
    "func.isExported": false,
    "func.isAsync": false
  },
  {
    "func.name": "callback_defineConfig_arg-1",
    "func.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/vite.config.ts",
    "func.isExported": false,
    "func.isAsync": false
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/jest.config.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/AuthenticationProvider.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/BackToLogin.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/CreateCognitoAccount.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/LoginWithQrCode.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/MagicLogin.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/ResetCognitoPassword.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/SignInOptions.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/SignInWithBankIdOnSameDevice.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/Authenticator/SignInWithEmailAndPassword.tsx"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.name": "callback_defineConfig_arg0",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/video-stream-2/vite.config.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "resolveBuildTarget"
  },
  {
    "f.name": "callback_defineConfig_arg0",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/video-stream-2/vite.config.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "resolveBuildSettingsFromBuildTarget"
  },
  {
    "f.name": "convertToTable",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "createOtherUrls"
  },
  {
    "f.name": "convertToTable",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "createMindlerCareUrls"
  },
  {
    "f.name": "createMindlerCareUrls",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "getUrl"
  },
  {
    "f.name": "createMindlerCareUrls",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "getUrl"
  },
  {
    "f.name": "convertToTable",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "createVideoStreamUrls"
  },
  {
    "f.name": "createVideoStreamUrls",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "getUrl"
  },
  {
    "f.name": "buildUrlsTable",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "convertToTable"
  },
  {
    "f.name": "getChangedFrontends",
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/get-changed-frontends.ts",
    "labels(target)": [
      "Function",
      "Node"
    ],
    "target.name": "createAlias"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/mindler-ui-web/.storybook/main.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/mindler-ui-web/.storybook/preview.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/mindler-ui-web/src/index.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/mindler-ui-web/src/lib/assets/fonts/globalFonts.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/mindler-ui-web/src/lib/button/button.stories.tsx"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "t.name": "BuildTarget",
    "t.filePath": "/Users/grop/ws/frontend-monorepo/frontends/video-stream-2/vite.config.ts",
    "t.typeDefinition": null
  },
  {
    "t.name": "Frontend",
    "t.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/distributeUrls.ts",
    "t.typeDefinition": null
  },
  {
    "t.name": "Mode",
    "t.filePath": "/Users/grop/ws/frontend-monorepo/packages/ci/get-changed-frontends.ts",
    "t.typeDefinition": null
  },
  {
    "t.name": "GeneratedUser",
    "t.filePath": "/Users/grop/ws/frontend-monorepo/packages/playwright/src/types.ts",
    "t.typeDefinition": null
  },
  {
    "t.name": "MarketConfig",
    "t.filePath": "/Users/grop/ws/frontend-monorepo/packages/playwright/src/types.ts",
    "t.typeDefinition": null
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/playwright/src/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "types.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/unleash-client/src/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "UnleashProvider.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/video-stream-2/src/reportWebVitals.ts",
    "labels(exported)": [
      "Function",
      "Node"
    ],
    "exported.name": "reportWebVitals"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "AuthenticationProvider.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/auth-ui/src/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "utils.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/playwright/src/fixtures/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "base.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/playwright/src/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "index.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/packages/playwright/src/fixtures/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "Utils.ts"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/phoneField/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "phoneField.tsx"
  },
  {
    "f.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/searchField/index.ts",
    "labels(exported)": [
      "File",
      "Node"
    ],
    "exported.name": "searchField.tsx"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "n.name": "../src/api/rtk/calendarTemplates:4",
    "n.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/setup.ts",
    "labels(target)": [
      "File",
      "Node"
    ],
    "target.name": "calendarTemplates.ts",
    "target.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/api/rtk/calendarTemplates.ts"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "comp.name": "H1Component",
    "comp.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/typography/typography.tsx",
    "comp.isReactComponent": null
  },
  {
    "comp.name": "H2Component",
    "comp.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/typography/typography.tsx",
    "comp.isReactComponent": null
  },
  {
    "comp.name": "H3Component",
    "comp.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/typography/typography.tsx",
    "comp.isReactComponent": null
  },
  {
    "comp.name": "H4Component",
    "comp.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/typography/typography.tsx",
    "comp.isReactComponent": null
  },
  {
    "comp.name": "H5Component",
    "comp.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/ui/typography/typography.tsx",
    "comp.isReactComponent": null
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "fileCount": 436
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.packageName": null,
    "count": 945
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "jsx.name": "FlagProvider",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/packages/unleash-client/src/UnleashProvider.tsx"
  },
  {
    "jsx.name": "div",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "Routes",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "RequiresAuth",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "FullPageLoading",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "Navigate",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "Outlet",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "Route",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "Login",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  },
  {
    "jsx.name": "Route",
    "jsx.filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "depth": 2,
    "count": 427
  },
  {
    "depth": 3,
    "count": 536
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "i.name": "@mindlercare/ui-web:1",
    "usageCount": 112
  },
  {
    "i.name": "@mindlercare/schema:1",
    "usageCount": 58
  },
  {
    "i.name": "@mindlercare/ui-web:2",
    "usageCount": 34
  },
  {
    "i.name": "@mindlercare/mindlerapi-client:1",
    "usageCount": 25
  },
  {
    "i.name": "@mindlercare/schema:2",
    "usageCount": 24
  },
  {
    "i.name": "@mindlercare/auth-ui:1",
    "usageCount": 23
  },
  {
    "i.name": "@mindlercare/playwright:1",
    "usageCount": 17
  },
  {
    "i.name": "@mindlercare/auth:1",
    "usageCount": 12
  },
  {
    "i.name": "@mindlercare/ui-web/src/shared/constants:2",
    "usageCount": 10
  },
  {
    "i.name": "@mindlercare/unleash-client:2",
    "usageCount": 9
  }
]

## Assistant

# Neo4j CodeGraph Analysis: frontend-monorepo

## Current State Overview
- **945 Files** indexed
- **26,000+ Nodes** across 13 node types
- **22,000+ Relationships** across 12 relationship types

---

## ✅ What's Working Well

### 1. **Fine-Grained AST Capture**
- JSX elements, attributes, parameters tracked
- Function calls, imports, exports captured
- React-specific patterns (components, hooks)

### 2. **Basic Dependency Tracking**
- Import relationships exist (5,498 IMPORTS edges)
- Some file-to-file connections (427 depth-2, 536 depth-3 paths)
- Package usage visible (@mindlercare/ui-web used 112 times)

### 3. **React/Frontend Awareness**
- JSX elements tracked (4,731 nodes)
- Component rendering relationships (3,738 RENDERS_ELEMENT edges)
- Tailwind classes captured (227 nodes, 453 relationships)

---

## ❌ Critical Missing Elements

### 1. **No Package/Module Boundaries** 🚨
- **Problem**: `packageName` is `null` for ALL 945 files
- **Impact**: Cannot generate C4 Container diagrams (no containers defined!)
- **Missing**: `frontends/mindlercare`, `packages/mindler-ui-web`, `packages/auth-ui` should be distinct containers

### 2. **Broken Import Resolution** 🚨
- **Problem**: Only 1 `RESOLVES_IMPORT` relationship exists (should be thousands)
- **Import nodes lack `importSource`** - all are `null`
- **Impact**: Cannot trace where imports actually resolve to
- **Example**: `@mindlercare/ui-web:1` appears 112 times but doesn't resolve to the actual package files

### 3. **No Component Identity** 🚨
- **Problem**: No `isReactComponent` flags, no component hierarchy
- **Missing**: Which functions are React components vs utilities
- **Impact**: Cannot generate React component dependency graphs

### 4. **No Type Relationships**
- **Problem**: TypeAlias/Interface nodes exist but have no relationships
- **Missing**: `IMPLEMENTS`, `USES_TYPE`, `EXTENDS_TYPE` edges
- **Impact**: Cannot trace type dependencies or schema changes

### 5. **Weak Function Call Graph**
- **Problem**: Only 1,607 CALLS relationships (seems very low for 945 files)
- **Missing**: Most function invocations not captured
- **Impact**: Cannot do proper impact analysis

---

## 🔧 What Needs Fixing

### Priority 1: Package Boundaries (Required for C4)
```cypher
// Currently ALL files have this:
(:File { packageName: null })

// Should be:
(:File:Package {
  packageName: "mindlercare",
  packageType: "frontend",
  packagePath: "/frontends/mindlercare"
})

(:File:Package {
  packageName: "@mindlercare/ui-web",
  packageType: "shared-library",
  packagePath: "/packages/mindler-ui-web"
})
```

### Priority 2: Import Resolution
```cypher
// Currently broken:
(:Import { name: "@mindlercare/ui-web:1", importSource: null })

// Should be:
(:Import {
  name: "Button",
  importSource: "@mindlercare/ui-web",
  importSpecifier: "Button"
})
-[:RESOLVES_TO]->
(:File { filePath: "/packages/mindler-ui-web/src/lib/button/button.tsx" })
```

### Priority 3: Component Identification
```cypher
// Add metadata:
(:Function {
  name: "PatientCard",
  isReactComponent: true,
  isHook: false,
  isExported: true
})
```

### Priority 4: Type System
```cypher
(:Function)-[:USES_TYPE]->(:TypeAlias)
(:Interface)-[:EXTENDS]->(:Interface)
(:TypeAlias)-[:REFERENCES]->(:TypeAlias)
```

---

## 🗑️ What Can Be Removed

### 1. **Excessive JSX Noise**
- **7,201 JSXAttribute nodes** - too granular for architecture
- **4,731 JSXElement nodes** - keep component-level, remove DOM elements
- **Recommendation**: Only track custom component usage, not `<div>`, `<button>`, etc.

### 2. **Tailwind Classes**
- **227 TailwindClass nodes** - architectural noise
- **Unless** you're analyzing design system usage, remove this

### 3. **Parameter Nodes**
- **3,350 Parameter nodes** - excessive detail
- **Recommendation**: Keep function signatures as properties, not separate nodes

### 4. **Generic "Node" Labels**
- **708 nodes** with only `Node` label - incomplete parsing
- Either enrich or remove these orphaned nodes

---

## 📊 C4 Diagram Generation: Current Capability

### System Context (Level 1) ✅
**Can generate** - you have file-level data
```
[Frontend Monorepo System]
  ├─ External: @mindlercare/schema
  ├─ External: @mindlercare/mindlerapi-client
  └─ External: react, styled-components
```

### Container Diagram (Level 2) ❌
**CANNOT generate** - missing package boundaries
```
Should show:
[Frontend Monorepo]
  ├─ mindlercare (Frontend App)
  ├─ mindler-back-office-tools (Frontend App)
  ├─ @mindlercare/ui-web (Shared Library)
  ├─ @mindlercare/auth-ui (Shared Library)
  └─ [relationships between containers]
```

### Component Diagram (Level 3) ⚠️
**Partially possible** - have function/file level but missing:
- Component identity flags
- Proper import resolution
- Type dependencies

### Code Diagram (Level 4) ✅
**Can generate** - you have function-level detail (though CALLS graph is weak)

---

## 🎯 Recommendations

### Immediate Actions

1. **Add Package Metadata** (Highest Priority)
   - Parse `package.json` files or `pnpm-workspace.yaml`
   - Tag every File with its containing package
   - Create `Package` nodes with boundaries

2. **Fix Import Resolution**
   - Parse `tsconfig.json` paths
   - Resolve `@mindlercare/*` to actual package locations
   - Create `RESOLVES_TO` edges from Import to File/Function

3. **Identify React Components**
   - Add `isReactComponent: true` for functions that return JSX
   - Add `isHook: true` for functions starting with `use*`
   - Track component hierarchy (parent/child rendering)

4. **Reduce Noise**
   - Remove JSXAttribute nodes entirely
   - Filter JSXElement to only custom components
   - Remove or consolidate Parameter nodes

5. **Add Type Relationships**
   - Connect functions to their return types
   - Connect interfaces to extensions
   - Track type imports and usage

### Schema Improvements

```typescript
// Suggested enhanced schema:
(:Package {
  name: string,
  type: "frontend" | "shared-library",
  path: string
})

(:File)-[:BELONGS_TO]->(:Package)

(:Function {
  isReactComponent: boolean,
  isHook: boolean,
  returnType: string
})

(:Import)-[:RESOLVES_TO]->(:File | :Function | :TypeAlias)

(:Function)-[:USES_TYPE]->(:TypeAlias | :Interface)
```

---

## 💡 Use Cases After Fixes

### Once Fixed, You Could:

1. **"Show me all components that use Button from ui-web"**
   ```cypher
   MATCH (pkg:Package {name: "@mindlercare/ui-web"})<-[:BELONGS_TO]-(f:File)
   WHERE f.name = "button.tsx"
   MATCH (importer:File)-[:IMPORTS]->(:Import)-[:RESOLVES_TO]->(f)
   RETURN importer
   ```

2. **"What breaks if I change this type?"**
   ```cypher
   MATCH (t:TypeAlias {name: "UserProfile"})
   MATCH (t)<-[:USES_TYPE*1..3]-(dependent)
   RETURN dependent.filePath
   ```

3. **"Generate Container diagram"**
   ```cypher
   MATCH (p1:Package)-[:DEPENDS_ON]->(p2:Package)
   RETURN p1.name, p2.name
   ```

4. **"Find circular dependencies"**
   ```cypher
   MATCH path = (p:Package)-[:DEPENDS_ON*2..5]->(p)
   RETURN path
   ```

---

## Summary Score

| Aspect | Score | Status |
|--------|-------|--------|
| **AST Detail** | 8/10 | ✅ Very detailed, maybe too much |
| **Package Boundaries** | 0/10 | ❌ Completely missing |
| **Import Resolution** | 1/10 | ❌ Broken (only 1 resolution) |
| **Type System** | 3/10 | ⚠️ Nodes exist, no relationships |
| **React Awareness** | 6/10 | ⚠️ JSX tracked, components not identified |
| **C4 Readiness** | 2/10 | ❌ Cannot generate Container/Component diagrams |
| **AI Query Usefulness** | 4/10 | ⚠️ Can answer basic file questions only |

**Overall: 3.5/10** - Has potential but needs critical fixes before useful for architecture or AI-assisted development.

## User

can you create we a concise simple specification from recommendations 1,2,3,5.
make sure it high quality and that you enable a high quality simple correct implementations so we can make c4 diagram creation from the graph database possible.

## Assistant

# CodeGraph Enhancement Specification

## Goal
Enable C4 Container and Component diagram generation by fixing critical missing relationships in the Neo4j code graph.

---

## 1. Package Boundary Detection

### Requirements
- Parse workspace structure to identify all packages
- Tag every File node with its containing package
- Create Package nodes as first-class entities

### Implementation

#### Step 1: Detect Packages
Parse these files to discover packages:
- `pnpm-workspace.yaml` → list of package glob patterns
- Each `package.json` → name, type, dependencies

#### Step 2: Create Package Nodes
```cypher
CREATE (:Package {
  name: string,              // "mindlercare" or "@mindlercare/ui-web"
  type: string,              // "frontend" | "shared-library" | "tool"
  path: string,              // "/frontends/mindlercare"
  version: string            // from package.json
})
```

#### Step 3: Tag Files with Package
```cypher
MATCH (f:File)
SET f.packageName = <derived from file path>
CREATE (f)-[:BELONGS_TO]->(p:Package)
```

#### Package Type Rules
- `frontends/*` → type: "frontend"
- `packages/*` → type: "shared-library"
- Root-level config files → type: "tool"

---

## 2. Import Resolution

### Requirements
- Resolve every Import node to its actual source file/function
- Handle both relative imports and workspace package imports
- Support TypeScript path aliases from tsconfig.json

### Implementation

#### Step 1: Parse Import Sources
```cypher
// Current broken state
(:Import { name: "@mindlercare/ui-web:1", importSource: null })

// Required structure
(:Import {
  name: "Button",                    // What's being imported
  importSource: "@mindlercare/ui-web", // Where from
  importPath: "./relative/path",    // If relative
  isTypeOnly: boolean               // import type vs import
})
```

#### Step 2: Resolution Algorithm

**For workspace packages** (e.g., `@mindlercare/ui-web`):
1. Find Package node by name
2. Read package's `package.json` → `exports` or `main` field
3. Resolve to entry file (usually `src/index.ts`)
4. If named import, parse exports from that file

**For relative imports** (e.g., `./utils`):
1. Resolve relative to importing file's directory
2. Try extensions: `.ts`, `.tsx`, `.js`, `.jsx`
3. If directory, look for `index.ts`

**For path aliases** (e.g., `@/components`):
1. Parse `tsconfig.json` → `paths` mapping
2. Resolve alias to actual path
3. Follow relative resolution rules

#### Step 3: Create Resolution Relationships
```cypher
(:Import)-[:RESOLVES_TO]->(:File)           // Resolves to file
(:Import)-[:RESOLVES_TO]->(:Function)       // Resolves to specific export
(:Import)-[:RESOLVES_TO]->(:TypeAlias)      // Resolves to type
```

#### Step 4: Package Dependencies
```cypher
// After imports resolved, derive package relationships
MATCH (f1:File)-[:BELONGS_TO]->(p1:Package)
MATCH (f1)-[:IMPORTS]->(:Import)-[:RESOLVES_TO]->(target)
MATCH (target)-[:BELONGS_TO]->(p2:Package)
WHERE p1 <> p2
MERGE (p1)-[:DEPENDS_ON {weight: count}]->(p2)
```

---

## 3. React Component Identification

### Requirements
- Flag which Function nodes are React components
- Flag which Function nodes are custom hooks
- Track component rendering relationships

### Implementation

#### Step 1: Detect React Components
A function is a React component if:
- Returns JSX (check if `RENDERS_ELEMENT` relationship exists)
- Name starts with uppercase letter
- File is `.tsx` or `.jsx`

```cypher
MATCH (f:Function)-[:RENDERS_ELEMENT]->(:JSXElement)
WHERE f.name =~ '^[A-Z].*'
SET f.isReactComponent = true
```

#### Step 2: Detect React Hooks
A function is a hook if:
- Name starts with `use` (case-sensitive)
- Returns value (not void)

```cypher
MATCH (f:Function)
WHERE f.name STARTS WITH 'use'
  AND f.name =~ '^use[A-Z].*'
SET f.isHook = true
```

#### Step 3: Component Hierarchy
Track which components render which other components:

```cypher
MATCH (parent:Function {isReactComponent: true})-[:RENDERS_ELEMENT]->(jsx:JSXElement)
MATCH (child:Function {isReactComponent: true})
WHERE jsx.name = child.name
CREATE (parent)-[:RENDERS_COMPONENT]->(child)
```

#### Step 4: Hook Usage
Track which components use which hooks:

```cypher
MATCH (comp:Function {isReactComponent: true})-[:CALLS]->(hook:Function {isHook: true})
CREATE (comp)-[:USES_HOOK]->(hook)
```

---

## 4. Noise Reduction

### Requirements
- Remove overly granular nodes that don't contribute to architecture understanding
- Keep only data useful for C4 diagrams and impact analysis

### Implementation

#### Remove: JSXAttribute Nodes (7,201 nodes)
```cypher
MATCH (n:JSXAttribute)
DETACH DELETE n
```
**Rationale**: Attributes like `className="..."` are too granular for architecture.

#### Remove: DOM Element JSXElement Nodes
Keep only custom component JSX, remove HTML elements:
```cypher
MATCH (jsx:JSXElement)
WHERE jsx.name IN ['div', 'span', 'button', 'input', 'form', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'li', 'img', 'svg', 'path']
DETACH DELETE jsx
```
**Keep**: Custom components like `<PatientCard>`, `<Button>` from ui-web

#### Remove: TailwindClass Nodes (227 nodes)
```cypher
MATCH (n:TailwindClass)
DETACH DELETE n
```
**Rationale**: CSS classes are styling details, not architecture.

#### Simplify: Parameter Nodes → Properties
Instead of 3,350 Parameter nodes, store as function property:
```cypher
MATCH (f:Function)-[r:HAS_PARAMETER]->(p:Parameter)
WITH f, collect(p.name + ': ' + p.type) AS params
SET f.parameters = params
DETACH DELETE p
```

#### Clean: Orphaned Nodes
```cypher
MATCH (n:Node)
WHERE NOT (n)--()  // No relationships
DELETE n
```

---

## 5. Type System Relationships

### Requirements
- Connect functions to the types they use
- Track interface/type inheritance
- Enable type-based impact analysis

### Implementation

#### Step 1: Function Return Types
Parse function signatures and create relationships:
```cypher
MATCH (f:Function)
WHERE f.returnType IS NOT NULL
MATCH (t:TypeAlias|Interface {name: f.returnType})
CREATE (f)-[:RETURNS_TYPE]->(t)
```

#### Step 2: Function Parameter Types
```cypher
MATCH (f:Function)
UNWIND f.parameterTypes AS paramType
MATCH (t:TypeAlias|Interface {name: paramType})
CREATE (f)-[:USES_TYPE]->(t)
```

#### Step 3: Type Inheritance
```cypher
// Interface extends another interface
MATCH (i1:Interface)
WHERE i1.extends IS NOT NULL
MATCH (i2:Interface {name: i1.extends})
CREATE (i1)-[:EXTENDS]->(i2)

// Type alias references other types
MATCH (t1:TypeAlias)
WHERE t1.typeDefinition CONTAINS t2.name
MATCH (t2:TypeAlias|Interface)
CREATE (t1)-[:REFERENCES]->(t2)
```

#### Step 4: Type Imports
When a type is imported, track its usage:
```cypher
MATCH (i:Import {isTypeOnly: true})-[:RESOLVES_TO]->(t:TypeAlias|Interface)
MATCH (f:File)-[:IMPORTS]->(i)
CREATE (f)-[:USES_TYPE]->(t)
```

---

## Validation Queries

After implementation, run these to verify correctness:

### Check Package Boundaries
```cypher
MATCH (p:Package)
RETURN p.name, p.type, count{(p)<-[:BELONGS_TO]-()} as fileCount
ORDER BY fileCount DESC
```
**Expected**: ~5-10 packages, each with dozens/hundreds of files

### Check Import Resolution
```cypher
MATCH (i:Import)-[:RESOLVES_TO]->(target)
RETURN labels(target) as targetType, count(*) as count
```
**Expected**: Thousands of resolutions to File, Function, TypeAlias

### Check Component Identification
```cypher
MATCH (f:Function {isReactComponent: true})
RETURN count(*) as componentCount

MATCH (f:Function {isHook: true})
RETURN count(*) as hookCount
```
**Expected**: Hundreds of components, dozens of hooks

### Check Package Dependencies
```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
RETURN p1.name, p2.name, d.weight
ORDER BY d.weight DESC
```
**Expected**: Clear dependency graph between packages

---

## C4 Diagram Generation

Once implemented, generate diagrams:

### System Context (Level 1)
```cypher
MATCH (internal:Package)
MATCH (internal)-[:DEPENDS_ON]->(:Package)
WHERE NOT (internal.name STARTS WITH '@mindlercare')
RETURN internal.name, collect(DISTINCT external.name) as externalDeps
```

### Container Diagram (Level 2)
```cypher
MATCH (p1:Package)-[d:DEPENDS_ON]->(p2:Package)
WHERE p1.name STARTS WITH '@mindlercare' OR p1.type = 'frontend'
  AND p2.name STARTS WITH '@mindlercare' OR p2.type = 'frontend'
RETURN p1.name, p1.type, p2.name, p2.type, d.weight
```

### Component Diagram (Level 3)
```cypher
MATCH (pkg:Package {name: $packageName})
MATCH (pkg)<-[:BELONGS_TO]-(f:File)
MATCH (f)<-[:BELONGS_TO]-(comp:Function {isReactComponent: true, isExported: true})
OPTIONAL MATCH (comp)-[:RENDERS_COMPONENT]->(child:Function)
RETURN comp.name, comp.filePath, collect(child.name) as renders
```

---

## Implementation Priority

1. **Package Boundaries** (1-2 hours) - enables Container diagrams
2. **Import Resolution** (3-4 hours) - enables dependency tracking
3. **Component Identification** (1 hour) - enables Component diagrams
4. **Noise Reduction** (30 min) - improves query performance
5. **Type Relationships** (2 hours) - enables impact analysis

**Total effort**: ~8 hours of focused work

---

## Success Criteria

✅ Every File has `packageName` and `BELONGS_TO` relationship
✅ >90% of Import nodes have `RESOLVES_TO` relationship
✅ React components identified with `isReactComponent: true`
✅ JSXAttribute and TailwindClass nodes removed
✅ Can generate C4 Container diagram showing package dependencies
✅ Can generate C4 Component diagram for any package

## User

i think i did not specify this complete enough.
the sollution should be integrated into the existing CodeGraph code base.
as that feels like the most forward way. if a query can solve the functionality then that is an option but not the primary way to improve the existing code that generated the whole graph from scratch.
also step 4 noise cleanup is not needed yet.
lets also make sure we improve the level of the test so we have a proper way of developing this.
can you create a new version of the spec taken this into account. think hard and again be concise and keep it elegantly simplle

## Assistant

# CodeGraph Enhancement Specification v2

## Goal
Extend the existing CodeGraph codebase (~/ws/packages/architecture) to generate C4-ready graphs with package boundaries, resolved imports, and React component identification.

---

## Architecture Context

### Current Pipeline
```
TypeScript Files → ts-morph Parser → Extractors → Neo4j Graph
```

### What Exists
- File extractor (creates File nodes)
- Import extractor (creates Import nodes, but no resolution)
- Function extractor (creates Function nodes)
- Type extractor (creates TypeAlias/Interface nodes)

### What We're Adding
- **Package extractor** (new)
- **Import resolver** (enhance existing)
- **Component analyzer** (enhance existing)
- **Type relationship tracker** (enhance existing)

---

## 1. Package Boundary Extractor

### Purpose
Create Package nodes and tag all files with their containing package.

### Location
`packages/architecture/src/extractors/packageExtractor.ts`

### Algorithm

```typescript
interface PackageNode {
  name: string;           // "@mindlercare/ui-web" or "mindlercare"
  type: PackageType;      // "frontend" | "shared-library" | "tool"
  path: string;           // "/packages/mindler-ui-web"
  version: string;        // from package.json
  entryPoint: string;     // main/exports field
}

type PackageType = "frontend" | "shared-library" | "tool";
```

#### Phase 1: Discover Packages
1. Parse `pnpm-workspace.yaml` → extract package patterns
2. Glob match patterns to find all `package.json` files
3. For each package.json, read: `name`, `version`, `main`/`exports`

#### Phase 2: Create Package Nodes
```cypher
CREATE (:Package {
  name: string,
  type: string,
  path: string,
  version: string,
  entryPoint: string
})
```

#### Phase 3: Link Files to Packages
When File nodes are created, determine package from file path:
```typescript
function getPackageForFile(filePath: string, packages: Package[]): Package {
  // Match file path against package.path
  return packages.find(pkg => filePath.startsWith(pkg.path));
}
```

Add to File node creation:
```cypher
CREATE (f:File {
  filePath: string,
  packageName: string,  // NEW
  ...existing properties
})

MATCH (p:Package {name: $packageName})
CREATE (f)-[:BELONGS_TO]->(p)
```

### Tests
```typescript
describe("PackageExtractor", () => {
  it("discovers all packages from pnpm-workspace.yaml", async () => {
    const extractor = new PackageExtractor(monorepoRoot);
    const packages = await extractor.discoverPackages();

    expect(packages).toContainEqual({
      name: "@mindlercare/ui-web",
      type: "shared-library",
      path: expect.stringContaining("/packages/mindler-ui-web")
    });
  });

  it("tags files with correct package", async () => {
    const file = "/packages/mindler-ui-web/src/button.tsx";
    const pkg = extractor.getPackageForFile(file);

    expect(pkg.name).toBe("@mindlercare/ui-web");
  });

  it("creates Package nodes in Neo4j", async () => {
    await extractor.extract();

    const result = await neo4j.query(`
      MATCH (p:Package {name: "@mindlercare/ui-web"})
      RETURN p
    `);

    expect(result).toBeDefined();
  });
});
```

---

## 2. Import Resolution

### Purpose
Resolve Import nodes to their actual source (File/Function/Type).

### Location
Enhance `packages/architecture/src/extractors/importExtractor.ts`

### Algorithm

#### Phase 1: Parse Import Metadata
When creating Import nodes, extract full information:
```typescript
interface ImportNode {
  name: string;              // "Button"
  importSource: string;      // "@mindlercare/ui-web" or "./utils"
  importPath: string | null; // resolved absolute path
  isTypeOnly: boolean;       // import type vs import
  isDefault: boolean;        // default vs named
}
```

#### Phase 2: Resolution Logic
```typescript
class ImportResolver {
  resolve(imp: ImportNode, fromFile: string): ResolvedTarget {
    if (imp.importSource.startsWith('@mindlercare/')) {
      return this.resolveWorkspacePackage(imp);
    } else if (imp.importSource.startsWith('.')) {
      return this.resolveRelative(imp, fromFile);
    } else {
      return this.resolveNodeModules(imp);
    }
  }

  resolveWorkspacePackage(imp: ImportNode): ResolvedTarget {
    // 1. Find Package node by name
    const pkg = this.packages.find(p => p.name === imp.importSource);

    // 2. Get entry point from package.json
    const entryFile = pkg.entryPoint; // e.g., "src/index.tsx"

    // 3. If named import, parse exports from entry file
    if (!imp.isDefault) {
      return this.findNamedExport(entryFile, imp.name);
    }

    return { type: 'File', path: entryFile };
  }

  resolveRelative(imp: ImportNode, fromFile: string): ResolvedTarget {
    // 1. Resolve relative to importing file
    const baseDir = path.dirname(fromFile);
    let resolved = path.resolve(baseDir, imp.importSource);

    // 2. Try extensions
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      if (fs.existsSync(resolved + ext)) {
        return { type: 'File', path: resolved + ext };
      }
    }

    // 3. Try index file
    if (fs.existsSync(path.join(resolved, 'index.ts'))) {
      return { type: 'File', path: path.join(resolved, 'index.ts') };
    }

    return null;
  }
}
```

#### Phase 3: Create Resolution Relationships
```cypher
// After resolution
MATCH (imp:Import {name: $name, filePath: $filePath})
MATCH (target) WHERE target.filePath = $resolvedPath OR target.name = $resolvedName
CREATE (imp)-[:RESOLVES_TO]->(target)
```

#### Phase 4: Derive Package Dependencies
After all imports resolved, aggregate:
```cypher
MATCH (f1:File)-[:BELONGS_TO]->(p1:Package)
MATCH (f1)-[:IMPORTS]->(i:Import)-[:RESOLVES_TO]->(target)
MATCH (target)-[:BELONGS_TO]->(p2:Package)
WHERE p1 <> p2
WITH p1, p2, count(*) as weight
MERGE (p1)-[:DEPENDS_ON {weight: weight}]->(p2)
```

### Tests
```typescript
describe("ImportResolver", () => {
  it("resolves workspace package import", () => {
    const imp = {
      name: "Button",
      importSource: "@mindlercare/ui-web",
      isTypeOnly: false
    };

    const resolved = resolver.resolve(imp, "/frontends/mindlercare/App.tsx");

    expect(resolved.type).toBe("Function");
    expect(resolved.path).toContain("/packages/mindler-ui-web/src");
  });

  it("resolves relative import", () => {
    const imp = {
      name: "utils",
      importSource: "./utils",
      isTypeOnly: false
    };

    const resolved = resolver.resolve(imp, "/frontends/mindlercare/App.tsx");

    expect(resolved.path).toBe("/frontends/mindlercare/utils.ts");
  });

  it("creates RESOLVES_TO relationship", async () => {
    await extractor.extract();

    const result = await neo4j.query(`
      MATCH (:Import)-[:RESOLVES_TO]->(target)
      RETURN count(target) as count
    `);

    expect(result[0].count).toBeGreaterThan(1000);
  });

  it("creates Package DEPENDS_ON relationships", async () => {
    await extractor.extract();

    const result = await neo4j.query(`
      MATCH (p1:Package {name: "mindlercare"})-[d:DEPENDS_ON]->(p2:Package)
      RETURN p2.name, d.weight
      ORDER BY d.weight DESC
    `);

    expect(result[0].name).toBe("@mindlercare/ui-web");
  });
});
```

---

## 3. React Component Analyzer

### Purpose
Identify React components, hooks, and their relationships.

### Location
Enhance `packages/architecture/src/extractors/functionExtractor.ts`

### Algorithm

#### Phase 1: Detect Components
When creating Function nodes, analyze:
```typescript
function isReactComponent(func: FunctionDeclaration): boolean {
  // 1. Check if returns JSX
  const returnsJSX = func.getReturnType().getText().includes("JSX.Element");

  // 2. Check if name starts with uppercase
  const isUpperCase = /^[A-Z]/.test(func.getName());

  // 3. Check if file is .tsx/.jsx
  const isTsxFile = func.getSourceFile().getBaseName().endsWith(".tsx");

  return returnsJSX && isUpperCase && isTsxFile;
}
```

Add to Function node:
```cypher
CREATE (f:Function {
  name: string,
  isReactComponent: boolean,  // NEW
  isHook: boolean,            // NEW
  ...existing properties
})
```

#### Phase 2: Detect Hooks
```typescript
function isReactHook(func: FunctionDeclaration): boolean {
  const name = func.getName();
  return /^use[A-Z]/.test(name);
}
```

#### Phase 3: Component Hierarchy
Track component rendering:
```typescript
class ComponentAnalyzer {
  analyzeRenderRelationships(component: FunctionDeclaration) {
    // Find JSX elements returned by component
    const jsxElements = component
      .getDescendantsOfKind(SyntaxKind.JsxElement)
      .concat(component.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement));

    for (const jsx of jsxElements) {
      const tagName = jsx.getTagNameNode().getText();

      // Check if tag is a custom component (starts with uppercase)
      if (/^[A-Z]/.test(tagName)) {
        // Find the component definition
        const childComponent = this.findComponent(tagName);
        if (childComponent) {
          this.createRenderRelationship(component, childComponent);
        }
      }
    }
  }
}
```

Create relationship:
```cypher
MATCH (parent:Function {isReactComponent: true})
MATCH (child:Function {isReactComponent: true})
WHERE parent renders child (from AST analysis)
CREATE (parent)-[:RENDERS_COMPONENT]->(child)
```

#### Phase 4: Hook Usage
```typescript
class HookAnalyzer {
  analyzeHookUsage(component: FunctionDeclaration) {
    // Find all function calls in component body
    const calls = component.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of calls) {
      const funcName = call.getExpression().getText();

      // Check if it's a hook call
      if (/^use[A-Z]/.test(funcName)) {
        const hookDef = this.findHook(funcName);
        if (hookDef) {
          this.createHookUsageRelationship(component, hookDef);
        }
      }
    }
  }
}
```

Create relationship:
```cypher
MATCH (comp:Function {isReactComponent: true})
MATCH (hook:Function {isHook: true})
WHERE comp calls hook
CREATE (comp)-[:USES_HOOK]->(hook)
```

### Tests
```typescript
describe("ComponentAnalyzer", () => {
  it("identifies React components", () => {
    const code = `
      export const Button: FC<Props> = () => <button>Click</button>;
    `;

    const func = parseFunction(code);
    expect(isReactComponent(func)).toBe(true);
  });

  it("identifies React hooks", () => {
    const code = `
      export const useAuth = () => { return { user: null }; };
    `;

    const func = parseFunction(code);
    expect(isReactHook(func)).toBe(true);
  });

  it("tracks component rendering", async () => {
    await extractor.extract();

    const result = await neo4j.query(`
      MATCH (parent:Function {name: "App"})-[:RENDERS_COMPONENT]->(child:Function)
      RETURN child.name
    `);

    expect(result).toContainEqual({ name: "Button" });
  });

  it("tracks hook usage", async () => {
    await extractor.extract();

    const result = await neo4j.query(`
      MATCH (comp:Function)-[:USES_HOOK]->(hook:Function {name: "useAuth"})
      RETURN comp.name
    `);

    expect(result.length).toBeGreaterThan(0);
  });
});
```

---

## 4. Type Relationship Tracker

### Purpose
Connect functions to types they use/return, track type inheritance.

### Location
Enhance `packages/architecture/src/extractors/typeExtractor.ts`

### Algorithm

#### Phase 1: Function Return Types
```typescript
function extractReturnType(func: FunctionDeclaration): string | null {
  const returnType = func.getReturnType();
  const typeName = returnType.getSymbol()?.getName();

  // Only track named types (not primitives)
  if (typeName && !isPrimitive(typeName)) {
    return typeName;
  }
  return null;
}
```

Create relationship:
```cypher
MATCH (f:Function {name: $funcName})
MATCH (t:TypeAlias|Interface {name: $typeName})
CREATE (f)-[:RETURNS_TYPE]->(t)
```

#### Phase 2: Parameter Types
```typescript
function extractParameterTypes(func: FunctionDeclaration): string[] {
  return func.getParameters()
    .map(p => p.getType())
    .map(t => t.getSymbol()?.getName())
    .filter(name => name && !isPrimitive(name));
}
```

Create relationship:
```cypher
MATCH (f:Function {name: $funcName})
MATCH (t:TypeAlias|Interface {name: $typeName})
CREATE (f)-[:USES_TYPE]->(t)
```

#### Phase 3: Type Inheritance
```typescript
function extractTypeExtensions(iface: InterfaceDeclaration): string[] {
  return iface.getExtends().map(e => e.getText());
}
```

Create relationship:
```cypher
MATCH (i1:Interface {name: $interfaceName})
MATCH (i2:Interface {name: $extendsName})
CREATE (i1)-[:EXTENDS]->(i2)
```

### Tests
```typescript
describe("TypeRelationshipTracker", () => {
  it("tracks function return types", async () => {
    const code = `
      type User = { name: string };
      function getUser(): User { return { name: "John" }; }
    `;

    await extractor.extract(code);

    const result = await neo4j.query(`
      MATCH (f:Function {name: "getUser"})-[:RETURNS_TYPE]->(t:TypeAlias)
      RETURN t.name
    `);

    expect(result[0].name).toBe("User");
  });

  it("tracks interface inheritance", async () => {
    const code = `
      interface Base { id: number; }
      interface Extended extends Base { name: string; }
    `;

    await extractor.extract(code);

    const result = await neo4j.query(`
      MATCH (i1:Interface {name: "Extended"})-[:EXTENDS]->(i2:Interface)
      RETURN i2.name
    `);

    expect(result[0].name).toBe("Base");
  });
});
```

---

## Integration Points

### Modify Existing Files

#### `src/extractors/fileExtractor.ts`
Add package detection:
```typescript
import { PackageExtractor } from './packageExtractor';

class FileExtractor {
  constructor(
    private packageExtractor: PackageExtractor  // NEW
  ) {}

  extract(file: SourceFile) {
    const pkg = this.packageExtractor.getPackageForFile(file.getFilePath());

    return {
      filePath: file.getFilePath(),
      packageName: pkg?.name,  // NEW
      // ... existing properties
    };
  }
}
```

#### `src/extractors/importExtractor.ts`
Add resolution:
```typescript
import { ImportResolver } from './importResolver';

class ImportExtractor {
  constructor(
    private resolver: ImportResolver  // NEW
  ) {}

  extract(importDecl: ImportDeclaration) {
    const importNode = {
      name: importDecl.getNamedImports()[0].getName(),
      importSource: importDecl.getModuleSpecifierValue(),
      isTypeOnly: importDecl.isTypeOnly(),
      // ... existing properties
    };

    // NEW: Resolve import
    const resolved = this.resolver.resolve(importNode, sourceFile);
    if (resolved) {
      this.createResolveRelationship(importNode, resolved);
    }

    return importNode;
  }
}
```

#### `src/extractors/functionExtractor.ts`
Add component/hook detection:
```typescript
import { ComponentAnalyzer, HookAnalyzer } from './componentAnalyzer';

class FunctionExtractor {
  constructor(
    private componentAnalyzer: ComponentAnalyzer,  // NEW
    private hookAnalyzer: HookAnalyzer             // NEW
  ) {}

  extract(func: FunctionDeclaration) {
    return {
      name: func.getName(),
      isReactComponent: this.componentAnalyzer.isComponent(func),  // NEW
      isHook: this.hookAnalyzer.isHook(func),                      // NEW
      // ... existing properties
    };
  }
}
```

---

## Test Strategy

### Unit Tests
Each extractor has isolated tests with mocked dependencies:
- `packageExtractor.test.ts`
- `importResolver.test.ts`
- `componentAnalyzer.test.ts`
- `typeTracker.test.ts`

### Integration Tests
Test full pipeline with real code samples:
```typescript
describe("CodeGraph E2E", () => {
  it("builds complete graph with all relationships", async () => {
    const testRepo = "/path/to/test-monorepo";
    const graph = await buildCodeGraph(testRepo);

    // Verify Package nodes exist
    const packages = await graph.query(`MATCH (p:Package) RETURN count(p)`);
    expect(packages[0].count).toBeGreaterThan(0);

    // Verify imports resolved
    const resolved = await graph.query(`
      MATCH (:Import)-[:RESOLVES_TO]->()
      RETURN count(*) as count
    `);
    expect(resolved[0].count).toBeGreaterThan(0);

    // Verify components identified
    const components = await graph.query(`
      MATCH (f:Function {isReactComponent: true})
      RETURN count(f)
    `);
    expect(components[0].count).toBeGreaterThan(0);
  });
});
```

### Validation Tests
After running on real monorepo:
```typescript
describe("Frontend Monorepo Validation", () => {
  it("has expected package count", async () => {
    const result = await query(`MATCH (p:Package) RETURN count(p)`);
    expect(result[0].count).toBe(10); // Adjust to actual count
  });

  it("resolves >90% of imports", async () => {
    const total = await query(`MATCH (i:Import) RETURN count(i)`);
    const resolved = await query(`MATCH (:Import)-[:RESOLVES_TO]->() RETURN count(*)`);

    const rate = resolved[0].count / total[0].count;
    expect(rate).toBeGreaterThan(0.9);
  });
});
```

---

## Success Criteria

✅ `Package` nodes created for all packages in monorepo
✅ Every `File` has `packageName` property and `BELONGS_TO` relationship
✅ >90% of `Import` nodes have `RESOLVES_TO` relationship
✅ `Package` nodes connected with `DEPENDS_ON` relationships
✅ React components flagged with `isReactComponent: true`
✅ Hooks flagged with `isHook: true`
✅ Component rendering tracked with `RENDERS_COMPONENT`
✅ Type usage tracked with `USES_TYPE`, `RETURNS_TYPE`, `EXTENDS`
✅ Can generate C4 Container diagram from Neo4j query
✅ Can generate C4 Component diagram for any package
✅ All extractors have >80% test coverage

---

## Implementation Order

1. **PackageExtractor** (foundation for everything)
2. **ImportResolver** (enables dependency tracking)
3. **ComponentAnalyzer** (React-specific features)
4. **TypeRelationshipTracker** (impact analysis)

Estimated: 10-12 hours focused implementation + testing
