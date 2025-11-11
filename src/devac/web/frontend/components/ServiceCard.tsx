// src/devac/web/frontend/components/ServiceCard.tsx

"use client";

import React from "react";
import styled from "styled-components";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/Card/index.js";
import { Badge } from "./ui/Badge/index.js";
import { Button } from "./ui/Button/index.js";
import { Text } from "./ui/Text/index.js";
import type { Service } from "../lib/api/types.js";

export interface ServiceCardProps {
  service: Service;
  onStart?: (serviceId: string) => void;
  onStop?: (serviceId: string) => void;
  onRestart?: (serviceId: string) => void;
  loading?: boolean;
}

const ServiceCardContainer = styled(Card)`
  min-width: 300px;
`;

const ServiceHeader = styled(CardHeader)`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ServiceInfo = styled.div`
  flex: 1;
`;

const ServiceActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.s}px;
  margin-top: ${({ theme }) => theme.spacing.m}px;
`;

const ServiceStats = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: ${({ theme }) => theme.spacing.s}px;
  margin-top: ${({ theme }) => theme.spacing.m}px;
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xxs}px;
`;

const StatLabel = styled(Text)`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const StatValue = styled(Text)`
  font-weight: ${({ theme }) => theme.font.weight.medium};
`;

const ErrorMessage = styled(Text)`
  margin-top: ${({ theme }) => theme.spacing.s}px;
  padding: ${({ theme }) => theme.spacing.s}px;
  background: ${({ theme }) => theme.colors.errorLight};
  border-radius: ${({ theme }) => theme.borderRadius.s}px;
  color: ${({ theme }) => theme.colors.error};
`;

/**
 * Get badge variant based on service status
 */
function getStatusVariant(status: Service["status"]): "default" | "primary" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
      return "success";
    case "starting":
    case "stopping":
      return "warning";
    case "error":
      return "error";
    case "stopped":
      return "default";
    default:
      return "default";
  }
}

/**
 * Get badge variant based on health status
 */
function getHealthVariant(health: Service["health"]): "default" | "success" | "error" {
  switch (health) {
    case "healthy":
      return "success";
    case "unhealthy":
      return "error";
    default:
      return "default";
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * ServiceCard component - displays service information and controls
 */
export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  onStart,
  onStop,
  onRestart,
  loading = false,
}) => {
  const canStart = service.status === "stopped" || service.status === "error";
  const canStop = service.status === "running" || service.status === "starting";
  const canRestart = service.status === "running";

  return (
    <ServiceCardContainer>
      <ServiceHeader>
        <ServiceInfo>
          <CardTitle>{service.name}</CardTitle>
          <Text variant="bodySmall" color="secondary">
            {service.type}
          </Text>
        </ServiceInfo>
        <div style={{ display: "flex", gap: "8px", flexDirection: "column", alignItems: "flex-end" }}>
          <Badge variant={getStatusVariant(service.status)} size="sm">
            {service.status}
          </Badge>
          <Badge variant={getHealthVariant(service.health)} size="sm">
            {service.health}
          </Badge>
        </div>
      </ServiceHeader>

      <CardContent>
        <ServiceStats>
          <StatItem>
            <StatLabel variant="caption">Uptime</StatLabel>
            <StatValue variant="body">
              {service.stats.uptime > 0 ? formatUptime(service.stats.uptime) : "—"}
            </StatValue>
          </StatItem>

          <StatItem>
            <StatLabel variant="caption">Requests</StatLabel>
            <StatValue variant="body">{service.stats.requestCount.toLocaleString()}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel variant="caption">Version</StatLabel>
            <StatValue variant="body">{service.version}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel variant="caption">Enabled</StatLabel>
            <StatValue variant="body">{service.enabled ? "Yes" : "No"}</StatValue>
          </StatItem>
        </ServiceStats>

        {service.lastError && (
          <ErrorMessage variant="bodySmall">
            {service.lastError.message}
          </ErrorMessage>
        )}

        <ServiceActions>
          {canStart && (
            <Button
              variant="primary"
              size="s"
              onClick={() => onStart?.(service.id)}
              disabled={loading}
              loading={loading}
            >
              Start
            </Button>
          )}

          {canStop && (
            <Button
              variant="outlined"
              size="s"
              onClick={() => onStop?.(service.id)}
              disabled={loading}
              loading={loading}
            >
              Stop
            </Button>
          )}

          {canRestart && (
            <Button
              variant="secondary"
              size="s"
              onClick={() => onRestart?.(service.id)}
              disabled={loading}
              loading={loading}
            >
              Restart
            </Button>
          )}
        </ServiceActions>
      </CardContent>
    </ServiceCardContainer>
  );
};
