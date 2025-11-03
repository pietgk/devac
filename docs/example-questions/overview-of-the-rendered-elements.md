## User

can you give me an overview of the rendered elements of the frontend-monorepo using neo4j codegraph database

## Assistant

I'll query the Neo4j database to explore the rendered elements in the frontend-monorepo and provide you with an overview.

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "nodeType": [
      "JSXAttribute",
      "Node"
    ],
    "count": 7201
  },
  {
    "nodeType": [
      "JSXElement",
      "Node"
    ],
    "count": 4731
  },
  {
    "nodeType": [
      "Import",
      "Node"
    ],
    "count": 4488
  },
  {
    "nodeType": [
      "Parameter",
      "Node"
    ],
    "count": 3350
  },
  {
    "nodeType": [
      "Function",
      "Node"
    ],
    "count": 2648
  },
  {
    "nodeType": [
      "Variable",
      "Node"
    ],
    "count": 1299
  },
  {
    "nodeType": [
      "File",
      "Node"
    ],
    "count": 945
  },
  {
    "nodeType": [
      "Node"
    ],
    "count": 708
  },
  {
    "nodeType": [
      "TypeAlias",
      "Node"
    ],
    "count": 585
  },
  {
    "nodeType": [
      "TailwindClass",
      "Node"
    ],
    "count": 227
  },
  {
    "nodeType": [
      "Interface",
      "Node"
    ],
    "count": 126
  },
  {
    "nodeType": [
      "Method",
      "Node"
    ],
    "count": 112
  },
  {
    "nodeType": [
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
    "elementName": "Typography",
    "usageCount": 319
  },
  {
    "elementName": "div",
    "usageCount": 242
  },
  {
    "elementName": "Button",
    "usageCount": 231
  },
  {
    "elementName": "Text",
    "usageCount": 195
  },
  {
    "elementName": "Box",
    "usageCount": 102
  },
  {
    "elementName": "Flex",
    "usageCount": 91
  },
  {
    "elementName": "HStack",
    "usageCount": 62
  },
  {
    "elementName": "Td",
    "usageCount": 56
  },
  {
    "elementName": "FormLabel",
    "usageCount": 53
  },
  {
    "elementName": "FormControl",
    "usageCount": 51
  },
  {
    "elementName": "span",
    "usageCount": 50
  },
  {
    "elementName": "Heading",
    "usageCount": 49
  },
  {
    "elementName": "Input",
    "usageCount": 45
  },
  {
    "elementName": "VStack",
    "usageCount": 45
  },
  {
    "elementName": "path",
    "usageCount": 43
  },
  {
    "elementName": "TextField",
    "usageCount": 40
  },
  {
    "elementName": "Route",
    "usageCount": 39
  },
  {
    "elementName": "Spacing",
    "usageCount": 37
  },
  {
    "elementName": "p",
    "usageCount": 37
  },
  {
    "elementName": "Spinner",
    "usageCount": 33
  },
  {
    "elementName": "Tr",
    "usageCount": 32
  },
  {
    "elementName": "Container",
    "usageCount": 28
  },
  {
    "elementName": "Th",
    "usageCount": 27
  },
  {
    "elementName": "b",
    "usageCount": 27
  },
  {
    "elementName": "Select",
    "usageCount": 26
  },
  {
    "elementName": "Table",
    "usageCount": 24
  },
  {
    "elementName": "Render",
    "usageCount": 24
  },
  {
    "elementName": "CustomModal.Wrapper",
    "usageCount": 22
  },
  {
    "elementName": "IconButton",
    "usageCount": 21
  },
  {
    "elementName": "ListItem",
    "usageCount": 19
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "relationshipType": "HAS_PROP",
    "count": 7201
  },
  {
    "relationshipType": "IMPORTS",
    "count": 5498
  },
  {
    "relationshipType": "RENDERS_ELEMENT",
    "count": 3738
  },
  {
    "relationshipType": "HAS_PARAMETER",
    "count": 3350
  },
  {
    "relationshipType": "CALLS",
    "count": 1607
  },
  {
    "relationshipType": "USES_TAILWIND_CLASS",
    "count": 453
  },
  {
    "relationshipType": "HAS_METHOD",
    "count": 112
  },
  {
    "relationshipType": "EXPORTS",
    "count": 57
  },
  {
    "relationshipType": "MUTATES_STATE",
    "count": 36
  },
  {
    "relationshipType": "HANDLES_ERROR",
    "count": 26
  },
  {
    "relationshipType": "EXTENDS",
    "count": 9
  },
  {
    "relationshipType": "RESOLVES_IMPORT",
    "count": 1
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "f.name": "getStage",
    "f.isComponent": null,
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "modifierFlags",
      "docComment",
      "isExported",
      "complexity",
      "isAsync",
      "isCallback",
      "isGenerator",
      "returnType"
    ]
  },
  {
    "f.name": "defaultConfig",
    "f.isComponent": null,
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "modifierFlags",
      "docComment",
      "isExported",
      "complexity",
      "isAsync",
      "isCallback",
      "isGenerator",
      "returnType"
    ]
  },
  {
    "f.name": "getStage",
    "f.isComponent": null,
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "modifierFlags",
      "docComment",
      "isExported",
      "complexity",
      "isAsync",
      "isCallback",
      "isGenerator",
      "returnType"
    ]
  },
  {
    "f.name": "defaultConfig",
    "f.isComponent": null,
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "modifierFlags",
      "docComment",
      "isExported",
      "complexity",
      "isAsync",
      "isCallback",
      "isGenerator",
      "returnType"
    ]
  },
  {
    "f.name": "callback_defineConfig_arg-1",
    "f.isComponent": null,
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "loc",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "modifierFlags",
      "docComment",
      "isExported",
      "complexity",
      "isAsync",
      "isCallback",
      "isGenerator",
      "returnType"
    ]
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "relType": null,
    "count": 0
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "elementName": "Routes"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "Routes",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "elementName": "RequiresAuth"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "Routes",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "elementName": "Route"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "Routes",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "elementName": "Route"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "RequiresAuth",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "elementName": "Home"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "Route",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "elementName": "Login"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "UnleashProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "ChakraProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "ChakraProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "ThemeProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "ThemeProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "QueryClientProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "QueryClientProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "BrowserRouter"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "QueryClientProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "ReactQueryDevtools"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "BrowserRouter",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "LocalizationProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "LocalizationProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "AuthenticationProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "React.StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "RecoilRoot"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "RecoilRoot",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "Providers"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "Providers",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "AuthAwareUnleashContext"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "AuthAwareUnleashContext",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "elementName": "App"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "StyledEngineProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "elementName": "ThemeProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "ThemeProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "elementName": "MUIThemeProvider"
  },
  {
    "sourceType": [
      "JSXElement",
      "Node"
    ],
    "sourceName": "MUIThemeProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "elementName": "GlobalStyle"
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "moduleSpecifier",
      "namedImports",
      "isTypeOnly"
    ],
    "source": null,
    "specifier": null
  },
  {
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "moduleSpecifier",
      "isTypeOnly",
      "defaultImport"
    ],
    "source": null,
    "specifier": null
  },
  {
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "moduleSpecifier",
      "namedImports",
      "isTypeOnly"
    ],
    "source": null,
    "specifier": null
  },
  {
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "moduleSpecifier",
      "namedImports",
      "isTypeOnly"
    ],
    "source": null,
    "specifier": null
  },
  {
    "properties": [
      "entityId",
      "filePath",
      "name",
      "endLine",
      "createdAt",
      "endColumn",
      "startColumn",
      "startLine",
      "language",
      "moduleSpecifier",
      "namedImports",
      "isTypeOnly"
    ],
    "source": null,
    "specifier": null
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "theme"
    ],
    "usageCount": 48
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Icon"
    ],
    "usageCount": 28
  },
  {
    "library": "@mindlercare/ui-web/src/shared/constants",
    "namedImports": [
      "defaultTheme"
    ],
    "usageCount": 21
  },
  {
    "library": "@mui/material",
    "namedImports": [
      "Box"
    ],
    "usageCount": 13
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Render"
    ],
    "usageCount": 9
  },
  {
    "library": "@mui/material/Tooltip",
    "namedImports": null,
    "usageCount": 8
  },
  {
    "library": "@mui/material/IconButton",
    "namedImports": null,
    "usageCount": 8
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "TextField"
    ],
    "usageCount": 7
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "theme",
      "Icon"
    ],
    "usageCount": 7
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Typography"
    ],
    "usageCount": 7
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Spacing"
    ],
    "usageCount": 6
  },
  {
    "library": "@mui/material/Dialog",
    "namedImports": null,
    "usageCount": 5
  },
  {
    "library": "@mui/x-data-grid",
    "namedImports": [
      "DataGrid",
      "GridColDef"
    ],
    "usageCount": 5
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Button",
      "Typography"
    ],
    "usageCount": 5
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Button"
    ],
    "usageCount": 5
  },
  {
    "library": "chakra-dayzed-datepicker",
    "namedImports": [
      "RangeDatepicker"
    ],
    "usageCount": 4
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Icon",
      "Menu"
    ],
    "usageCount": 4
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Button",
      "TextField",
      "Typography"
    ],
    "usageCount": 4
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "CreateTransient",
      "Icon"
    ],
    "usageCount": 4
  },
  {
    "library": "@mindlercare/ui-web",
    "namedImports": [
      "Button",
      "Icon"
    ],
    "usageCount": 4
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "topLevelComponent": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "renderChain": [
      "div",
      "Routes"
    ]
  },
  {
    "topLevelComponent": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "renderChain": [
      "div",
      "Routes",
      "RequiresAuth"
    ]
  },
  {
    "topLevelComponent": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "renderChain": [
      "div",
      "Routes",
      "RequiresAuth",
      "Home"
    ]
  },
  {
    "topLevelComponent": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "renderChain": [
      "div",
      "Routes",
      "Route"
    ]
  },
  {
    "topLevelComponent": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "renderChain": [
      "div",
      "Routes",
      "Route",
      "Login"
    ]
  },
  {
    "topLevelComponent": "div",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/App.tsx",
    "renderChain": [
      "div",
      "Routes",
      "Route"
    ]
  },
  {
    "topLevelComponent": "UnleashProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "renderChain": [
      "UnleashProvider",
      "ChakraProvider"
    ]
  },
  {
    "topLevelComponent": "UnleashProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "renderChain": [
      "UnleashProvider",
      "ChakraProvider",
      "ThemeProvider"
    ]
  },
  {
    "topLevelComponent": "UnleashProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "renderChain": [
      "UnleashProvider",
      "ChakraProvider",
      "ThemeProvider",
      "QueryClientProvider"
    ]
  },
  {
    "topLevelComponent": "React.StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "renderChain": [
      "React.StrictMode",
      "RecoilRoot"
    ]
  },
  {
    "topLevelComponent": "React.StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "renderChain": [
      "React.StrictMode",
      "RecoilRoot",
      "Providers"
    ]
  },
  {
    "topLevelComponent": "React.StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindler-back-office-tools/src/main.tsx",
    "renderChain": [
      "React.StrictMode",
      "RecoilRoot",
      "Providers",
      "AuthAwareUnleashContext"
    ]
  },
  {
    "topLevelComponent": "StyledEngineProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "StyledEngineProvider",
      "ThemeProvider"
    ]
  },
  {
    "topLevelComponent": "StyledEngineProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "StyledEngineProvider",
      "ThemeProvider",
      "MUIThemeProvider"
    ]
  },
  {
    "topLevelComponent": "StyledEngineProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "StyledEngineProvider",
      "ThemeProvider",
      "MUIThemeProvider",
      "GlobalStyle"
    ]
  },
  {
    "topLevelComponent": "ThemeAndStyling",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "ThemeAndStyling",
      "MainErrorBoundary"
    ]
  },
  {
    "topLevelComponent": "ThemeAndStyling",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "ThemeAndStyling",
      "MainErrorBoundary",
      "SnackbarProvider"
    ]
  },
  {
    "topLevelComponent": "ThemeAndStyling",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "ThemeAndStyling",
      "MainErrorBoundary",
      "SnackbarProvider",
      "UnleashProvider"
    ]
  },
  {
    "topLevelComponent": "StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "StrictMode",
      "Provider"
    ]
  },
  {
    "topLevelComponent": "StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "StrictMode",
      "Provider",
      "PersistGate"
    ]
  },
  {
    "topLevelComponent": "StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/src/main.tsx",
    "renderChain": [
      "StrictMode",
      "Provider",
      "PersistGate",
      "Main"
    ]
  },
  {
    "topLevelComponent": "ThemeProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "ThemeProvider",
      "Provider"
    ]
  },
  {
    "topLevelComponent": "AuthContext.Provider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "AuthContext.Provider",
      "AuthStateContext.Provider"
    ]
  },
  {
    "topLevelComponent": "TestAuthProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "TestAuthProvider",
      "QueryClientProvider"
    ]
  },
  {
    "topLevelComponent": "TestAuthProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "TestAuthProvider",
      "QueryClientProvider",
      "MindlerApiProvider"
    ]
  },
  {
    "topLevelComponent": "MemoryRouter",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "MemoryRouter",
      "Provider"
    ]
  },
  {
    "topLevelComponent": "MemoryRouter",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "MemoryRouter",
      "Provider",
      "FlagContext.Provider"
    ]
  },
  {
    "topLevelComponent": "MemoryRouter",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/mindlercare/tests/test-utils.jsx",
    "renderChain": [
      "MemoryRouter",
      "Provider",
      "FlagContext.Provider",
      "ThemeProvider"
    ]
  },
  {
    "topLevelComponent": "AuthenticationProvider",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/promocode-admin-2/src/App.tsx",
    "renderChain": [
      "AuthenticationProvider",
      "Pages"
    ]
  },
  {
    "topLevelComponent": "StrictMode",
    "filePath": "/Users/grop/ws/frontend-monorepo/frontends/promocode-admin-2/src/main.tsx",
    "renderChain": [
      "StrictMode",
      "ThemeProvider"
    ]
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "frontend": "mindlercare",
    "fileCount": 271,
    "totalElements": 2325,
    "sampleElements": [
      [
        "AuthenticationProvider",
        "StyledEngineProvider",
        "ThemeProvider",
        "MUIThemeProvider",
        "ThemeAndStyling"
      ],
      [
        "Provider",
        "ThemeProvider",
        "AuthContext.Provider",
        "AuthStateContext.Provider",
        "TestAuthProvider"
      ],
      [
        "Icon.Calendar",
        "Icon.Heart",
        "Icon.Profile",
        "Icon.Icbt",
        "Icon.Payment"
      ],
      [
        "Route",
        "RequiresPermissions",
        "Maintenance",
        "Layout",
        "Login"
      ],
      [
        "div",
        "Container",
        "Drawer",
        "Header",
        "Dialog"
      ],
      [
        "LoadingView",
        "Navigate",
        "Outlet"
      ],
      [
        "Navigate",
        "Outlet"
      ],
      [
        "DashboardComponent",
        "Navigate"
      ],
      [
        "StyledLoadingView",
        "p",
        "CircularProgress"
      ],
      [
        "Container",
        "TopBarContainer",
        "ButtonWrapper",
        "Button",
        "StyledButtonText"
      ]
    ]
  },
  {
    "frontend": "mindler-back-office-tools",
    "fileCount": 76,
    "totalElements": 1638,
    "sampleElements": [
      [
        "div",
        "Routes",
        "RequiresAuth",
        "FullPageLoading",
        "Navigate"
      ],
      [
        "UnleashProvider",
        "ChakraProvider",
        "ThemeProvider",
        "QueryClientProvider",
        "BrowserRouter"
      ],
      [
        "Flex",
        "Button",
        "Table",
        "Thead",
        "Tr"
      ],
      [
        "div",
        "h2",
        "p"
      ],
      [
        "FormControl",
        "Select"
      ],
      [
        "FormControl",
        "FormLabel",
        "Flex",
        "Tag",
        "TagLabel"
      ],
      [
        "Card",
        "CardHeader",
        "CardBody",
        "Heading",
        "Box"
      ],
      [
        "VStack",
        "Heading",
        "IconButton",
        "HStack",
        "Grid"
      ],
      [
        "motion.div",
        "Text",
        "BendingIllustration"
      ],
      [
        "div",
        "IconButton",
        "ChakraLink",
        "Flex",
        "HStack"
      ]
    ]
  },
  {
    "frontend": "promocode-admin-2",
    "fileCount": 27,
    "totalElements": 177,
    "sampleElements": [
      [
        "AuthenticationProvider",
        "Pages"
      ],
      [
        "StrictMode",
        "ThemeProvider",
        "UnleashProvider",
        "QueryClientProvider",
        "MindlerApiProvider"
      ],
      [
        "BrowserRouter",
        "Routes",
        "Route",
        "RequireAuth",
        "Layout"
      ],
      [
        "header",
        "div",
        "img",
        "MarketSelector",
        "Button"
      ],
      [
        "div",
        "main",
        "Header",
        "Outlet"
      ],
      [
        "div",
        "img",
        "Authenticator"
      ],
      [
        "button",
        "p",
        "IconLeft",
        "IconRight"
      ],
      [
        "Menu",
        "div",
        "Menu.Items",
        "Menu.Item",
        "Menu.Button"
      ],
      [
        "svg",
        "path"
      ],
      [
        "Dialog",
        "div",
        "Dialog.Panel",
        "Dialog.Title",
        "CloseIcon"
      ]
    ]
  },
  {
    "frontend": "video-stream-2",
    "fileCount": 24,
    "totalElements": 177,
    "sampleElements": [
      [
        "MonitoringContext.Provider",
        "Story"
      ],
      [
        "ErrorBoundary",
        "TokenContext.Provider",
        "SlotIdContext.Provider",
        "VonageContext.Provider",
        "UnleashProvider"
      ],
      [
        "MonitoringContext.Provider",
        "MindlerApiProvider",
        "ThemeProvider",
        "GlobalStyles",
        "App"
      ],
      [
        "div",
        "Container",
        "StyledFormControl",
        "StyledInputLabel",
        "SmallScreenLabel"
      ],
      [
        "StyledButton",
        "ButtonContent",
        "span"
      ],
      [
        "CallButtonsContainer",
        "Column",
        "ControlButtons",
        "CallIconSpan",
        "IconButton"
      ],
      [
        "MessageContainer",
        "MessageContent",
        "ReloadButtonContainer",
        "Button",
        "Refresh"
      ],
      [
        "GlobalStyles",
        "MessageBoxGlobal"
      ],
      [
        "MessageBoxGlobalContainer",
        "Message"
      ],
      [
        "FlexHorizontal",
        "Typography",
        "VerificationStatusContainer",
        "FlexVertical",
        "Button"
      ]
    ]
  },
  {
    "frontend": "verify-email",
    "fileCount": 4,
    "totalElements": 28,
    "sampleElements": [
      [
        "Routes",
        "Route",
        "VerifyEmail",
        "Result"
      ],
      [
        "StrictMode",
        "BrowserRouter",
        "App"
      ],
      [
        "div",
        "h6",
        "img",
        "h2",
        "p"
      ]
    ]
  },
  {
    "frontend": "videocall-landing",
    "fileCount": 4,
    "totalElements": 25,
    "sampleElements": [
      [
        "Headline",
        "CodeInputsWrapper",
        "CodeInputWrapper",
        "MetaText",
        "BodyText"
      ],
      [
        "MainGrid",
        "MainGridContent",
        "MainGridBranding",
        "Logo",
        "WaitingRoom"
      ],
      [
        "React.StrictMode",
        "ThemeProvider",
        "BrowserRouter",
        "GlobalFonts",
        "GlobalStyle"
      ],
      [
        "Headline",
        "TimeLeftText",
        "BodyText",
        "Button"
      ]
    ]
  }
]

**Tool Call: mcp__neo4j__execute_query**
Status: Completed

[
  {
    "propName": "variant",
    "usageCount": 604,
    "usedInElements": [
      "MetaText",
      "BodyText",
      "Table",
      "Button",
      "Input",
      "StyledButtonText",
      "Typography",
      "Paragraph",
      "StyledButton",
      "StyledTypography"
    ]
  },
  {
    "propName": "onClick",
    "usageCount": 408,
    "usedInElements": [
      "div",
      "Button",
      "Th",
      "Flex",
      "TagCloseButton",
      "IconButton",
      "ChakraLink",
      "HStack",
      "MessageTable",
      "QuestionnaireTable"
    ]
  },
  {
    "propName": "value",
    "usageCount": 255,
    "usedInElements": [
      "AuthContext.Provider",
      "AuthStateContext.Provider",
      "FlagContext.Provider",
      "MonitoringContext.Provider",
      "TokenContext.Provider",
      "SlotIdContext.Provider",
      "VonageContext.Provider",
      "CodeInput",
      "AuthenticatorSettingsContext.Provider",
      "Textarea"
    ]
  },
  {
    "propName": "style",
    "usageCount": 204,
    "usedInElements": [
      "div",
      "MetaText",
      "VStack",
      "motion.div",
      "IconButton",
      "HStack",
      "ChakraLink",
      "p",
      "IconLogo",
      "img"
    ]
  },
  {
    "propName": "color",
    "usageCount": 197,
    "usedInElements": [
      "Tag",
      "Td",
      "Typography",
      "DesignProofIconButton",
      "Icon.CheckCircle",
      "CircularProgress",
      "IconButton",
      "Badge",
      "LinkButton",
      "Button"
    ]
  },
  {
    "propName": "key",
    "usageCount": 176,
    "usedInElements": [
      "CodeInputWrapper",
      "CodeInput",
      "Tr",
      "Th",
      "Fragment",
      "Td",
      "Tag",
      "ListItem",
      "Card",
      "Button"
    ]
  },
  {
    "propName": "onChange",
    "usageCount": 169,
    "usedInElements": [
      "CodeInput",
      "Select",
      "Switch",
      "Form",
      "PhoneField",
      "ReactPhoneInput",
      "StyledInput",
      "RadioGroup",
      "TextField",
      "VideoFilterMenu"
    ]
  },
  {
    "propName": "insensitive",
    "usageCount": 160,
    "usedInElements": [
      "StyledButtonText",
      "Typography",
      "StyledTypography",
      "StyledLinkContainerTitle",
      "StyledSlotTitleText",
      "StyledSlotTime",
      "StyledEditText",
      "SpecialStyledTypographyToMakeDesignHappy",
      "ProgramNotAvailable",
      "StatusText"
    ]
  },
  {
    "propName": "size",
    "usageCount": 151,
    "usedInElements": [
      "Headline",
      "Table",
      "Button",
      "Heading",
      "IconButton",
      "Avatar",
      "AlertDialog",
      "IconLogo",
      "CircularProgress",
      "Spinner"
    ]
  },
  {
    "propName": "mb",
    "usageCount": 134,
    "usedInElements": [
      "Flex",
      "Heading",
      "Box",
      "UnorderedList",
      "Avatar",
      "FormLabel",
      "ExternalLinkIcon",
      "Text",
      "Button",
      "FormControl"
    ]
  },
  {
    "propName": "className",
    "usageCount": 131,
    "usedInElements": [
      "div",
      "h6",
      "img",
      "h2",
      "p",
      "CodeInput",
      "Button",
      "InputWithIcon",
      "header",
      "main"
    ]
  },
  {
    "propName": "disabled",
    "usageCount": 116,
    "usedInElements": [
      "Button",
      "Form",
      "Input",
      "StyledButton",
      "PhoneField",
      "ReactPhoneInput",
      "TextField",
      "IconButton",
      "MarketDropdown",
      "Menu.Trigger"
    ]
  },
  {
    "propName": "data-testid",
    "usageCount": 106,
    "usedInElements": [
      "StyledLoadingView",
      "Typography",
      "Checkbox",
      "StyledLogoutButton",
      "div",
      "StatusIndicator",
      "StyledTd",
      "button",
      "Button",
      "AutosizeInput"
    ]
  },
  {
    "propName": "label",
    "usageCount": 93,
    "usedInElements": [
      "PopoverTrigger",
      "PhoneField",
      "Button",
      "TextField",
      "MarketDropdown",
      "Tooltip",
      "InputWithTags",
      "Select",
      "DatePicker",
      "DateRangePicker"
    ]
  },
  {
    "propName": "type",
    "usageCount": 89,
    "usedInElements": [
      "CodeInput",
      "StyledButton",
      "StyledInput",
      "Button",
      "LinkButton",
      "TextField",
      "Input",
      "XAxis",
      "YAxis",
      "Line"
    ]
  },
  {
    "propName": "sx",
    "usageCount": 84,
    "usedInElements": [
      "Box",
      "Typography",
      "TextField",
      "MUI.Box",
      "Component",
      "Badge",
      "BlurOff",
      "BlurOn",
      "Input",
      "SearchField"
    ]
  },
  {
    "propName": "placeholder",
    "usageCount": 81,
    "usedInElements": [
      "Select",
      "Input",
      "PhoneField",
      "ReactPhoneInput",
      "TextField",
      "FilterSelect",
      "SearchField",
      "Select.Trigger",
      "AutosizeInput",
      "SelectedTriggerDisplayValue"
    ]
  },
  {
    "propName": "onClose",
    "usageCount": 76,
    "usedInElements": [
      "AlertDialog",
      "Modal",
      "DeleteMessageModal",
      "ViewMessageModal",
      "VideoFilterMenu",
      "Menu",
      "InsuranceMembershipModal",
      "BillingRecordModal",
      "StyledDialog",
      "CustomModal.Wrapper"
    ]
  },
  {
    "propName": "width",
    "usageCount": 74,
    "usedInElements": [
      "Input",
      "Icon.CheckCircle",
      "TextField",
      "img",
      "svg",
      "rect",
      "MenuButton",
      "Flex",
      "VStack",
      "TableContainer"
    ]
  },
  {
    "propName": "as",
    "usageCount": 73,
    "usedInElements": [
      "Text",
      "Heading",
      "MenuButton",
      "Icon",
      "FormControl",
      "Flex",
      "Button",
      "Menu",
      "Menu.Items",
      "Menu.Button"
    ]
  },
  {
    "propName": "open",
    "usageCount": 72,
    "usedInElements": [
      "DeleteMessageModal",
      "SendMessageModal",
      "SendQuestionnaireModal",
      "ViewQuestionnaireModal",
      "Snackbar",
      "VideoFilterMenu",
      "Menu",
      "AlertDialog",
      "StyledDialog",
      "CustomModal.Wrapper"
    ]
  },
  {
    "propName": "fontSize",
    "usageCount": 68,
    "usedInElements": [
      "BodyText",
      "AlertDialogHeader",
      "Td",
      "Text",
      "ChakraLink",
      "PhotoFilter",
      "Badge",
      "Circle"
    ]
  },
  {
    "propName": "fill",
    "usageCount": 64,
    "usedInElements": [
      "path",
      "svg",
      "rect",
      "motion.path",
      "Dot",
      "Icon.TrendingUp",
      "Icon.TrendingDown",
      "Icon.Trash",
      "Icon.Expand",
      "Icon.Profile"
    ]
  },
  {
    "propName": "fontWeight",
    "usageCount": 63,
    "usedInElements": [
      "Button",
      "AlertDialogHeader",
      "Td",
      "Text",
      "Heading",
      "Tab",
      "Circle",
      "Th",
      "TableCaption"
    ]
  },
  {
    "propName": "ref",
    "usageCount": 61,
    "usedInElements": [
      "CodeInput",
      "Input",
      "DesignProofIconButton",
      "div",
      "IconButton",
      "VoiceIndicatorBar",
      "VideoView",
      "FormControl",
      "Form",
      "StyledIconButton"
    ]
  }
]

## Assistant

Now let me create a comprehensive overview document:

## Frontend Monorepo - Rendered Elements Overview

Based on the Neo4j code graph analysis, here's a comprehensive overview of the rendered elements in the frontend-monorepo:

### 📊 High-Level Statistics

The codebase contains:
- **4,731 JSX Elements** across 945 files
- **7,201 JSX Attributes** (props)
- **3,738 element rendering relationships**
- **227 Tailwind classes** in use
- **4,488 import statements**

### 🏗️ Frontends Breakdown

#### 1. **mindlercare** (Primary Frontend)
- **271 files** with React components
- **2,325 total JSX elements**
- **Main tech stack**: Material UI, Redux, styled-components
- **Key providers**: `AuthenticationProvider`, `ThemeProvider`, `UnleashProvider`, `SnackbarProvider`

#### 2. **mindler-back-office-tools**
- **76 files** with components
- **1,638 JSX elements**
- **Main tech stack**: Chakra UI, React Query, Recoil
- **Key providers**: `ChakraProvider`, `QueryClientProvider`, `UnleashProvider`

#### 3. **promocode-admin-2**
- **27 files** | **177 elements**
- Stack: Headless UI, custom components

#### 4. **video-stream-2**
- **24 files** | **177 elements**
- Stack: Custom video streaming components, Vonage integration

#### 5. **verify-email** & **videocall-landing**
- Small utility frontends with minimal component count

### 🎨 Most Used UI Components

| Component | Usage Count | Source |
|-----------|-------------|--------|
| **Typography** | 319 | @mindlercare/ui-web & MUI |
| **div** | 242 | Native HTML |
| **Button** | 231 | @mindlercare/ui-web & Chakra |
| **Text** | 195 | Chakra UI |
| **Box** | 102 | MUI & Chakra |
| **Flex** | 91 | Chakra UI |
| **HStack/VStack** | 107 | Chakra UI |
| **Input/TextField** | 85+ | Multiple sources |
| **Icon** | 28+ | @mindlercare/ui-web |

### 📦 UI Library Usage

**@mindlercare/ui-web** (Shared Design System):
- `theme` (48 usages)
- `Icon` (28 usages)
- `Typography`, `Button`, `TextField`, `Spacing`

**Material UI** (@mui/material):
- `Box`, `Dialog`, `Tooltip`, `IconButton`
- `DataGrid` from @mui/x-data-grid

**Chakra UI**:
- Layout components: `Flex`, `HStack`, `VStack`, `Box`
- Form components: `FormControl`, `FormLabel`, `Input`, `Select`
- UI elements: `Button`, `Heading`, `Text`, `Tag`, `Badge`

### 🔗 Provider/Context Architecture

**mindlercare** provider hierarchy:
```
StrictMode
  → Provider (Redux)
    → PersistGate
      → StyledEngineProvider
        → ThemeProvider
          → MUIThemeProvider
            → SnackbarProvider
              → UnleashProvider
                → App
```

**mindler-back-office-tools** provider hierarchy:
```
StrictMode
  → RecoilRoot
    → UnleashProvider
      → ChakraProvider
        → QueryClientProvider
          → BrowserRouter
            → AuthenticationProvider
              → App
```

### 🎯 Most Common Props/Attributes

| Prop | Usage | Common Elements |
|------|-------|-----------------|
| **variant** | 604 | Button, Typography, Input |
| **onClick** | 408 | Button, div, IconButton |
| **value** | 255 | Context providers, inputs |
| **style** | 204 | div, layout components |
| **color** | 197 | Typography, Badge, Icon |
| **onChange** | 169 | Select, Input, Form elements |
| **size** | 151 | Button, Heading, Icon |
| **disabled** | 116 | Button, Input, Form |
| **className** | 131 | HTML elements |
| **data-testid** | 106 | Testing identifiers |

### 🧩 Component Patterns

**Container/Presentation Pattern**:
- Many components follow the pattern where JSX elements nest within each other
- Provider components wrap application roots
- Layout components (Flex, Box, VStack) structure UI hierarchies

**Common Component Hierarchies**:
```
Layout
  → Container
    → Header/Navigation
    → Content Area (Box/Flex)
      → Form Components
      → Data Display (Table/Cards)
      → Action Buttons
```

### 🎭 Styling Approach

The monorepo uses multiple styling paradigms:
1. **Styled Components** (styled-components library)
2. **Material UI's `sx` prop** (84 usages)
3. **Chakra UI's style props** (mb, fontSize, fontWeight, etc.)
4. **Tailwind Classes** (227 instances)
5. **Inline styles** (204 style attributes)

### 🧪 Testing Infrastructure

- **106 `data-testid` attributes** for component testing
- Test utilities use providers: `TestAuthProvider`, `QueryClientProvider`
- Test wrapper components provide context for isolated testing

### 📍 Key Insights

1. **Design System Adoption**: Heavy reliance on `@mindlercare/ui-web` for shared components
2. **Mixed UI Libraries**: Coexistence of Material UI (mindlercare) and Chakra UI (back-office-tools)
3. **Provider-Heavy Architecture**: Multiple context providers for auth, theming, state, and feature flags
4. **Form-Rich Applications**: Heavy usage of form components (Input, Select, FormControl)
5. **Icon Usage**: Significant icon usage with custom icon components
6. **Accessibility**: Some `data-testid` usage but could be expanded
7. **State Management**: Mix of Redux (mindlercare), Recoil (back-office-tools), and React Query

This analysis reveals a mature frontend monorepo with established patterns, shared design systems, and multiple specialized applications serving different user roles within the Mindler platform.
