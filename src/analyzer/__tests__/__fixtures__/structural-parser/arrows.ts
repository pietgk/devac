const greet = (name: string) => `Hello, ${name}`;
        const add = (a: number, b: number) => a + b;

        export const asyncFetch = async () => {
          return await fetch("/api/data");
        };