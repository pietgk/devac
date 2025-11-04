import { describe, it, expect } from "vitest";
import { Project, ts } from "ts-morph";
import { ComponentAnalyzer } from "./component-analyzer.js";

describe("ComponentAnalyzer", () => {
  const analyzer = new ComponentAnalyzer();

  describe("React Component Detection", () => {
    it("should identify function component with JSX return", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Button.tsx",
        `
        export const Button = () => {
          return <button>Click me</button>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isComponent = analyzer.isReactComponent(arrowFunc);

      expect(isComponent).toBe(true);
    });

    it("should identify arrow function component", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Card.tsx",
        `
        const Card = () => <div>Card content</div>;
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isComponent = analyzer.isReactComponent(arrowFunc);

      expect(isComponent).toBe(true);
    });

    it("should not identify lowercase function as component", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "helper.tsx",
        `
        export const formatDate = () => {
          return <span>Date</span>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isComponent = analyzer.isReactComponent(arrowFunc);

      expect(isComponent).toBe(false);
    });

    it("should not identify component in .ts file", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Button.ts",
        `
        export const Button = () => {
          return { type: 'button' };
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isComponent = analyzer.isReactComponent(arrowFunc);

      expect(isComponent).toBe(false);
    });

    it("should identify component with JSX in body", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Modal.tsx",
        `
        export const Modal = ({ isOpen }: Props) => {
          if (!isOpen) return null;

          const content = <div>Modal content</div>;
          return content;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isComponent = analyzer.isReactComponent(arrowFunc);

      expect(isComponent).toBe(true);
    });
  });

  describe("React Hook Detection", () => {
    it("should identify hook by naming convention", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "useCounter.ts",
        `
        export const useCounter = (initial: number) => {
          const [count, setCount] = useState(initial);
          return { count, setCount };
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isHook = analyzer.isReactHook(arrowFunc);

      expect(isHook).toBe(true);
    });

    it("should not identify non-hook functions", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "utils.ts",
        `
        export const calculateTotal = (items: number[]) => {
          return items.reduce((sum, item) => sum + item, 0);
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const isHook = analyzer.isReactHook(arrowFunc);

      expect(isHook).toBe(false);
    });
  });

  describe("Rendered Components Detection", () => {
    it("should find components rendered by a component", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Dashboard.tsx",
        `
        export const Dashboard = () => {
          return (
            <div>
              <Header />
              <Sidebar />
              <MainContent>
                <DataTable />
              </MainContent>
            </div>
          );
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const rendered = analyzer.findRenderedComponents(arrowFunc);

      expect(rendered).toContain("Header");
      expect(rendered).toContain("Sidebar");
      expect(rendered).toContain("MainContent");
      expect(rendered).toContain("DataTable");
      expect(rendered.length).toBe(4);
    });

    it("should not include HTML elements", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Simple.tsx",
        `
        export const Simple = () => {
          return (
            <div>
              <span>Text</span>
              <button>Click</button>
              <CustomButton />
            </div>
          );
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const rendered = analyzer.findRenderedComponents(arrowFunc);

      expect(rendered).toEqual(["CustomButton"]);
      expect(rendered).not.toContain("div");
      expect(rendered).not.toContain("span");
      expect(rendered).not.toContain("button");
    });

    it("should handle self-closing components", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Layout.tsx",
        `
        export const Layout = () => {
          return (
            <Container>
              <Logo />
              <Navigation />
            </Container>
          );
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const rendered = analyzer.findRenderedComponents(arrowFunc);

      expect(rendered).toContain("Container");
      expect(rendered).toContain("Logo");
      expect(rendered).toContain("Navigation");
    });
  });

  describe("Hook Usage Detection (Enhanced)", () => {
    it("should detect direct hook calls", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "Component.tsx",
        `
        export const Component = () => {
          useEffect(() => {
            console.log('mounted');
          }, []);

          useState(0);

          return <div>Component</div>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const hooks = analyzer.findUsedHooks(arrowFunc);

      expect(hooks).toContain("useEffect");
      expect(hooks).toContain("useState");
    });

    it("should detect hooks in variable declarations", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "DataComponent.tsx",
        `
        export const DataComponent = () => {
          const data = useQuery('users');
          const mutation = useMutation('updateUser');

          return <div>{data}</div>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const hooks = analyzer.findUsedHooks(arrowFunc);

      expect(hooks).toContain("useQuery");
      expect(hooks).toContain("useMutation");
    });

    it("should detect hooks in destructuring", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "FormComponent.tsx",
        `
        export const FormComponent = () => {
          const { data, isLoading } = useGetDataQuery();
          const [count, setCount] = useState(0);

          return <div>{count}</div>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const hooks = analyzer.findUsedHooks(arrowFunc);

      expect(hooks).toContain("useGetDataQuery");
      expect(hooks).toContain("useState");
    });

    it("should detect hooks from property access", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "HooksComponent.tsx",
        `
        import React from 'react';

        export const HooksComponent = () => {
          const [state, setState] = React.useState(0);

          React.useEffect(() => {
            console.log(state);
          }, [state]);

          return <div>{state}</div>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const hooks = analyzer.findUsedHooks(arrowFunc);

      expect(hooks).toContain("useState");
      expect(hooks).toContain("useEffect");
    });

    it("should not duplicate hook names", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "MultiUse.tsx",
        `
        export const MultiUse = () => {
          const [name, setName] = useState('');
          const [age, setAge] = useState(0);
          const [email, setEmail] = useState('');

          return <div>{name}</div>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const hooks = analyzer.findUsedHooks(arrowFunc);

      // Should only include useState once despite multiple uses
      expect(hooks.filter((h) => h === "useState").length).toBe(1);
    });

    it("should handle custom hooks", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(
        "CustomHookUser.tsx",
        `
        export const CustomHookUser = () => {
          const { isOpen, toggle } = useToggle();
          const data = useCustomData('key');

          return <div onClick={toggle}>{data}</div>;
        };
      `,
      );

      const varDecl = sourceFile.getVariableDeclarations()[0]!;
      const arrowFunc = varDecl.getInitializerIfKindOrThrow(
        ts.SyntaxKind.ArrowFunction,
      );
      const hooks = analyzer.findUsedHooks(arrowFunc);

      expect(hooks).toContain("useToggle");
      expect(hooks).toContain("useCustomData");
    });
  });
});
