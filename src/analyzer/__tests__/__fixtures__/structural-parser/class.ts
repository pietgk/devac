export class UserService {
          private users: User[] = [];

          constructor() {}

          getUsers() {
            return this.users;
          }

          static create() {
            return new UserService();
          }
        }