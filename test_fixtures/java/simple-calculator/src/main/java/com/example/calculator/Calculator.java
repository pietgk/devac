package com.example.calculator;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Calculator with operations and memory.
 */
public class Calculator {

    private Map<String, Operation> operations;
    private Map<String, Double> memory;

    /**
     * Constructor initializes storage.
     */
    public Calculator() {
        this.operations = new HashMap<>();
        this.memory = new HashMap<>();
        registerOperation("add", (a, b) -> a + b);
        registerOperation("subtract", (a, b) -> a - b);
        registerOperation("multiply", (a, b) -> a * b);
        registerOperation("divide", (a, b) -> a / b);
    }

    /**
     * Register an operation.
     */
    public void registerOperation(String name, Operation op) {
        operations.put(name, op);
    }

    /**
     * Get available operations.
     */
    public Set<String> getAvailableOperations() {
        return operations.keySet();
    }

    /**
     * Store value in memory.
     */
    public void store(String key, double value) {
        memory.put(key, value);
    }

    /**
     * Recall value from memory.
     */
    public double recall(String key) {
        return memory.getOrDefault(key, 0.0);
    }

    /**
     * Clear memory.
     */
    public void clear() {
        memory.clear();
    }

    /**
     * Perform calculation.
     */
    public double performOperation(String opName, double a, double b) throws Exception {
        Operation op = operations.get(opName);
        if (op == null) {
            throw new Exception("Unknown operation: " + opName);
        }
        return op.execute(a, b);
    }
}
