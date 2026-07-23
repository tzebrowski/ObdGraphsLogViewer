import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AppStateService } from '../../core/app-state.service';
import { MathDefinition } from '../../core/math-definitions';
import { MathChannelsService } from '../../core/math-channels.service';
import { LoadedFile } from '../../core/models';
import { SignalRegistryService } from '../../core/signal-registry.service';

/**
 * Port of legacy/src/mathchannels.js's modal UI. The custom searchable-
 * autocomplete widget (a text input with a filtered click-to-select
 * dropdown) is replaced with an always-visible signal list per input —
 * checkboxes for multi-signal inputs, a click-to-select list for
 * single-signal inputs — each with its own small filter box above it
 * (`inputFilters`/`filteredSignals`) so the list stays usable once a file
 * has many signals, matching the original widget's main usability win
 * without bringing back a hidden-until-typed text field. Signal-picker
 * pre-fill (matching a formula's expected input against the file's actual
 * signal names) is kept for the same reason. `resetForm` also consumes
 * `MathChannelsService.preselectFormulaId` for the gas-pedal quick-launch
 * shortcut (TopNav's Quick Gas Filter button).
 */
@Component({
  selector: 'app-math-channel-modal',
  imports: [],
  templateUrl: './math-channel-modal.html',
  styleUrl: './math-channel-modal.css',
})
export class MathChannelModal {
  protected readonly mathChannels = inject(MathChannelsService);
  protected readonly appState = inject(AppStateService);
  private readonly signalRegistry = inject(SignalRegistryService);

  protected readonly categories = computed(() =>
    this.mathChannels.getFormulaCategories()
  );

  protected readonly selectedFormulaId = signal('');
  protected readonly selectedFileIndex = signal(0);
  protected readonly channelName = signal('');
  protected readonly inputValues = signal<Partial<Record<number, string>>>({});
  protected readonly selectedSources = signal<string[]>([]);
  /** Per-input-index filter text narrowing that input's signal list (`filteredSignals`). */
  protected readonly inputFilters = signal<Partial<Record<number, string>>>({});
  protected readonly smoothEnabled = signal(false);
  protected readonly smoothWindow = signal(5);
  protected readonly isolateEnabled = signal(false);
  protected readonly autoEnableText = signal('');
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly selectedDefinition = computed<MathDefinition | undefined>(
    () =>
      this.selectedFormulaId()
        ? this.mathChannels.getDefinition(this.selectedFormulaId())
        : undefined
  );

  protected readonly currentFile = computed<LoadedFile | undefined>(
    () => this.appState.files()[this.selectedFileIndex()]
  );

  protected readonly canCreate = computed(() => {
    const def = this.selectedDefinition();
    const file = this.currentFile();
    if (!def || !file) return false;
    if (!def.isBatch && !this.channelName().trim()) return false;

    for (let i = 0; i < def.inputs.length; i++) {
      const input = def.inputs[i];
      if (input.isMulti) {
        if (this.selectedSources().length === 0) return false;
        continue;
      }
      const value = this.inputValues()[i];
      if (value === undefined || value === '') return false;
    }
    return true;
  });

  constructor() {
    // Reset the form whenever the modal is (re)opened.
    effect(() => {
      if (this.mathChannels.isModalOpen()) {
        this.resetForm();
      }
    });
  }

  protected onFormulaChange(id: string): void {
    this.selectedFormulaId.set(id);
    this.errorMessage.set(null);
    this.selectedSources.set([]);
    this.inputFilters.set({});
    this.smoothEnabled.set(false);
    this.smoothWindow.set(5);

    const def = this.mathChannels.getDefinition(id);
    if (!def) {
      this.inputValues.set({});
      this.channelName.set('');
      this.isolateEnabled.set(false);
      this.autoEnableText.set('');
      return;
    }

    this.channelName.set(def.isBatch ? '[Auto Generated]' : def.name);
    this.isolateEnabled.set(!!def.autoEnableSignals?.length);
    this.autoEnableText.set(def.autoEnableSignals?.join(', ') ?? '');

    const file = this.currentFile();
    const values: Partial<Record<number, string>> = {};
    def.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        if (input.defaultValue !== undefined) {
          values[idx] = String(input.defaultValue);
        }
        return;
      }
      if (input.isMulti || !file) return;

      const candidates = Array.isArray(input.name)
        ? input.name
        : input.name
          ? [input.name]
          : [];
      for (const candidate of candidates) {
        const match = this.signalRegistry.findSignal(
          candidate,
          file.availableSignals
        );
        if (match) {
          values[idx] = match;
          break;
        }
      }
    });
    this.inputValues.set(values);

    if (def.preSelectAllSources && file) {
      this.selectedSources.set([...file.availableSignals]);
    }
  }

  protected onFileChange(index: number): void {
    this.selectedFileIndex.set(index);
    if (this.selectedFormulaId())
      this.onFormulaChange(this.selectedFormulaId());
  }

  protected setInputValue(idx: number, value: string): void {
    this.inputValues.update((v) => ({ ...v, [idx]: value }));
  }

  /** Signals for input `idx`, narrowed by that input's filter text (case-insensitive substring match). */
  protected filteredSignals(idx: number): string[] {
    const signals = this.currentFile()?.availableSignals ?? [];
    const term = (this.inputFilters()[idx] ?? '').toLowerCase().trim();
    if (!term) return signals;
    return signals.filter((sig) => sig.toLowerCase().includes(term));
  }

  protected setInputFilter(idx: number, value: string): void {
    this.inputFilters.update((f) => ({ ...f, [idx]: value }));
  }

  protected toggleSource(sig: string): void {
    this.selectedSources.update((sources) =>
      sources.includes(sig)
        ? sources.filter((s) => s !== sig)
        : [...sources, sig]
    );
  }

  protected create(): void {
    const def = this.selectedDefinition();
    const file = this.currentFile();
    if (!def || !file) return;

    this.errorMessage.set(null);
    const fileIndex = this.selectedFileIndex();
    const options = {
      smooth: this.smoothEnabled(),
      smoothWindow: this.smoothWindow(),
    };

    try {
      if (def.isBatch) {
        const restInputs = def.inputs
          .slice(1)
          .map((_, i) => this.inputValues()[i + 1] ?? '');
        this.mathChannels.createBatchChannels(
          def,
          this.selectedSources(),
          restInputs,
          fileIndex,
          options
        );
      } else {
        const inputs = def.inputs.map((_, i) => this.inputValues()[i] ?? '');
        this.mathChannels.createSingleChannel(
          fileIndex,
          def.id,
          inputs,
          this.channelName(),
          options
        );
      }

      if (this.isolateEnabled()) {
        const refreshedFile = this.appState.files()[fileIndex];
        if (refreshedFile) {
          this.appState.setAllSignalsVisibleForFile(
            fileIndex,
            refreshedFile.availableSignals,
            false
          );
          this.autoEnableText()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((sig) =>
              this.appState.setSignalVisible(fileIndex, sig, true)
            );
        }
      }

      this.close();
    } catch (e) {
      this.errorMessage.set((e as Error).message);
    }
  }

  protected close(): void {
    this.mathChannels.closeModal();
  }

  private resetForm(): void {
    this.selectedFormulaId.set('');
    this.selectedFileIndex.set(0);
    this.channelName.set('');
    this.inputValues.set({});
    this.selectedSources.set([]);
    this.inputFilters.set({});
    this.smoothEnabled.set(false);
    this.smoothWindow.set(5);
    this.isolateEnabled.set(false);
    this.autoEnableText.set('');
    this.errorMessage.set(null);

    // untracked: this runs from an effect keyed on isModalOpen() — reading
    // (and then clearing) preselectFormulaId() here would otherwise make
    // that effect depend on it too, so clearing it mid-run would re-trigger
    // resetForm() a second time and wipe the selection it just applied.
    const preselect = untracked(() => this.mathChannels.preselectFormulaId());
    if (preselect) {
      this.mathChannels.preselectFormulaId.set(null);
      // Deferred: the <select>'s <option>s are created in this same change-
      // detection cycle (the modal is behind an @if on isModalOpen), and a
      // native <select>.value assignment made before its matching <option>
      // exists doesn't "stick" even once the option is added — applying it
      // a tick later lets the options render first.
      setTimeout(() => this.onFormulaChange(preselect));
    }
  }
}
