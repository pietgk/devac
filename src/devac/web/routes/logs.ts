// src/devac/web/routes/logs.ts

import { Router, type Request, type Response } from 'express';
import type { EventBus } from '../../orchestrator/event-bus.js';
import { readLogs } from '../log-file-reader.js';
import type { LogFilter } from '../../types/logging.js';
import { createContextLogger } from '../../../utils/logger.js';

const logger = createContextLogger('LogsRouter');

export interface CreateLogsRouterOptions {
  eventBus: EventBus;
  logDir: string;
}

/**
 * Create logs API router
 *
 * Endpoints:
 * - GET /api/logs - Get logs (from EventBus or files based on time range)
 * - GET /api/logs/stream - SSE stream of real-time logs
 */
export function createLogsRouter(options: CreateLogsRouterOptions): Router {
  const { eventBus, logDir } = options;
  const router = Router();

  /**
   * GET /api/logs
   *
   * Query params:
   * - level: Comma-separated log levels (e.g., "error,warn")
   * - service: Filter by service name
   * - since: Unix timestamp (milliseconds)
   * - limit: Max number of logs to return
   * - search: Text search in message/service/stack
   *
   * Response: { logs: LogEntry[], source: 'memory' | 'file' }
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const filter: LogFilter = {
        level: req.query.level ? (req.query.level as string).split(',') : undefined,
        service: req.query.service as string | undefined,
        since: req.query.since ? parseInt(req.query.since as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
        search: req.query.search as string | undefined,
      };

      logger.debug('GET /api/logs', filter);

      // Determine source based on 'since' parameter
      // If since is within last 10 minutes, use EventBus (fast)
      // Otherwise, read from files (slower but complete history)
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      const useMemory = !filter.since || filter.since >= tenMinutesAgo;

      let logs;
      let source: 'memory' | 'file';

      if (useMemory) {
        // Use EventBus (recent logs in memory)
        logs = eventBus.getLogHistory(filter);
        source = 'memory';
        logger.debug(`Returning ${logs.length} logs from memory`);
      } else {
        // Read from files (historical logs)
        logs = await readLogs({
          logDir,
          filter,
          reverse: true,
        });
        source = 'file';
        logger.debug(`Returning ${logs.length} logs from files`);
      }

      res.json({ logs, source });
    } catch (error: any) {
      logger.error('Failed to get logs', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        error: 'Failed to retrieve logs',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/logs/stream
   *
   * Server-Sent Events endpoint for real-time log streaming.
   *
   * Query params:
   * - level: Comma-separated log levels to stream (e.g., "error,warn")
   * - service: Filter by service name
   *
   * Events:
   * - event: log, data: LogEntry JSON
   * - event: heartbeat, data: { timestamp }
   */
  router.get('/stream', (req: Request, res: Response) => {
    const filterLevels = req.query.level ? (req.query.level as string).split(',') : undefined;
    const filterService = req.query.service as string | undefined;

    logger.info('Client connected to log stream', {
      filterLevels,
      filterService,
    });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connection\n`);
    res.write(`data: ${JSON.stringify({ connected: true, timestamp: Date.now() })}\n\n`);

    // Subscribe to log events from EventBus
    const logHandler = (log: any) => {
      // Apply client-side filters
      if (filterLevels && !filterLevels.includes(log.level)) {
        return;
      }

      if (filterService && log.service !== filterService) {
        return;
      }

      // Send log event
      res.write(`event: log\n`);
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    };

    eventBus.on('log', logHandler);

    // Send heartbeat every 30 seconds
    const heartbeatInterval = setInterval(() => {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    }, 30000);

    // Cleanup on client disconnect
    req.on('close', () => {
      logger.info('Client disconnected from log stream');
      eventBus.off('log', logHandler);
      clearInterval(heartbeatInterval);
      res.end();
    });
  });

  return router;
}
