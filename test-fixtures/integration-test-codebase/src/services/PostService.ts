import type { Post, User } from "../types.js";
import { ValidationError } from "../types.js";
import { Validator } from "../utils/validator.js";
import { Database } from "./Database.js";
import { UserService } from "./UserService.js";

export class PostService {
  private db: Database;
  private userService: UserService;

  constructor(database: Database, userService: UserService) {
    this.db = database;
    this.userService = userService;
  }

  async createPost(
    title: string,
    content: string,
    authorId: string
  ): Promise<Post> {
    // Validate inputs
    Validator.validateRequired(title, "Title");
    Validator.validateRequired(content, "Content");
    Validator.validateLength(title, 5, 200, "Title");
    Validator.validateLength(content, 10, 5000, "Content");

    // Verify author exists
    const author = await this.userService.getUserById(authorId);
    if (!author) {
      throw new ValidationError("Author not found");
    }

    // Create post
    const post: Post = {
      id: this.generateId(),
      title,
      content,
      authorId,
      createdAt: new Date(),
    };

    await this.db.savePost(post);
    return post;
  }

  async getPostById(id: string): Promise<Post | null> {
    return this.db.findPostById(id);
  }

  async getPostsByAuthor(authorId: string): Promise<Post[]> {
    return this.db.findPostsByAuthor(authorId);
  }

  async getPostWithAuthor(postId: string): Promise<{
    post: Post;
    author: User;
  } | null> {
    const post = await this.db.findPostById(postId);
    if (!post) {
      return null;
    }

    const author = await this.userService.getUserById(post.authorId);
    if (!author) {
      throw new ValidationError("Post author not found");
    }

    return { post, author };
  }

  private generateId(): string {
    return `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
