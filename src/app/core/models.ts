export const ViewMode = {
  STACK: 'stack',
  OVERLAY: 'overlay',
} as const;
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

export const EVENTS = {
  MAP_SELECTED: 'map:position-selected',
  FILE_REMOVED: 'file:removed',
  BATCH_LOADED: 'dataprocessor:batch-load-completed',
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
