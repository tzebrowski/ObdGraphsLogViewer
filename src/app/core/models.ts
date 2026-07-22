export const ViewMode = {
  STACK: 'stack',
  OVERLAY: 'overlay',
} as const;
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

/** Which top-level page is shown, driven by `window.location.hash` (see App). */
export type Route = 'landing' | 'analyzer';

export const EVENTS = {
  MAP_SELECTED: 'map:position-selected',
  FILE_REMOVED: 'file:removed',
  BATCH_LOADED: 'dataprocessor:batch-load-completed',
  ACTION_LOG: 'action:log',
  CHART_RESET_ALL: 'chart:reset-all',
  FILE_TAG_ADDED: 'file:tag-added',
} as const;

export interface SignalPoint {
  x: number;
  y: number;
}

export interface LoadedFile {
  name: string;
  rawData: RawDataPoint[];
  signals: Record<string, SignalPoint[]>;
  startTime: number;
  duration: number;
  availableSignals: string[];
  metadata: Record<string, unknown>;
  size: number;
  dbId: number | null;
  annotations?: ChartAnnotation[];
  /** Session-only, matching legacy's non-persisted `file.tags` — synced to Drive appProperties when the name matches a loaded Drive entry. */
  tags?: string[];
  /** Session-only, matching legacy's non-persisted `file.highlights` — Shift+Drag-saved regions with a stats overlay. */
  highlights?: ChartHighlight[];
}

export interface FileTagAddedEvent {
  fileName: string;
  tag: string;
}

/** A point-in-time note plotted on the chart. Session-only, matching legacy's non-persisted `file.annotations`. */
export interface ChartAnnotation {
  time: number;
  text: string;
}

/** A user-saved, Shift+Drag-selected time region with a title/description and per-signal min/max stats, rendered on the chart. */
export interface ChartHighlight {
  start: number;
  end: number;
  label: string;
  description: string;
  color: string;
}

export interface RawDataPoint {
  signal: string;
  timestamp: number;
  value: number;
}

export interface ActiveHighlight {
  start: number;
  end: number;
  targetIndex: number | null;
}

export interface FileRemovedEvent {
  index: number;
  file: LoadedFile;
}

export interface ActionLogEvent {
  type: string;
  description: string;
  payload: unknown;
  fileIndex: number;
}
