package com.codegraph.testharness;

import org.neo4j.harness.Neo4j;
import org.neo4j.harness.Neo4jBuilders;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.concurrent.CountDownLatch;

/**
 * Wrapper for Neo4j Test Harness that can be invoked from Node.js.
 *
 * Starts an embedded Neo4j instance and outputs connection details
 * in a format that can be parsed by the Node.js native strategy.
 *
 * Usage:
 *   java -jar test-harness-wrapper.jar [--port <port|auto>]
 *
 * Output format:
 *   READY: bolt://localhost:PORT
 *   USERNAME: neo4j
 *   PASSWORD: password
 *   DATABASE: neo4j
 */
public class TestHarnessWrapper {

    private static Neo4j embeddedDatabase;
    private static final CountDownLatch shutdownLatch = new CountDownLatch(1);

    public static void main(String[] args) {
        try {
            // Parse command line arguments
            int port = parsePort(args);

            // Register shutdown hook
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                System.err.println("Shutting down Neo4j Test Harness...");
                if (embeddedDatabase != null) {
                    embeddedDatabase.close();
                }
                shutdownLatch.countDown();
            }));

            // Start Neo4j Test Harness
            embeddedDatabase = startNeo4j(port);

            // Output connection details in parseable format
            outputConnectionDetails(embeddedDatabase);

            // Keep running until interrupted
            System.err.println("Neo4j Test Harness is running. Press Ctrl+C to stop.");
            shutdownLatch.await();

        } catch (Exception e) {
            System.err.println("ERROR: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }

    /**
     * Parse port from command line arguments.
     * Supports: --port <number> or --port auto
     */
    private static int parsePort(String[] args) {
        for (int i = 0; i < args.length - 1; i++) {
            if ("--port".equals(args[i])) {
                String portArg = args[i + 1];
                if ("auto".equals(portArg)) {
                    return findAvailablePort();
                } else {
                    try {
                        return Integer.parseInt(portArg);
                    } catch (NumberFormatException e) {
                        System.err.println("Invalid port number: " + portArg);
                        System.exit(1);
                    }
                }
            }
        }
        // Default: auto-assign port
        return findAvailablePort();
    }

    /**
     * Find an available port by opening and closing a ServerSocket.
     */
    private static int findAvailablePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            socket.setReuseAddress(true);
            return socket.getLocalPort();
        } catch (IOException e) {
            System.err.println("Failed to find available port: " + e.getMessage());
            System.exit(1);
            return -1; // Never reached
        }
    }

    /**
     * Start Neo4j Test Harness on the specified port.
     */
    private static Neo4j startNeo4j(int port) {
        System.err.println("Starting Neo4j Test Harness on port " + port + "...");

        Neo4j neo4j = Neo4jBuilders.newInProcessBuilder()
            .withDisabledServer() // Disable HTTP server, only Bolt
            .build();

        System.err.println("Neo4j Test Harness started successfully");
        return neo4j;
    }

    /**
     * Output connection details in a format that Node.js can parse.
     * Format:
     *   READY: bolt://localhost:PORT
     *   USERNAME: neo4j
     *   PASSWORD: password
     *   DATABASE: neo4j
     */
    private static void outputConnectionDetails(Neo4j neo4j) {
        String boltUri = neo4j.boltURI().toString();

        // Output to stdout (Node.js will read this)
        System.out.println("READY: " + boltUri);
        System.out.println("USERNAME: neo4j");
        System.out.println("PASSWORD: password");
        System.out.println("DATABASE: neo4j");
        System.out.flush();

        // Also log to stderr for debugging
        System.err.println("Connection details:");
        System.err.println("  URI: " + boltUri);
        System.err.println("  Username: neo4j");
        System.err.println("  Password: password");
        System.err.println("  Database: neo4j");
    }
}
