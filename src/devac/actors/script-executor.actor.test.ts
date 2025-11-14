import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import {
  scriptExecutorActor,
  createScriptExecutorWithPackages,
  type ScriptExecutorInput,
  type ValidationResult,
} from "./script-executor.actor";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("ScriptExecutorActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should start in idle state", () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const actor = createActor(scriptExecutorActor, { input });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("idle");
      expect(snapshot.context.results.size).toBe(0);
      expect(snapshot.context.error).toBeNull();
    });

    it("should initialize with empty results map", () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a", "package-b"],
        validationCommand: "npm test",
      };

      const actor = createActor(scriptExecutorActor, { input });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.results).toBeInstanceOf(Map);
      expect(snapshot.context.results.size).toBe(0);
    });
  });

  describe("Package Execution", () => {
    it("should execute validation command for single package", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      // Mock successful child process
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      // Simulate child process execution
      setTimeout(() => {
        mockChild.stdout.emit("data", Buffer.from("Test output\n"));
        mockChild.emit("close", 0);
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const results =
        snapshot.output?.results ||
        Array.from(snapshot.context.results.values());

      expect(results).toHaveLength(1);
      expect(results[0].packageName).toBe("package-a");
      expect(results[0].exitCode).toBe(0);
      expect(results[0].output).toContain("Test output");
    });

    it("should execute validation for multiple packages in parallel", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a", "package-b"],
        validationCommand: "npm test",
      };

      // Track spawn calls
      const spawnCalls: string[] = [];
      vi.mocked(spawn).mockImplementation(((command: string, options: any) => {
        spawnCalls.push(options.cwd);
        const mockChild = new EventEmitter() as any;
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();

        // Simulate async completion
        setTimeout(() => {
          mockChild.stdout.emit("data", Buffer.from(`${options.cwd} output\n`));
          mockChild.emit("close", 0);
        }, 10);

        return mockChild;
      }) as any);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const results =
        snapshot.output?.results ||
        Array.from(snapshot.context.results.values());
      expect(results).toHaveLength(2);
      expect(spawnCalls).toContain("package-a");
      expect(spawnCalls).toContain("package-b");
    });

    it("should collect exit codes from validation results", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      setTimeout(() => {
        mockChild.stdout.emit("data", Buffer.from("Tests failed\n"));
        mockChild.emit("close", 1); // Non-zero exit code
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const results =
        snapshot.output?.results ||
        Array.from(snapshot.context.results.values());
      expect(results[0].exitCode).toBe(1);
    });
  });

  describe("Parent Communication", () => {
    it("should send VALIDATION_PROGRESS when starting", async () => {
      const parentEvents: any[] = [];
      const mockParent = {
        send: vi.fn((event) => parentEvents.push(event)),
      };

      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
        parent: mockParent,
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      // Wait for spawn to be called
      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.emit("close", 0);
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const progressEvents = parentEvents.filter(
        (e) => e.type === "VALIDATION_PROGRESS",
      );
      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0].packageName).toBe("package-a");
      expect(progressEvents[0].phase).toBe("starting");
    });

    it("should send VALIDATION_OUTPUT for stdout data", async () => {
      const parentEvents: any[] = [];
      const mockParent = {
        send: vi.fn((event) => parentEvents.push(event)),
      };

      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
        parent: mockParent,
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.stdout.emit("data", Buffer.from("Test output line 1\n"));
        mockChild.stdout.emit("data", Buffer.from("Test output line 2\n"));
        mockChild.emit("close", 0);
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const outputEvents = parentEvents.filter(
        (e) => e.type === "VALIDATION_OUTPUT",
      );
      expect(outputEvents.length).toBeGreaterThanOrEqual(2);
      expect(outputEvents[0].output).toContain("Test output");
    });

    it("should send VALIDATION_COMPLETE when finished", async () => {
      const parentEvents: any[] = [];
      const mockParent = {
        send: vi.fn((event) => parentEvents.push(event)),
      };

      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
        parent: mockParent,
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.emit("close", 0);
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const completeEvents = parentEvents.filter(
        (e) => e.type === "VALIDATION_COMPLETE",
      );
      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].packageName).toBe("package-a");
      expect(completeEvents[0].exitCode).toBe(0);
      expect(completeEvents[0].duration).toBeGreaterThanOrEqual(0);
    });

    it("should work without parent actor", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
        // No parent
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      setTimeout(() => {
        mockChild.stdout.emit("data", Buffer.from("Test output\n"));
        mockChild.emit("close", 0);
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("success");
    });
  });

  describe("Error Handling", () => {
    it("should handle child process errors", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.emit("error", new Error("Command not found"));
      }, 10);

      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("failed");
      expect(snapshot.context.error).toBeInstanceOf(Error);
    });

    it("should send VALIDATION_ERROR to parent on error", async () => {
      const parentEvents: any[] = [];
      const mockParent = {
        send: vi.fn((event) => parentEvents.push(event)),
      };

      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
        parent: mockParent,
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.emit("error", new Error("Command not found"));
      }, 10);

      await waitFor(actor, (state) => state.value === "failed", {
        timeout: 1000,
      });

      const errorEvents = parentEvents.filter(
        (e) => e.type === "VALIDATION_ERROR",
      );
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error).toContain("Command not found");
    });

    it("should handle null exit codes", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.emit("close", null); // Process was killed
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const results =
        snapshot.output?.results ||
        Array.from(snapshot.context.results.values());
      expect(results[0].exitCode).toBe(-1);
    });

    it("should capture stderr output", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.stderr.emit("data", Buffer.from("Error message\n"));
        mockChild.emit("close", 1);
      }, 10);

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const results =
        snapshot.output?.results ||
        Array.from(snapshot.context.results.values());
      expect(results[0].output).toContain("Error message");
    });
  });

  describe("Stop Handling", () => {
    it("should handle STOP event from idle state", () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const actor = createActor(scriptExecutorActor, { input });
      actor.start();

      actor.send({ type: "STOP" });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("stopped");
    });

    it("should handle STOP event during execution", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      actor.send({ type: "STOP" });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("stopped");
    });
  });

  describe("Duration Tracking", () => {
    it("should track execution duration", async () => {
      const input: ScriptExecutorInput = {
        affectedPackages: ["package-a"],
        validationCommand: "npm test",
      };

      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const dynamicActor = createScriptExecutorWithPackages(input);
      const actor = createActor(dynamicActor, { input });
      actor.start();

      actor.send({ type: "EXECUTE" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      setTimeout(() => {
        mockChild.emit("close", 0);
      }, 100); // Delay to ensure measurable duration

      await waitFor(actor, (state) => state.value === "success", {
        timeout: 1000,
      });

      const snapshot = actor.getSnapshot();
      const results =
        snapshot.output?.results ||
        Array.from(snapshot.context.results.values());
      expect(results[0].duration).toBeGreaterThan(0);
    });
  });
});
