// src/devac/web/frontend/components/layouts/CommandCenterLayout.tsx

"use client";

import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { ServiceCard } from "../ServiceCard.js";
import { Text } from "../ui/Text/index.js";
import { Badge } from "../ui/Badge/index.js";
import { apiClient } from "../../lib/api/client.js";
import { useSSE } from "../../lib/hooks/useSSE.js";
import type { Service, SSEEvent } from "../../lib/api/types.js";

const LayoutContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.l}px;
  padding: ${({ theme }) => theme.spacing.l}px;
  max-width: 1400px;
  margin: 0 auto;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: ${({ theme }) => theme.spacing.m}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.borderLight};
`;

const HeaderInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs}px;
`;

const StatusBadges = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.s}px;
  align-items: center;
`;

const ServicesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: ${({ theme }) => theme.spacing.m}px;
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xxl}px;
`;

const ErrorContainer = styled.div`
  padding: ${({ theme }) => theme.spacing.l}px;
  background: ${({ theme }) => theme.colors.errorLight};
  border-radius: ${({ theme }) => theme.borderRadius.m}px;
  color: ${({ theme }) => theme.colors.error};
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xxl}px;
  text-align: center;
  gap: ${({ theme }) => theme.spacing.m}px;
`;

/**
 * Command Center Layout - Grid view of all services
 */
export const CommandCenterLayout: React.FC = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // SSE connection for real-time updates
  const { connected: sseConnected, lastEvent } = useSSE({
    url: apiClient.getSSEURL(),
    onEvent: (event: SSEEvent) => {
      // Refresh services when events occur
      if (event.type.includes("SERVICE") || event.type === "START" || event.type === "STOP") {
        loadServices();
      }
    },
    onError: (err) => {
      console.error("SSE error:", err);
    },
  });

  /**
   * Load services from API
   */
  const loadServices = async () => {
    try {
      const data = await apiClient.listServices();
      setServices(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load services");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle service start
   */
  const handleStart = async (serviceId: string) => {
    setActionLoading(serviceId);
    try {
      await apiClient.startService(serviceId);
      // Service list will update via SSE
      setTimeout(() => loadServices(), 500); // Fallback refresh
    } catch (err: any) {
      setError(err.message || "Failed to start service");
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Handle service stop
   */
  const handleStop = async (serviceId: string) => {
    setActionLoading(serviceId);
    try {
      await apiClient.stopService(serviceId, true);
      // Service list will update via SSE
      setTimeout(() => loadServices(), 500); // Fallback refresh
    } catch (err: any) {
      setError(err.message || "Failed to stop service");
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Handle service restart
   */
  const handleRestart = async (serviceId: string) => {
    setActionLoading(serviceId);
    try {
      await apiClient.restartService(serviceId, true);
      // Service list will update via SSE
      setTimeout(() => loadServices(), 1000); // Fallback refresh
    } catch (err: any) {
      setError(err.message || "Failed to restart service");
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Load services on mount
   */
  useEffect(() => {
    loadServices();

    // Poll every 30 seconds as backup (SSE is primary)
    const interval = setInterval(loadServices, 30000);

    return () => clearInterval(interval);
  }, []);

  /**
   * Calculate summary stats
   */
  const runningCount = services.filter((s) => s.status === "running").length;
  const stoppedCount = services.filter((s) => s.status === "stopped").length;
  const errorCount = services.filter((s) => s.status === "error").length;
  const healthyCount = services.filter((s) => s.health === "healthy").length;

  if (loading) {
    return (
      <LayoutContainer>
        <LoadingContainer>
          <Text variant="body">Loading services...</Text>
        </LoadingContainer>
      </LayoutContainer>
    );
  }

  if (error && services.length === 0) {
    return (
      <LayoutContainer>
        <ErrorContainer>
          <Text variant="body">{error}</Text>
        </ErrorContainer>
      </LayoutContainer>
    );
  }

  if (services.length === 0) {
    return (
      <LayoutContainer>
        <EmptyState>
          <Text variant="h2">No Services</Text>
          <Text variant="body" color="secondary">
            No services are registered with the orchestrator.
          </Text>
        </EmptyState>
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer>
      <Header>
        <HeaderInfo>
          <Text variant="h1">Command Center</Text>
          <Text variant="body" color="secondary">
            {services.length} service{services.length !== 1 ? "s" : ""} registered
          </Text>
        </HeaderInfo>

        <StatusBadges>
          <Badge variant="success" size="md">
            {runningCount} running
          </Badge>
          <Badge variant="default" size="md">
            {stoppedCount} stopped
          </Badge>
          {errorCount > 0 && (
            <Badge variant="error" size="md">
              {errorCount} error
            </Badge>
          )}
          <Badge variant={sseConnected ? "success" : "warning"} size="md">
            {sseConnected ? "Live" : "Disconnected"}
          </Badge>
        </StatusBadges>
      </Header>

      {error && (
        <ErrorContainer>
          <Text variant="bodySmall">{error}</Text>
        </ErrorContainer>
      )}

      <ServicesGrid>
        {services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            onStart={handleStart}
            onStop={handleStop}
            onRestart={handleRestart}
            loading={actionLoading === service.id}
          />
        ))}
      </ServicesGrid>
    </LayoutContainer>
  );
};
