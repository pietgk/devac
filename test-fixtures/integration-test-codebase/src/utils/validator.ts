import { ValidationError } from "../types.js";

export class Validator {
  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validateRequired(value: string | undefined, fieldName: string): void {
    if (!value || value.trim() === "") {
      throw new ValidationError(`${fieldName} is required`);
    }
  }

  static validateLength(
    value: string,
    min: number,
    max: number,
    fieldName: string
  ): void {
    if (value.length < min || value.length > max) {
      throw new ValidationError(
        `${fieldName} must be between ${min} and ${max} characters`
      );
    }
  }
}
