/**
 * Simple calculator module for testing CodeGraph analysis
 */

export interface CalculatorOptions {
  precision: number;
  roundUp: boolean;
}

export class Calculator {
  private history: number[] = [];
  private options: CalculatorOptions;

  constructor(options: CalculatorOptions = { precision: 2, roundUp: false }) {
    this.options = options;
  }

  /**
   * Adds two numbers and tracks the result
   */
  add(a: number, b: number): number {
    const result = a + b;
    this.trackResult(result);
    return this.formatResult(result);
  }

  /**
   * Subtracts b from a
   */
  subtract(a: number, b: number): number {
    const result = a - b;
    this.trackResult(result);
    return this.formatResult(result);
  }

  /**
   * Multiplies two numbers
   */
  multiply(a: number, b: number): number {
    const result = a * b;
    this.trackResult(result);
    return this.formatResult(result);
  }

  /**
   * Divides a by b (throws if b is zero)
   */
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error("Division by zero");
    }
    const result = a / b;
    this.trackResult(result);
    return this.formatResult(result);
  }

  /**
   * Gets the calculation history
   */
  getHistory(): number[] {
    return [...this.history];
  }

  /**
   * Clears the calculation history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Private method to track results
   */
  private trackResult(result: number): void {
    this.history.push(result);
  }

  /**
   * Private method to format results based on options
   */
  private formatResult(result: number): number {
    const factor = Math.pow(10, this.options.precision);
    if (this.options.roundUp) {
      return Math.ceil(result * factor) / factor;
    }
    return Math.round(result * factor) / factor;
  }
}

/**
 * Utility function to perform a series of calculations
 */
export function performCalculations(
  calc: Calculator,
  operations: Array<{ op: string; a: number; b: number }>
): number[] {
  const results: number[] = [];

  for (const operation of operations) {
    try {
      let result: number;
      switch (operation.op) {
        case "add":
          result = calc.add(operation.a, operation.b);
          break;
        case "subtract":
          result = calc.subtract(operation.a, operation.b);
          break;
        case "multiply":
          result = calc.multiply(operation.a, operation.b);
          break;
        case "divide":
          result = calc.divide(operation.a, operation.b);
          break;
        default:
          throw new Error(`Unknown operation: ${operation.op}`);
      }
      results.push(result);
    } catch (error) {
      console.error(`Error in operation ${operation.op}:`, error);
      results.push(NaN);
    }
  }

  return results;
}
