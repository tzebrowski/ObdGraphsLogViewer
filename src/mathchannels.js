import { AppState } from './config.js';
import { UI } from './ui.js';

class MathChannels {
  #definitions;

  constructor() {
    this.#definitions = this.#getDefinitions();
    this.#initWindowBindings();
  }

  #getDefinitions() {
    return [
      {
        id: 'est_power_kgh',
        name: 'Estimated Power (HP) [Source: kg/h]',
        description:
          'Converts kg/h to g/s, then estimates HP. (MAF / 3.6 * Factor)',
        inputs: [
          { name: 'maf', label: 'Air Mass Flow (kg/h)' },
          {
            name: 'factor',
            label: 'Factor (Diesel ~1.35, Petrol ~1.25)',
            isConstant: true,
            defaultValue: 1.35,
          },
        ],
        formula: (values) => (values[0] / 3.6) * values[1],
      },
      {
        id: 'est_power_gs',
        name: 'Estimated Power (HP) [Source: g/s]',
        description: 'Direct g/s calculation. (MAF * Factor)',
        inputs: [
          { name: 'maf', label: 'Air Mass Flow (g/s)' },
          {
            name: 'factor',
            label: 'Factor (Diesel ~1.35, Petrol ~1.25)',
            isConstant: true,
            defaultValue: 1.35,
          },
        ],
        formula: (values) => values[0] * values[1],
      },
      {
        id: 'power_from_torque',
        name: 'Calculated Power (HP) [Source: Torque]',
        description:
          'Calculates HP from Torque (Nm) and RPM. (Torque * RPM / 7127)',
        inputs: [
          { name: 'torque', label: 'Torque (Nm)' },
          { name: 'rpm', label: 'Engine RPM' },
        ],
        formula: (values) => (values[0] * values[1]) / 7127,
      },
      {
        id: 'acceleration',
        name: 'Acceleration (m/s²) [0-100 Logic]',
        description:
          'Calculates acceleration from Speed. Use window to smooth noise.',
        inputs: [
          { name: 'speed', label: 'Speed (km/h)' },
          {
            name: 'window',
            label: 'Smoothing Window (Samples)',
            isConstant: true,
            defaultValue: 4,
          },
        ],
        customProcess: (sourceData, constants) => {
          const windowSize = Math.max(1, Math.round(constants[0]));
          const result = [];

          for (let i = windowSize; i < sourceData.length; i++) {
            const p1 = sourceData[i - windowSize];
            const p2 = sourceData[i];

            const dt = (p2.x - p1.x) / 1000;
            if (dt <= 0) continue;

            const dv = (p2.y - p1.y) / 3.6;
            const accel = dv / dt;

            result.push({ x: p2.x, y: accel });
          }
          return result;
        },
      },
      {
        id: 'smoothing',
        name: 'Smooth Signal (Moving Average)',
        description: 'Reduces noise by averaging the last N samples.',
        inputs: [
          { name: 'source', label: 'Signal to Smooth' },
          {
            name: 'window',
            label: 'Window Size (Samples)',
            isConstant: true,
            defaultValue: 5,
          },
        ],
        customProcess: (sourceData, constants) => {
          const windowSize = Math.max(1, Math.round(constants[0]));
          const smoothed = [];

          for (let i = 0; i < sourceData.length; i++) {
            let sum = 0;
            let count = 0;

            for (let j = 0; j < windowSize; j++) {
              if (i - j >= 0) {
                sum += sourceData[i - j].y;
                count++;
              }
            }

            smoothed.push({ x: sourceData[i].x, y: sum / count });
          }
          return smoothed;
        },
      },
      {
        id: 'filter_gt',
        name: 'Filter (Keep if > Threshold)',
        description:
          'Shows Source ONLY if Condition > Threshold. Else shows Fallback.',
        inputs: [
          { name: 'source', label: 'Signal to Display (e.g. AFR)' },
          { name: 'cond', label: 'Condition Signal (e.g. Throttle)' },
          {
            name: 'thresh',
            label: 'Threshold',
            isConstant: true,
            defaultValue: 90,
          },
          {
            name: 'fallback',
            label: 'Fallback Value (0 or NaN)',
            isConstant: true,
            defaultValue: 0,
          },
        ],
        formula: (values) => (values[1] > values[2] ? values[0] : values[3]),
      },
      {
        id: 'filter_lt',
        name: 'Filter (Keep if < Threshold)',
        description:
          'Shows Source ONLY if Condition < Threshold. Else shows Fallback.',
        inputs: [
          { name: 'source', label: 'Signal to Display' },
          { name: 'cond', label: 'Condition Signal' },
          {
            name: 'thresh',
            label: 'Threshold',
            isConstant: true,
            defaultValue: 10,
          },
          {
            name: 'fallback',
            label: 'Fallback Value',
            isConstant: true,
            defaultValue: 0,
          },
        ],
        formula: (values) => (values[1] < values[2] ? values[0] : values[3]),
      },
      {
        id: 'boost',
        name: 'Boost Pressure (Bar)',
        description: 'MAP - Baro (Manifold - Atmospheric)',
        inputs: [
          { name: 'map', label: 'Intake Manifold Pressure' },
          { name: 'baro', label: 'Atmospheric Pressure' },
        ],
        formula: (values) => values[0] - values[1],
      },
      {
        id: 'afr_error',
        name: 'AFR Error',
        description: 'Commanded AFR - Measured AFR',
        inputs: [
          { name: 'commanded', label: 'AFR Commanded' },
          { name: 'measured', label: 'AFR Measured' },
        ],
        formula: (values) => values[0] - values[1],
      },
      {
        id: 'pressure_ratio',
        name: 'Pressure Ratio',
        description: 'MAP / Baro',
        inputs: [
          { name: 'map', label: 'Intake Manifold Pressure' },
          { name: 'baro', label: 'Atmospheric Pressure' },
        ],
        formula: (values) => (values[1] !== 0 ? values[0] / values[1] : 0),
      },
      {
        id: 'multiply_const',
        name: 'Multiply by Constant',
        description: 'Signal * Factor (Generic helper)',
        inputs: [
          { name: 'source', label: 'Source Signal' },
          {
            name: 'factor',
            label: 'Factor',
            isConstant: true,
            defaultValue: 1.0,
          },
        ],
        formula: (values) => values[0] * values[1],
      },
    ];
  }

  #initWindowBindings() {
    window.openMathModal = () => this.#openModal();
    window.closeMathModal = () => this.#closeModal();
    window.onMathFormulaChange = () => this.#onFormulaChange();
    window.createMathChannel = () => this.#executeCreation();
  }

  createChannel(fileIndex, formulaId, inputMapping, newChannelName) {
    const file = AppState.files[fileIndex];
    if (!file) throw new Error('No file selected or loaded.');

    const definition = this.#definitions.find((d) => d.id === formulaId);
    if (!definition) throw new Error('Invalid formula definition.');

    if (definition.customProcess) {
      return this.#executeCustomProcess(
        file,
        definition,
        inputMapping,
        newChannelName
      );
    }

    const sourceSignals = [];
    let masterTimeBase = null;

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        const val = parseFloat(inputMapping[idx]);
        if (isNaN(val))
          throw new Error(`Invalid constant value for ${input.label}`);
        sourceSignals.push({ isConstant: true, value: val });
      } else {
        const signalName = inputMapping[idx];
        const signalData = file.signals[signalName];

        if (!signalData)
          throw new Error(`Signal '${signalName}' not found in file.`);

        sourceSignals.push({ isConstant: false, data: signalData });
        if (!masterTimeBase) masterTimeBase = signalData;
      }
    });

    if (!masterTimeBase)
      throw new Error('At least one input must be a signal.');

    const resultData = [];
    for (let i = 0; i < masterTimeBase.length; i++) {
      const currentTime = masterTimeBase[i].x;
      const currentValues = [];

      sourceSignals.forEach((source) => {
        if (source.isConstant) {
          currentValues.push(source.value);
        } else {
          const val = this.#interpolate(source.data, currentTime);
          currentValues.push(val);
        }
      });

      const calculatedY = definition.formula(currentValues);
      resultData.push({ x: currentTime, y: calculatedY });
    }

    return this.#finalizeChannel(
      file,
      resultData,
      newChannelName || `Math: ${definition.name}`
    );
  }

  #executeCustomProcess(file, definition, inputMapping, newChannelName) {
    const signals = [];
    const constants = [];

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        const val = parseFloat(inputMapping[idx]);
        if (isNaN(val))
          throw new Error(`Invalid constant value for ${input.label}`);
        constants.push(val);
      } else {
        const signalName = inputMapping[idx];
        const signalData = file.signals[signalName];
        if (!signalData) throw new Error(`Signal '${signalName}' not found.`);
        signals.push(signalData);
      }
    });

    if (signals.length === 0)
      throw new Error('Custom process requires at least one signal.');
    const resultData = definition.customProcess(signals[0], constants);
    return this.#finalizeChannel(
      file,
      resultData,
      newChannelName || `Math: ${definition.name}`
    );
  }

  #finalizeChannel(file, resultData, finalName) {
    let min = Infinity;
    let max = -Infinity;

    for (const point of resultData) {
      if (point.y < min) min = point.y;
      if (point.y > max) max = point.y;
    }

    file.signals[finalName] = resultData;

    if (!file.metadata) file.metadata = {};
    file.metadata[finalName] = {
      min: min,
      max: max,
      unit: 'Math',
    };

    if (!file.availableSignals.includes(finalName)) {
      file.availableSignals.push(finalName);
      file.availableSignals.sort();
    }
    return finalName;
  }

  #interpolate(data, targetTime) {
    if (!data || data.length === 0) return 0;
    if (targetTime <= data[0].x) return parseFloat(data[0].y);
    if (targetTime >= data[data.length - 1].x)
      return parseFloat(data[data.length - 1].y);

    let left = 0;
    let right = data.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (data[mid].x < targetTime) left = mid + 1;
      else right = mid - 1;
    }

    const p1 = data[left - 1];
    const p2 = data[left];
    if (!p1) return parseFloat(p2.y);
    if (!p2) return parseFloat(p1.y);

    const t1 = p1.x;
    const t2 = p2.x;
    const y1 = parseFloat(p1.y);
    const y2 = parseFloat(p2.y);
    if (t2 === t1) return y1;

    return y1 + (y2 - y1) * ((targetTime - t1) / (t2 - t1));
  }

  #openModal() {
    if (AppState.files.length === 0) {
      alert('Please load a log file first.');
      return;
    }
    const modal = document.getElementById('mathModal');
    if (modal) modal.style.display = 'flex';

    const select = document.getElementById('mathFormulaSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Formula --</option>';
    this.#definitions.forEach((def) => {
      select.innerHTML += `<option value="${def.id}">${def.name}</option>`;
    });

    document.getElementById('mathInputsContainer').innerHTML = '';
    document.getElementById('mathChannelName').value = '';
  }

  #closeModal() {
    const modal = document.getElementById('mathModal');
    if (modal) modal.style.display = 'none';
  }

  #onFormulaChange() {
    const formulaId = document.getElementById('mathFormulaSelect').value;
    const container = document.getElementById('mathInputsContainer');
    container.innerHTML = '';

    const definition = this.#definitions.find((d) => d.id === formulaId);
    if (!definition) return;

    document.getElementById('mathChannelName').value =
      `Math: ${definition.name}`;

    if (AppState.files.length === 0) {
      container.innerHTML = "<p style='color:red'>No log file loaded.</p>";
      return;
    }
    const file = AppState.files[0];

    definition.inputs.forEach((input, idx) => {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '15px';

      wrapper.innerHTML = `<label style="font-size:0.85em; font-weight:bold; display:block; margin-bottom:4px;">${input.label}</label>`;

      if (input.isConstant) {
        const inputEl = document.createElement('input');
        inputEl.type = 'number';
        inputEl.id = `math-input-${idx}`;
        inputEl.value = input.defaultValue;
        inputEl.className = 'template-select';
        inputEl.style.width = '100%';
        wrapper.appendChild(inputEl);
      } else {
        const searchableSelect = this.#createSearchableSelect(
          idx,
          file.availableSignals,
          input.name
        );
        wrapper.appendChild(searchableSelect);
      }
      container.appendChild(wrapper);
    });
  }

  #createSearchableSelect(idx, signals, inputFilterName) {
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `math-input-${idx}`;
    input.className = 'searchable-input';
    input.placeholder = 'Search or Select Signal...';
    input.autocomplete = 'off';

    const resultsList = document.createElement('div');
    resultsList.className = 'search-results-list';

    const defaultSignal = signals.find((s) =>
      s.toLowerCase().includes(inputFilterName.toLowerCase())
    );
    if (defaultSignal) input.value = defaultSignal;

    const renderOptions = (filterText = '') => {
      resultsList.innerHTML = '';
      const lowerFilter = filterText.toLowerCase();

      const filtered = signals.filter((s) =>
        s.toLowerCase().includes(lowerFilter)
      );

      if (filtered.length === 0) {
        resultsList.innerHTML =
          '<div class="search-option" style="color:#999; cursor:default;">No signals found</div>';
      } else {
        filtered.forEach((sig) => {
          const opt = document.createElement('div');
          opt.className = 'search-option';
          opt.textContent = sig;
          opt.onclick = () => {
            input.value = sig;
            resultsList.style.display = 'none';
          };
          resultsList.appendChild(opt);
        });
      }
    };

    input.addEventListener('focus', () => {
      renderOptions(input.value);
      resultsList.style.display = 'block';
    });

    input.addEventListener('input', (e) => {
      renderOptions(e.target.value);
      resultsList.style.display = 'block';
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        resultsList.style.display = 'none';
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(resultsList);

    return wrapper;
  }

  #executeCreation() {
    const formulaId = document.getElementById('mathFormulaSelect').value;
    const newName = document.getElementById('mathChannelName').value;

    if (!formulaId) {
      alert('Please select a formula.');
      return;
    }

    const definition = this.#definitions.find((d) => d.id === formulaId);
    const inputMapping = [];

    for (let i = 0; i < definition.inputs.length; i++) {
      const el = document.getElementById(`math-input-${i}`);
      inputMapping.push(el.value);
    }

    try {
      const createdName = this.createChannel(
        0,
        formulaId,
        inputMapping,
        newName
      );
      this.#closeModal();
      if (typeof UI.renderSignalList === 'function') {
        UI.renderSignalList();
        setTimeout(() => {
          const checkbox = document.querySelector(
            `input[data-key="${createdName}"]`
          );
          if (checkbox) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
          }
        }, 100);
      }
    } catch (e) {
      console.error(e);
      alert('Error creating channel: ' + e.message);
    }
  }
}

export const mathChannels = new MathChannels();
