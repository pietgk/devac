/**
 * Utility functions for the calculator application
 */

/**
 * Logs calculation results to console
 */
export function logResults(results: number[]): void {
  console.log("Calculation Results:");
  results.forEach((result, index) => {
    console.log(`  ${index + 1}. ${formatNumber(result)}`);
  });
}

/**
 * Formats a number for display
 */
export function formatNumber(num: number): string {
  if (isNaN(num)) {
    return "Error";
  }
  return num.toFixed(2);
}

/**
 * Validates that a value is a number
 */
export function isValidNumber(value: any): boolean {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
}

/**
 * Safely parses a string to a number
 */
export function parseNumber(value: string): number | null {
  const parsed = parseFloat(value);
  return isValidNumber(parsed) ? parsed : null;
}

/**
 * Calculates the sum of an array of numbers
 */
export function sum(numbers: number[]): number {
  return numbers.reduce((acc, curr) => acc + curr, 0);
}

/**
 * Calculates the average of an array of numbers
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  return sum(numbers) / numbers.length;
}
