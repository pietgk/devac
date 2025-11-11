// src/devac/web/frontend/components/LayoutSwitcher.tsx

"use client";

import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { CommandCenterLayout } from "./layouts/CommandCenterLayout.js";
import { TimelineViewLayout } from "./layouts/TimelineViewLayout.js";
import { Button } from "./ui/Button/index.js";

const SwitcherContainer = styled.div`
  position: fixed;
  top: ${({ theme }) => theme.spacing.m}px;
  right: ${({ theme }) => theme.spacing.m}px;
  z-index: 1000;
  display: flex;
  gap: ${({ theme }) => theme.spacing.s}px;
  background: ${({ theme }) => theme.colors.background};
  padding: ${({ theme }) => theme.spacing.s}px;
  border-radius: ${({ theme }) => theme.borderRadius.m}px;
  box-shadow: ${({ theme }) => theme.shadows.medium};
`;

const LayoutContainer = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.background};
`;

export type LayoutType = "command-center" | "timeline";

const STORAGE_KEY = "devac-layout-preference";

/**
 * Layout Switcher - Allows switching between different dashboard layouts
 */
export const LayoutSwitcher: React.FC = () => {
  const [activeLayout, setActiveLayout] = useState<LayoutType>("command-center");

  /**
   * Load layout preference from localStorage on mount
   */
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY) as LayoutType | null;
      if (saved && (saved === "command-center" || saved === "timeline")) {
        setActiveLayout(saved);
      }
    }
  }, []);

  /**
   * Switch layout and save preference
   */
  const switchLayout = (layout: LayoutType) => {
    setActiveLayout(layout);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, layout);
    }
  };

  return (
    <>
      <SwitcherContainer>
        <Button
          variant={activeLayout === "command-center" ? "primary" : "outlined"}
          size="s"
          onClick={() => switchLayout("command-center")}
        >
          Command Center
        </Button>
        <Button
          variant={activeLayout === "timeline" ? "primary" : "outlined"}
          size="s"
          onClick={() => switchLayout("timeline")}
        >
          Timeline
        </Button>
      </SwitcherContainer>

      <LayoutContainer>
        {activeLayout === "command-center" && <CommandCenterLayout />}
        {activeLayout === "timeline" && <TimelineViewLayout />}
      </LayoutContainer>
    </>
  );
};
