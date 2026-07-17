import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import {
  MATH_DEFINITIONS,
  MathDefinition,
  MathInputDef,
} from './math-definitions';
import { ActionLogEvent, EVENTS, LoadedFile, SignalPoint } from './models';
import { SignalRegistryService } from './signal-registry.service';

export interface CreateChannelOptions {
  smooth?: boolean;
  smoothWindow?: number;
  isAuto?: boolean;
  isReplay?: boolean;
}

class LinearInterpolator {
  private lastIndex = 0;
  private readonly length: number;

  constructor(private readonly data: SignalPoint[]) {
    this.length = data.length;
  }

  getValueAt(targetTime: number): number {
    if (this.length === 0) return 0;
    if (targetTime <= this.data[0].x) return this.data[0].y;
    if (targetTime >= this.data[this.length - 1].x)
      return this.data[this.length - 1].y;

    let i = this.lastIndex;
    if (this.data[i].x > targetTime) i = 0;

    while (i < this.length - 1 && this.data[i + 1].x < targetTime) {
      i++;
    }
    this.lastIndex = i;

    const p1 = this.data[i];
    const p2 = this.data[i + 1];

    if (!p1) return 0;
    if (!p2) return p1.y;

    const range = p2.x - p1.x;
    if (range === 0) return p1.y;

    const factor = (targetTime - p1.x) / range;
    return p1.y + (p2.y - p1.y) * factor;
  }
}

/**
 * Port of legacy/src/mathchannels.js's computational engine (createChannel,
 * interpolation, auto-math, formula execution). The legacy modal's custom
 * searchable-autocomplete widget and "isolate on chart" auto-select-checkbox
 * animation are dropped — the MathChannelModal component (Milestone 3a) uses
 * native form controls instead, wired directly to this service's public API.
 * The gas-pedal quick-launch shortcut is ported via `openModalWithFormula`
 * (see TopNav's Quick Gas Filter button).
 */
@Injectable({ providedIn: 'root' })
export class MathChannelsService {
  readonly isModalOpen = signal(false);
  /** Consumed once by MathChannelModal.resetForm() to pre-select a formula on open (e.g. the top-nav's Quick Gas Filter shortcut). */
  readonly preselectFormulaId = signal<string | null>(null);

  constructor(
    private readonly appState: AppStateService,
    private readonly bus: EventBusService,
    private readonly signalRegistry: SignalRegistryService
  ) {
    this.bus.on(EVENTS.BATCH_LOADED).subscribe(() => this.executeAutoMath());
  }

  openModal(): void {
    if (this.appState.files().length === 0) {
      this.appState.showAlert('Please load a log file first.');
      return;
    }
    this.isModalOpen.set(true);
  }

  /** Port of legacy/src/entry.js's `openQuickGasFilter` — opens the modal with a formula pre-selected. */
  openModalWithFormula(formulaId: string): void {
    if (this.appState.files().length === 0) {
      this.appState.showAlert('Please load a log file first.');
      return;
    }
    this.preselectFormulaId.set(formulaId);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  getFormulaCategories(): Record<'Business' | 'Technical', MathDefinition[]> {
    const categories: Record<'Business' | 'Technical', MathDefinition[]> = {
      Business: [],
      Technical: [],
    };
    MATH_DEFINITIONS.forEach((def) => {
      if (def.isHidden) return;
      categories[def.category].push(def);
    });
    return categories;
  }

  getDefinition(id: string): MathDefinition | undefined {
    return MATH_DEFINITIONS.find((d) => d.id === id);
  }

  createChannel(
    fileIndex: number,
    formulaId: string,
    inputMapping: Array<string | number>,
    newChannelName: string,
    options: CreateChannelOptions = {}
  ): string {
    const file = this.appState.files()[fileIndex];
    if (!file) throw new Error('No file selected or loaded.');

    const definition = MATH_DEFINITIONS.find((d) => d.id === formulaId);
    if (!definition) throw new Error('Invalid formula definition.');

    const resolvedMapping = definition.inputs.map((inputDef, idx) =>
      inputDef.isConstant
        ? inputMapping[idx]
        : this.resolveSignalName(file, inputDef, String(inputMapping[idx]))
    );

    let resultData: SignalPoint[];
    if (definition.customProcess) {
      resultData = this.executeCustomProcess(file, definition, resolvedMapping);
    } else {
      resultData = this.executeStandardFormula(
        file,
        definition,
        resolvedMapping
      );
    }

    if (options.smooth && options.smoothWindow && options.smoothWindow > 1) {
      resultData = this.applySmoothing(resultData, options.smoothWindow);
    }

    const finalName = newChannelName || definition.name;
    const unit = definition.unit || '';

    return this.finalizeChannel(fileIndex, resultData, finalName, unit);
  }

  /** Single-channel creation from the modal UI: creates and logs the action for project history. */
  createSingleChannel(
    fileIndex: number,
    formulaId: string,
    inputMapping: Array<string | number>,
    newChannelName: string,
    options: CreateChannelOptions = {}
  ): string {
    const createdName = this.createChannel(
      fileIndex,
      formulaId,
      inputMapping,
      newChannelName,
      options
    );
    this.logAction(formulaId, inputMapping, newChannelName, fileIndex, options);
    return createdName;
  }

  /** Batch creation (e.g. "Filtered (Multi-Signal)"): one channel per source signal. */
  createBatchChannels(
    definition: MathDefinition,
    sources: string[],
    restInputs: Array<string | number>,
    fileIndex: number,
    options: CreateChannelOptions = {}
  ): string[] {
    if (!definition.singleVariantId) throw new Error('Not a batch formula.');
    if (sources.length === 0) throw new Error('No signals selected.');

    const targetId = definition.singleVariantId;
    const createdNames: string[] = [];

    sources.forEach((src) => {
      const singleInputs = [src, ...restInputs];
      const name = `Filtered: ${src}`;
      const createdName = this.createChannel(
        fileIndex,
        targetId,
        singleInputs,
        name,
        options
      );
      createdNames.push(createdName);
      this.logAction(targetId, singleInputs, name, fileIndex, options);
    });

    return createdNames;
  }

  /** Auto-creates the always-on derived signals (GPS distance/speed, trip cost) after each batch load. */
  executeAutoMath(): void {
    this.appState.files().forEach((_, fileIdx) => {
      MATH_DEFINITIONS.forEach((def) => {
        if (!def.autoLoad?.enabled) return;

        const file = this.appState.files()[fileIdx];
        const targetName = def.autoLoad.targetName || def.name;
        const finalName = `Math: ${targetName}`;
        if (file.signals[finalName]) return;

        const resolvedInputs: Array<string | number> = [];
        let canCreate = true;

        for (const inputDef of def.inputs) {
          if (inputDef.isConstant) {
            if (inputDef.defaultValue !== undefined) {
              resolvedInputs.push(inputDef.defaultValue);
            } else {
              canCreate = false;
              break;
            }
          } else {
            const candidates = Array.isArray(inputDef.name)
              ? inputDef.name
              : inputDef.name
                ? [inputDef.name]
                : [];

            let match: string | null = null;
            for (const candidate of candidates) {
              match = this.signalRegistry.findSignal(
                candidate,
                file.availableSignals
              );
              if (match) break;
            }

            if (match) {
              resolvedInputs.push(match);
            } else {
              canCreate = false;
              break;
            }
          }
        }

        if (canCreate) {
          try {
            this.createChannel(fileIdx, def.id, resolvedInputs, targetName, {
              isAuto: true,
              smooth: false,
            });
          } catch (e) {
            console.warn(`[AutoMath] Failed to create ${targetName}`, e);
          }
        }
      });
    });
  }

  private resolveSignalName(
    file: LoadedFile,
    inputDef: MathInputDef,
    requestedName: string
  ): string {
    if (file.signals[requestedName]) return requestedName;

    if (inputDef.name) {
      const candidates = Array.isArray(inputDef.name)
        ? inputDef.name
        : [inputDef.name];

      for (const candidate of candidates) {
        const match = this.signalRegistry.findSignal(
          candidate,
          file.availableSignals
        );
        if (match && file.signals[match]) return match;
      }
    }
    return requestedName;
  }

  private executeStandardFormula(
    file: LoadedFile,
    definition: MathDefinition,
    inputMapping: Array<string | number>
  ): SignalPoint[] {
    type Iterator =
      | { isConstant: true; value: number }
      | { isConstant: false; interpolator: LinearInterpolator };

    const iterators: Iterator[] = [];
    let masterTimeBase: SignalPoint[] | null = null;

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        const raw = inputMapping[idx];
        let val = typeof raw === 'number' ? raw : parseFloat(raw);
        if (typeof raw === 'string' && raw.toLowerCase() === 'nan') {
          val = NaN;
        }
        if (isNaN(val) && input.name !== 'fallback') {
          throw new Error(`Invalid constant for ${input.label}`);
        }
        iterators.push({ isConstant: true, value: val });
      } else {
        const signalName = String(inputMapping[idx]);
        const signalData = file.signals[signalName];
        if (!signalData) throw new Error(`Signal '${signalName}' not found.`);

        iterators.push({
          isConstant: false,
          interpolator: new LinearInterpolator(signalData),
        });
        if (!masterTimeBase) masterTimeBase = signalData;
      }
    });

    if (!masterTimeBase)
      throw new Error('At least one input must be a signal.');

    const base: SignalPoint[] = masterTimeBase;
    const resultData: SignalPoint[] = [];

    for (let i = 0; i < base.length; i++) {
      const currentTime = base[i].x;
      const currentValues: number[] = new Array(iterators.length);

      for (let j = 0; j < iterators.length; j++) {
        const it = iterators[j];
        currentValues[j] = it.isConstant
          ? it.value
          : it.interpolator.getValueAt(currentTime);
      }

      const calculatedY = definition.formula!(currentValues);
      if (typeof calculatedY === 'number' && !isNaN(calculatedY)) {
        resultData.push({ x: currentTime, y: calculatedY });
      }
    }
    return resultData;
  }

  private executeCustomProcess(
    file: LoadedFile,
    definition: MathDefinition,
    inputMapping: Array<string | number>
  ): SignalPoint[] {
    const signals: SignalPoint[][] = [];
    const constants: number[] = [];

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        constants.push(parseFloat(String(inputMapping[idx])));
      } else {
        const signalName = String(inputMapping[idx]);
        const signalData = file.signals[signalName];
        if (!signalData) throw new Error(`Signal '${signalName}' not found.`);
        signals.push(signalData);
      }
    });

    return definition.customProcess!(signals, constants);
  }

  private applySmoothing(
    data: SignalPoint[],
    windowSize: number
  ): SignalPoint[] {
    if (data.length === 0) return [];
    const smoothed: SignalPoint[] = [];
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let count = 0;
      const start = Math.max(0, i - windowSize + 1);

      for (let j = start; j <= i; j++) {
        sum += data[j].y;
        count++;
      }
      smoothed.push({ x: data[i].x, y: sum / count });
    }
    return smoothed;
  }

  private finalizeChannel(
    fileIndex: number,
    resultData: SignalPoint[],
    finalName: string,
    unit: string
  ): string {
    const name = finalName.startsWith('Math: ')
      ? finalName
      : `Math: ${finalName}`;

    let min = Infinity;
    let max = -Infinity;
    for (const point of resultData) {
      if (point.y < min) min = point.y;
      if (point.y > max) max = point.y;
    }

    this.appState.addDerivedSignal(fileIndex, name, resultData, {
      min,
      max,
      unit: unit || 'Math',
    });
    return name;
  }

  private logAction(
    formulaId: string,
    inputs: Array<string | number>,
    name: string,
    fileIdx: number,
    options: CreateChannelOptions
  ): void {
    if (options.isReplay) return;
    this.bus.emit<ActionLogEvent>(EVENTS.ACTION_LOG, {
      type: 'CREATE_MATH_CHANNEL',
      description: `Created Channel: ${name}`,
      payload: { formulaId, inputs, channelName: name, options },
      fileIndex: fileIdx,
    });
  }
}
