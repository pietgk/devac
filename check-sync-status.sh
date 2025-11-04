#!/bin/bash

# Script to check workspace sync status
# Usage: ./check-sync-status.sh

echo "=== CodeGraph Workspace Sync Status ==="
echo "Time: $(date)"
echo ""

# Check if sync is running
if ps -p $(cat /tmp/workspace-sync.pid 2>/dev/null) > /dev/null 2>&1; then
  echo "Status: ⏳ RUNNING"

  # Count completed
  COMPLETED=$(grep "✓.*files in" /tmp/full-workspace-sync.log | wc -l | tr -d ' ')
  echo "Progress: $COMPLETED/8 repositories completed"
  echo ""

  # Show completed
  echo "Completed repositories:"
  grep "✓.*files in" /tmp/full-workspace-sync.log

  # Show log size
  echo ""
  LOG_SIZE=$(ls -lh /tmp/full-workspace-sync.log | awk '{print $5}')
  LOG_LINES=$(wc -l /tmp/full-workspace-sync.log | awk '{print $1}')
  echo "Log file: $LOG_SIZE ($LOG_LINES lines)"

else
  echo "Status: ✅ COMPLETED"
  echo ""

  # Show summary
  echo "=== FINAL SUMMARY ==="
  tail -300 /tmp/full-workspace-sync.log | grep -A 40 "Summary:" | head -45

  echo ""
  echo "=== ALL REPOSITORIES ==="
  grep "✓.*files in" /tmp/full-workspace-sync.log

  echo ""
  echo "To view full results, run workspace status:"
  echo "  cd /Users/grop/ws/CodeGraph"
  echo "  node dist/index.js workspace status"
fi
