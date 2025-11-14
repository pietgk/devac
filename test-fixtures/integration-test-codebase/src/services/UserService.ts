import type { User, UserRole } from "../types.js";
import { ValidationError } from "../types.js";
import { Validator } from "../utils/validator.js";
import { Database } from "./Database.js";

export class UserService {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async createUser(name: string, email: string, role: UserRole): Promise<User> {
    // Validate inputs
    Validator.validateRequired(name, "Name");
    Validator.validateRequired(email, "Email");
    Validator.validateLength(name, 2, 50, "Name");

    if (!Validator.validateEmail(email)) {
      throw new ValidationError("Invalid email format");
    }

    // Check if user exists
    const existing = await this.db.findUserByEmail(email);
    if (existing) {
      throw new ValidationError("User already exists");
    }

    // Create user
    const user: User = {
      id: this.generateId(),
      name,
      email,
      role,
    };

    await this.db.saveUser(user);
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.db.findUserById(id);
  }

  async updateUserRole(userId: string, newRole: UserRole): Promise<User> {
    const user = await this.db.findUserById(userId);
    if (!user) {
      throw new ValidationError("User not found");
    }

    user.role = newRole;
    await this.db.saveUser(user);
    return user;
  }

  private generateId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
