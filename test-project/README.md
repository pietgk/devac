# Test Calculator Project

This is a simple TypeScript calculator application used for testing CodeGraph MCP analysis.

## Structure

- `src/calculator.ts` - Calculator class with basic operations
- `src/index.ts` - Main entry point and demo runner
- `src/utils.ts` - Utility functions for formatting and validation

## Features to Analyze

- **Classes**: `Calculator` class with multiple methods
- **Interfaces**: `CalculatorOptions`, `AppConfig`
- **Functions**: Standalone functions like `performCalculations`, `runDemo`
- **Function Calls**: Multiple call relationships between modules
- **Imports**: Cross-file dependencies
- **Error Handling**: Try-catch blocks in `performCalculations`

## Expected Analysis Results

When analyzed by CodeGraph, this project should produce:

- **3 File nodes** (calculator.ts, index.ts, utils.ts)
- **15+ Function nodes** (class methods + standalone functions)
- **2 Interface nodes**
- **Multiple CALLS relationships** between functions
- **IMPORTS relationships** between files
- **HAS_METHOD relationships** for the Calculator class
