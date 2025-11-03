#!/usr/bin/env node
/**
 * Standalone test script for the code-analyzer MCP server
 * Tests the MCP server's stdio protocol communication
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_SERVER_PATH = path.join(__dirname, "dist", "index.js");

console.log("=== MCP Server Stdio Test ===\n");
console.log(`MCP Server Path: ${MCP_SERVER_PATH}\n`);

// Start the MCP server as a child process
const serverProcess = spawn("node", [MCP_SERVER_PATH], {
  stdio: ["pipe", "pipe", "pipe"],
});

let responseBuffer = "";
let requestId = 1;

// Handle stdout (JSON-RPC responses from MCP server)
serverProcess.stdout.on("data", (data) => {
  responseBuffer += data.toString();

  // Try to parse complete JSON-RPC messages
  const lines = responseBuffer.split("\n");
  responseBuffer = lines.pop() || ""; // Keep incomplete line in buffer

  for (const line of lines) {
    if (line.trim()) {
      try {
        const message = JSON.parse(line);
        console.log("\n📥 Received from server:");
        console.log(JSON.stringify(message, null, 2));

        // If this is the capabilities response, send the tool call
        if (message.result && message.result.capabilities) {
          console.log("\n✅ Server initialized successfully!");
          console.log("   Available tools:", message.result.capabilities.tools || "none listed");

          // Now call the run_analyzer tool
          setTimeout(() => sendToolCall(), 500);
        }

        // If this is the tool response, verify and exit
        if (message.result && message.result.content) {
          console.log("\n✅ Tool call successful!");
          const content = message.result.content[0];
          if (content.type === "text") {
            try {
              const commandDetails = JSON.parse(content.text);
              console.log("\n📋 Command Details:");
              console.log("   Command:", commandDetails.command);
              console.log("   CWD:", commandDetails.cwd);
              console.log("\n✅ All tests passed!");
            } catch (e) {
              console.log("   Response:", content.text);
            }
          }

          // Graceful shutdown
          setTimeout(() => {
            serverProcess.kill("SIGTERM");
            process.exit(0);
          }, 500);
        }
      } catch (err) {
        console.error("⚠️  Failed to parse JSON:", err.message);
        console.error("   Raw data:", line);
      }
    }
  }
});

// Handle stderr (logs from MCP server)
serverProcess.stderr.on("data", (data) => {
  const log = data.toString().trim();
  if (log) {
    console.log("🔍 [Server Log]", log);
  }
});

// Handle server process exit
serverProcess.on("close", (code) => {
  console.log(`\n🛑 MCP server process exited with code ${code}`);
  process.exit(code || 0);
});

// Handle errors
serverProcess.on("error", (err) => {
  console.error("\n❌ Error starting MCP server:", err.message);
  process.exit(1);
});

// Send initialization request
function sendInitialize() {
  const initRequest = {
    jsonrpc: "2.0",
    id: requestId++,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: "test-client",
        version: "1.0.0"
      }
    }
  };

  console.log("\n📤 Sending initialize request:");
  console.log(JSON.stringify(initRequest, null, 2));
  serverProcess.stdin.write(JSON.stringify(initRequest) + "\n");
}

// Send tool call request
function sendToolCall() {
  const testDirectory = "/Users/grop/ws/CodeGraph/test-project";

  const toolCallRequest = {
    jsonrpc: "2.0",
    id: requestId++,
    method: "tools/call",
    params: {
      name: "run_analyzer",
      arguments: {
        directory: testDirectory
      }
    }
  };

  console.log("\n📤 Calling run_analyzer tool:");
  console.log(JSON.stringify(toolCallRequest, null, 2));
  serverProcess.stdin.write(JSON.stringify(toolCallRequest) + "\n");
}

// Start the test
console.log("🚀 Starting MCP server...\n");
setTimeout(() => sendInitialize(), 1000); // Give server time to start

// Timeout after 10 seconds
setTimeout(() => {
  console.error("\n❌ Test timed out after 10 seconds");
  serverProcess.kill("SIGTERM");
  process.exit(1);
}, 10000);
