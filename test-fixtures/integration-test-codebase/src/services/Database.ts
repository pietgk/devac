import type { User, Post } from "../types.js";

export class Database {
  private users: Map<string, User> = new Map();
  private posts: Map<string, Post> = new Map();

  async saveUser(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async savePost(post: Post): Promise<void> {
    this.posts.set(post.id, post);
  }

  async findPostById(id: string): Promise<Post | null> {
    return this.posts.get(id) || null;
  }

  async findPostsByAuthor(authorId: string): Promise<Post[]> {
    const posts: Post[] = [];
    for (const post of this.posts.values()) {
      if (post.authorId === authorId) {
        posts.push(post);
      }
    }
    return posts;
  }
}
