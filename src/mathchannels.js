import { AppState } from './config.js';
import { UI } from './ui.js';
import { messenger } from './bus.js';
import { MATH_DEFINITIONS } from './mathdefinitions.js';
import { Alert } from './alert.js';

/**
 * Helper class for O(N) linear time alignment instead of O(N log N) binary search.
 * Significantly speeds up math channel generation on large logs.
 */
class LinearInterpolator {
  constructor(data) {
    this.data = data;
    this.lastIndex = 0;
    this.length = data.length;
  }

  getValueAt(targetTime) {
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

    const t1 = p1.x;
    const t2 = p2.x;
    const range = t2 - t1;

    if (range === 0) return p1.y;

    const factor = (targetTime - t1) / range;
    return p1.y + (p2.y - p1.y) * factor;
  }
}

class MathChannels {
  #definitions;

  constructor() {
    this.#definitions = MATH_DEFINITIONS;
  }

  openModal() {
    if (AppState.files.length === 0) {
      Alert.showAlert('Please load a log file first.');
      return;
    }
    this.#renderModal();
  }

  closeModal() {
    const modal = document.getElementById('mathModal');
    if (modal) modal.style.display = 'none';
  }

  onFormulaChange() {
    this.#renderFormulaUI();
  }

  createMathChannel() {
    this.#executeCreation();
  }

  createChannel(
    fileIndex,
    formulaId,
    inputMapping,
    newChannelName,
    options = {}
  ) {
    const file = AppState.files[fileIndex];
    if (!file) throw new Error('No file selected or loaded.');

    const definition = this.#definitions.find((d) => d.id === formulaId);
    if (!definition) throw new Error('Invalid formula definition.');

    const resolvedMapping = definition.inputs.map((inputDef, idx) => {
      if (inputDef.isConstant) return inputMapping[idx];
      return this.#resolveSignalName(file, inputDef, inputMapping[idx]);
    });

    let resultData = [];

    if (definition.customProcess) {
      resultData = this.#executeCustomProcess(
        file,
        definition,
        resolvedMapping
      );
    } else {
      resultData = this.#executeStandardFormula(
        file,
        definition,
        resolvedMapping
      );
    }

    if (options.smooth && options.smoothWindow > 1) {
      resultData = this.#applySmoothing(resultData, options.smoothWindow);
    }

    const finalName = newChannelName || definition.name;
    const unit = definition.unit || '';

    return this.#finalizeChannel(file, resultData, finalName, unit);
  }

  // --- LOGIC HELPERS ---

  #resolveSignalName(file, inputDef, requestedName) {
    if (file.signals[requestedName]) return requestedName;

    if (Array.isArray(inputDef.name)) {
      for (const alias of inputDef.name) {
        const match = file.availableSignals.find((s) =>
          s.toLowerCase().includes(alias.toLowerCase())
        );
        if (match && file.signals[match]) return match;
      }
    }
    return requestedName;
  }

  #executeStandardFormula(file, definition, inputMapping) {
    const iterators = [];
    let masterTimeBase = null;

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        let val = parseFloat(inputMapping[idx]);
        if (
          typeof inputMapping[idx] === 'string' &&
          inputMapping[idx].toLowerCase() === 'nan'
        ) {
          val = NaN;
        }
        if (isNaN(val) && input.name !== 'fallback') {
          throw new Error(`Invalid constant for ${input.label}`);
        }
        iterators.push({ isConstant: true, value: val });
      } else {
        const signalName = inputMapping[idx];
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

    const resultData = [];
    const len = masterTimeBase.length;

    for (let i = 0; i < len; i++) {
      const currentTime = masterTimeBase[i].x;
      const currentValues = new Array(iterators.length); // Pre-allocate

      for (let j = 0; j < iterators.length; j++) {
        const it = iterators[j];
        if (it.isConstant) {
          currentValues[j] = it.value;
        } else {
          currentValues[j] = it.interpolator.getValueAt(currentTime);
        }
      }

      const calculatedY = definition.formula(currentValues);

      if (typeof calculatedY === 'number' && !isNaN(calculatedY)) {
        resultData.push({ x: currentTime, y: calculatedY });
      }
    }
    return resultData;
  }

  #executeCustomProcess(file, definition, inputMapping) {
    const signals = [];
    const constants = [];

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        constants.push(parseFloat(inputMapping[idx]));
      } else {
        const signalName = inputMapping[idx];
        const signalData = file.signals[signalName];
        if (!signalData) throw new Error(`Signal '${signalName}' not found.`);
        signals.push(signalData);
      }
    });

    return definition.customProcess(signals, constants);
  }

  #applySmoothing(data, windowSize) {
    if (data.length === 0) return [];
    const smoothed = [];

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

  #finalizeChannel(file, resultData, finalName, unit) {
    if (!finalName.startsWith('Math: ')) finalName = `Math: ${finalName}`;

    let min = Infinity;
    let max = -Infinity;
    for (const point of resultData) {
      if (point.y < min) min = point.y;
      if (point.y > max) max = point.y;
    }

    file.signals[finalName] = resultData;
    file.metadata = file.metadata || {};
    file.metadata[finalName] = { min, max, unit: unit || 'Math' };

    if (!file.availableSignals.includes(finalName)) {
      file.availableSignals.push(finalName);
      file.availableSignals.sort();
    }
    return finalName;
  }

  #renderModal() {
    const modal = document.getElementById('mathModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const select = document.getElementById('mathFormulaSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Formula --</option>';
    this.#definitions.forEach((def) => {
      if (!def.isHidden) {
        select.innerHTML += `<option value="${def.id}">${def.name}</option>`;
      }
    });

    document.getElementById('mathInputsContainer').innerHTML = '';
    this.#toggleDisplay('mathDescriptionContainer', false);
    this.#toggleDisplay('mathNameContainer', false);
    const nameInput = document.getElementById('mathChannelName');
    if (nameInput) nameInput.value = '';
  }

  #renderFormulaUI() {
    const formulaId = document.getElementById('mathFormulaSelect').value;
    const container = document.getElementById('mathInputsContainer');
    container.innerHTML = '';

    const definition = this.#definitions.find((d) => d.id === formulaId);
    if (!definition) {
      this.#toggleDisplay('mathDescriptionContainer', false);
      this.#toggleDisplay('mathNameContainer', false);
      return;
    }

    const descText = document.getElementById('mathFormulaDescription');
    if (descText) descText.innerText = definition.description || '';
    this.#toggleDisplay('mathDescriptionContainer', true);

    const nameInput = document.getElementById('mathChannelName');
    if (nameInput) {
      this.#toggleDisplay('mathNameContainer', true);
      nameInput.value = definition.name;
      nameInput.disabled = !!definition.isBatch;
      if (definition.isBatch) nameInput.value = '[Auto Generated]';
    }

    if (AppState.files.length === 0) return;

    let targetFileIndex = 0;
    const inputsWrapper = document.createElement('div');
    inputsWrapper.id = 'mathFormulaInputs';

    if (AppState.files.length > 1) {
      this.#renderFileSelector(container, (idx) => {
        targetFileIndex = idx;
        this.#renderInputs(inputsWrapper, definition, targetFileIndex);
      });
    }
    container.appendChild(inputsWrapper);

    this.#renderInputs(inputsWrapper, definition, targetFileIndex);

    this.#renderPostProcessingUI(container);
  }

  #renderFileSelector(container, onSelect) {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '15px';
    wrapper.innerHTML = `<label class="math-label-small">Target File:</label>`;

    const select = document.createElement('select');
    select.id = 'mathTargetFile';
    select.className = 'template-select';

    AppState.files.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.text = `${i + 1}. ${f.name}`;
      select.appendChild(opt);
    });

    select.onchange = (e) => onSelect(parseInt(e.target.value, 10));
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  }

  #renderInputs(container, definition, fileIndex) {
    container.innerHTML = '';
    const file = AppState.files[fileIndex];

    definition.inputs.forEach((input, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'math-input-wrapper';
      wrapper.innerHTML = `<label class="math-label-small">${input.label}</label>`;

      if (input.isConstant) {
        wrapper.appendChild(this.#createConstantInput(input, idx));
      } else {
        wrapper.appendChild(
          this.#createSearchableSelect(
            idx,
            file.availableSignals,
            input.name,
            input.isMulti
          )
        );
      }
      container.appendChild(wrapper);
    });
  }

  #createConstantInput(input, idx) {
    let el;
    if (input.options) {
      el = document.createElement('select');
      input.options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.innerText = opt.label;
        el.appendChild(o);
      });
      el.value = input.defaultValue;
    } else {
      el = document.createElement('input');
      el.type = 'text';
      el.value = input.defaultValue;
    }
    el.id = `math-input-${idx}`;
    el.className = 'template-select';
    el.style.width = '100%';
    return el;
  }

  #renderPostProcessingUI(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'math-post-processing';
    wrapper.innerHTML = `
        <label class="math-section-label">Post-Processing</label>
        <div class="math-checkbox-container">
            <input type="checkbox" id="math-opt-smooth"> <span>Apply Smoothing</span>
        </div>
        <div style="margin-bottom:5px">
            <label class="math-label-small">Window (Samples)</label>
            <input type="number" id="math-opt-window" value="5" class="template-select" style="width:100%" disabled>
        </div>
    `;

    const check = wrapper.querySelector('#math-opt-smooth');
    const input = wrapper.querySelector('#math-opt-window');
    check.onchange = () => {
      input.disabled = !check.checked;
    };

    container.appendChild(wrapper);
  }

  #createSearchableSelect(idx, signals, inputFilterName, isMulti = false) {
    // ... (Keep existing implementation, logic is fine, just messy to refactor right now)
    // Ideally this whole method moves to a UI helper class
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `math-input-${idx}`;
    input.className = 'searchable-input template-select';
    input.placeholder = isMulti ? 'Click to add...' : 'Search Signal...';
    input.autocomplete = 'off';

    const resultsList = document.createElement('div');
    resultsList.className = 'search-results-list';

    if (!isMulti && inputFilterName) {
      const terms = Array.isArray(inputFilterName)
        ? inputFilterName
        : [inputFilterName];
      const match = terms.reduce(
        (found, term) =>
          found ||
          signals.find((s) => s.toLowerCase().includes(term.toLowerCase())),
        null
      );
      if (match) input.value = match;
    }

    const renderOptions = (filterText = '') => {
      resultsList.innerHTML = '';
      let filter = filterText.toLowerCase();

      if (isMulti) {
        const parts = filterText.split(',');
        filter = parts[parts.length - 1].trim().toLowerCase();
      }

      const matches = signals.filter((s) => s.toLowerCase().includes(filter));

      if (isMulti && matches.length > 0) {
        const allBtn = document.createElement('div');
        allBtn.className = 'search-option search-select-all';
        allBtn.innerText = '(Select/Deselect All Visible)';
        allBtn.onclick = (e) => {
          e.stopPropagation();
          this.#handleMultiSelectAll(input, signals, matches);
          input.focus();
        };
        resultsList.appendChild(allBtn);
      }

      if (matches.length === 0) {
        resultsList.innerHTML +=
          '<div class="search-option search-no-results">No signals found</div>';
      } else {
        matches.forEach((sig) => {
          const div = document.createElement('div');
          div.className = 'search-option';
          div.innerText = sig;
          if (isMulti && input.value.includes(sig))
            div.classList.add('selected');

          div.onclick = () => {
            if (isMulti) this.#handleMultiSelect(input, sig);
            else {
              input.value = sig;
              resultsList.style.display = 'none';
            }
          };
          resultsList.appendChild(div);
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
      if (!wrapper.contains(e.target)) resultsList.style.display = 'none';
    });

    wrapper.appendChild(input);
    wrapper.appendChild(resultsList);
    return wrapper;
  }

  #handleMultiSelect(input, sig) {
    const current = input.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);
    if (current.includes(sig)) {
      input.value =
        current.filter((s) => s !== sig).join(', ') +
        (current.length > 1 ? ', ' : '');
    } else {
      current.pop();
      current.push(sig);
      input.value = current.join(', ') + ', ';
    }
  }

  #handleMultiSelectAll(input, allSignals, visibleMatches) {
    const current = input.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && allSignals.includes(s));
    const allVisibleSelected = visibleMatches.every((m) => current.includes(m));

    let newVal = [];
    if (allVisibleSelected) {
      newVal = current.filter((s) => !visibleMatches.includes(s));
    } else {
      const toAdd = visibleMatches.filter((s) => !current.includes(s));
      newVal = [...current, ...toAdd];
    }
    input.value = newVal.join(', ') + (newVal.length > 0 ? ', ' : '');
  }

  #toggleDisplay(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  }

  #executeCreation() {
    const formulaId = document.getElementById('mathFormulaSelect').value;
    if (!formulaId) {
      Alert.showAlert('Please select a formula.');
      return;
    }

    const definition = this.#definitions.find((d) => d.id === formulaId);

    const inputMapping = definition.inputs.map(
      (_, i) => document.getElementById(`math-input-${i}`).value
    );

    const targetFileIndex = parseInt(
      document.getElementById('mathTargetFile')?.value || '0',
      10
    );
    const options = {
      smooth: document.getElementById('math-opt-smooth').checked,
      smoothWindow: parseInt(
        document.getElementById('math-opt-window').value,
        10
      ),
    };

    try {
      if (definition.isBatch) {
        this.#executeBatch(definition, inputMapping, targetFileIndex, options);
      } else {
        const name = document.getElementById('mathChannelName').value;
        this.#executeSingle(
          definition,
          inputMapping,
          name,
          targetFileIndex,
          options
        );
      }

      if (typeof UI.renderSignalList === 'function') UI.renderSignalList();
    } catch (e) {
      console.error(e);
      Alert.showAlert('Error: ' + e.message);
    }
  }

  #executeSingle(def, inputs, name, fileIdx, options) {
    const createdName = this.createChannel(
      fileIdx,
      def.id,
      inputs,
      name,
      options
    );
    this.#logAction(def.id, inputs, name, fileIdx, options);
    this.closeModal();
    this.#autoSelectSignal(createdName, fileIdx);
  }

  #executeBatch(def, inputs, fileIdx, options) {
    const sourceString = inputs[0];
    const sources = sourceString
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);

    if (sources.length === 0) throw new Error('No signals selected.');

    const targetId = def.singleVariantId;

    sources.forEach((src) => {
      const singleInputs = [src, ...inputs.slice(1)];
      const name = `Filtered: ${src}`;
      this.createChannel(fileIdx, targetId, singleInputs, name, options);
      this.#logAction(targetId, singleInputs, name, fileIdx, options);
    });

    this.closeModal();
  }

  #logAction(formulaId, inputs, name, fileIdx, options) {
    if (options.isReplay) return;
    messenger.emit('action:log', {
      type: 'CREATE_MATH_CHANNEL',
      description: `Created Channel: ${name}`,
      payload: { formulaId, inputs, channelName: name, options },
      fileIndex: fileIdx,
    });
  }

  #autoSelectSignal(name, fileIdx) {
    setTimeout(() => {
      const cb = document.querySelector(
        `input[data-key="${name}"][data-file-idx="${fileIdx}"]`
      );
      if (cb) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 100);
  }
}

export const mathChannels = new MathChannels();
