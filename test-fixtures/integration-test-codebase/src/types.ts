// Base types for the test codebase

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export type UserRole = "admin" | "user" | "guest";

export interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
