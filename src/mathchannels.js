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
    let min = Infinity;
    let max = -Infinity;

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

      if (calculatedY < min) min = calculatedY;
      if (calculatedY > max) max = calculatedY;

      resultData.push({
        x: currentTime,
        y: calculatedY,
      });
    }

    const finalName = newChannelName || `Math: ${definition.name}`;

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
      if (data[mid].x < targetTime) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
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

    const fraction = (targetTime - t1) / (t2 - t1);
    return y1 + (y2 - y1) * fraction;
  }

  #openModal() {
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
    const signalOptions = file.availableSignals
      .map((s) => `<option value="${s}">${s}</option>`)
      .join('');

    definition.inputs.forEach((input, idx) => {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '10px';

      let inputHtml = '';
      if (input.isConstant) {
        inputHtml = `<input type="number" id="math-input-${idx}" value="${input.defaultValue}" class="template-select" style="width:100%">`;
      } else {
        inputHtml = `<select id="math-input-${idx}" class="template-select" style="width:100%">${signalOptions}</select>`;
      }

      wrapper.innerHTML = `
          <label style="font-size:0.85em; font-weight:bold; display:block; margin-bottom:4px;">${input.label}</label>
          ${inputHtml}
      `;
      container.appendChild(wrapper);

      if (!input.isConstant) {
        const sel = wrapper.querySelector('select');
        for (let opt of sel.options) {
          if (opt.value.toLowerCase().includes(input.name.toLowerCase())) {
            sel.value = opt.value;
            break;
          }
        }
      }
    });
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
