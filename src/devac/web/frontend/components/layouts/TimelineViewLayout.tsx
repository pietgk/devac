// src/devac/web/frontend/components/layouts/TimelineViewLayout.tsx

"use client";

import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card/index.js";
import { Text } from "../ui/Text/index.js";
import { Badge } from "../ui/Badge/index.js";
import { apiClient } from "../../lib/api/client.js";
import { useSSE } from "../../lib/hooks/useSSE.js";
import type { SSEEvent } from "../../lib/api/types.js";

const LayoutContainer = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.l}px;
  padding: ${({ theme }) => theme.spacing.l}px;
  max-width: 1400px;
  margin: 0 auto;
  height: calc(100vh - ${({ theme }) => theme.spacing.l * 2}px);
`;

const TimelineColumn = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.m}px;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: ${({ theme }) => theme.spacing.m}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.borderLight};
`;

const EventsList = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.s}px;
  padding-right: ${({ theme }) => theme.spacing.s}px;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: ${({ theme }) => theme.colors.backgroundSecondary};
    border-radius: ${({ theme }) => theme.borderRadius.s}px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.borderLight};
    border-radius: ${({ theme }) => theme.borderRadius.s}px;

    &:hover {
      background: ${({ theme }) => theme.colors.border};
    }
  }
`;

const EventCard = styled(Card)<{ $isNew?: boolean }>`
  animation: ${({ $isNew }) => $isNew ? "slideIn 0.3s ease-out" : "none"};

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const EventHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.s}px;
`;

const EventMeta = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.s}px;
`;

const EventTime = styled(Text)`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const EventPayload = styled.pre`
  background: ${({ theme }) => theme.colors.backgroundSecondary};
  padding: ${({ theme }) => theme.spacing.s}px;
  border-radius: ${({ theme }) => theme.borderRadius.s}px;
  overflow-x: auto;
  font-size: ${({ theme }) => theme.font.size.s}px;
  font-family: ${({ theme }) => theme.font.family.mono};
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xxl}px;
  text-align: center;
  gap: ${({ theme }) => theme.spacing.m}px;
  flex: 1;
`;

const ConnectionStatus = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.s}px;
`;

/**
 * Get badge variant for event type
 */
function getEventVariant(type: string): "default" | "primary" | "success" | "warning" | "error" | "info" {
  if (type.includes("START")) return "success";
  if (type.includes("STOP")) return "warning";
  if (type.includes("ERROR") || type.includes("FAIL")) return "error";
  if (type.includes("HEALTH")) return "info";
  return "default";
}

/**
 * Format timestamp
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Timeline View Layout - Chronological event stream
 */
export const TimelineViewLayout: React.FC = () => {
  const [events, setEvents] = useState<(SSEEvent & { receivedAt: number })[]>([]);
  const [newEventId, setNewEventId] = useState<string | null>(null);
  const eventsListRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // SSE connection for real-time events
  const { connected, error: sseError, reconnecting, reconnectAttempts } = useSSE({
    url: apiClient.getSSEURL(),
    onEvent: (event: SSEEvent) => {
      const eventWithTime = { ...event, receivedAt: Date.now() };

      setEvents((prev) => [eventWithTime, ...prev].slice(0, 100)); // Keep last 100 events
      setNewEventId(event.id);

      // Clear new event highlight after animation
      setTimeout(() => setNewEventId(null), 300);

      // Auto-scroll to top if enabled
      if (autoScroll && eventsListRef.current) {
        eventsListRef.current.scrollTop = 0;
      }
    },
    onError: (err) => {
      console.error("SSE error:", err);
    },
  });

  /**
   * Handle scroll to detect manual scrolling
   */
  const handleScroll = () => {
    if (eventsListRef.current) {
      const { scrollTop } = eventsListRef.current;
      // Disable auto-scroll if user scrolls down
      setAutoScroll(scrollTop < 50);
    }
  };

  /**
   * Clear all events
   */
  const handleClear = () => {
    setEvents([]);
  };

  return (
    <LayoutContainer>
      <TimelineColumn>
        <Header>
          <div>
            <Text variant="h1">Timeline View</Text>
            <Text variant="body" color="secondary">
              Real-time event stream
            </Text>
          </div>

          <ConnectionStatus>
            {reconnecting && (
              <Badge variant="warning" size="md">
                Reconnecting ({reconnectAttempts})...
              </Badge>
            )}
            <Badge variant={connected ? "success" : "error"} size="md">
              {connected ? "Connected" : "Disconnected"}
            </Badge>
            {events.length > 0 && (
              <Badge variant="default" size="md">
                {events.length} events
              </Badge>
            )}
          </ConnectionStatus>
        </Header>

        {sseError && (
          <Card>
            <CardContent>
              <Text variant="body" color="error">
                Connection error: {sseError.message}
              </Text>
            </CardContent>
          </Card>
        )}

        {events.length === 0 && !sseError && (
          <EmptyState>
            <Text variant="h2">No Events Yet</Text>
            <Text variant="body" color="secondary">
              {connected
                ? "Waiting for orchestrator events..."
                : "Connecting to event stream..."}
            </Text>
          </EmptyState>
        )}

        {events.length > 0 && (
          <EventsList ref={eventsListRef} onScroll={handleScroll}>
            {events.map((event) => (
              <EventCard key={`${event.id}-${event.receivedAt}`} $isNew={event.id === newEventId}>
                <CardContent>
                  <EventHeader>
                    <EventMeta>
                      <Badge variant={getEventVariant(event.type)} size="sm">
                        {event.type}
                      </Badge>
                      <Text variant="bodySmall" color="secondary">
                        from {event.source}
                      </Text>
                      {event.target && (
                        <Text variant="bodySmall" color="secondary">
                          → {event.target}
                        </Text>
                      )}
                    </EventMeta>
                    <EventTime variant="caption">
                      {formatTime(event.timestamp)}
                    </EventTime>
                  </EventHeader>

                  {Object.keys(event.payload).length > 0 && (
                    <EventPayload>
                      {JSON.stringify(event.payload, null, 2)}
                    </EventPayload>
                  )}
                </CardContent>
              </EventCard>
            ))}
          </EventsList>
        )}
      </TimelineColumn>
    </LayoutContainer>
  );
};
