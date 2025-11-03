/**
 * Main entry point for the calculator application
 */

import { Calculator, performCalculations } from "./calculator";
import { logResults, formatNumber } from "./utils";

interface AppConfig {
  verbose: boolean;
  autoSave: boolean;
}

const config: AppConfig = {
  verbose: true,
  autoSave: false,
};

/**
 * Initializes the calculator with default options
 */
export function initCalculator(): Calculator {
  return new Calculator({
    precision: 2,
    roundUp: false,
  });
}

/**
 * Runs a demo calculation session
 */
export function runDemo(): void {
  const calc = initCalculator();

  if (config.verbose) {
    console.log("Starting calculator demo...");
  }

  const operations = [
    { op: "add", a: 10, b: 5 },
    { op: "subtract", a: 20, b: 8 },
    { op: "multiply", a: 6, b: 7 },
    { op: "divide", a: 100, b: 4 },
  ];

  const results = performCalculations(calc, operations);
  logResults(results);

  if (config.verbose) {
    const history = calc.getHistory();
    console.log(`Total calculations performed: ${history.length}`);
  }
}

/**
 * Formats and displays a summary
 */
export function displaySummary(numbers: number[]): string {
  const formatted = numbers.map(formatNumber);
  return `Summary: [${formatted.join(", ")}]`;
}

// Run demo if executed directly
if (require.main === module) {
  runDemo();
}
