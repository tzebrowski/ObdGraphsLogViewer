import { AppState } from './config.js';
import { UI } from './ui.js';
import { messenger } from './bus.js';
import { MATH_DEFINITIONS } from './mathdefinitions.js';

class MathChannels {
  #definitions;

  constructor() {
    this.#definitions = MATH_DEFINITIONS;
    this.#initWindowBindings();
  }

  #initWindowBindings() {
    window.openMathModal = () => this.#openModal();
    window.closeMathModal = () => this.#closeModal();
    window.onMathFormulaChange = () => this.#onFormulaChange();
    window.createMathChannel = () => this.#executeCreation();
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

    const resolvedMapping = [...inputMapping];

    definition.inputs.forEach((inputDef, idx) => {
      if (!inputDef.isConstant) {
        const requestedName = inputMapping[idx];
        resolvedMapping[idx] = this.#resolveSignalName(
          file,
          inputDef,
          requestedName
        );
      }
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

  #resolveSignalName(file, inputDef, requestedName) {
    if (file.signals[requestedName]) {
      return requestedName;
    }

    if (Array.isArray(inputDef.name)) {
      for (const alias of inputDef.name) {
        const match = file.availableSignals.find((s) =>
          s.toLowerCase().includes(alias.toLowerCase())
        );
        if (match && file.signals[match]) {
          return match;
        }
      }
    }

    return requestedName;
  }

  #executeStandardFormula(file, definition, inputMapping) {
    const sourceSignals = [];
    let masterTimeBase = null;

    definition.inputs.forEach((input, idx) => {
      if (input.isConstant) {
        const rawVal = inputMapping[idx];
        let val = parseFloat(rawVal);

        if (typeof rawVal === 'string' && rawVal.toLowerCase() === 'nan') {
          val = NaN;
        }

        if (isNaN(val) && input.name !== 'fallback')
          throw new Error(`Invalid constant value for ${input.label}`);

        sourceSignals.push({ isConstant: true, value: val });
      } else {
        const signalName = inputMapping[idx];
        const signalData = file.signals[signalName];
        if (!signalData) {
          throw new Error(
            `Signal '${signalName}' not found in file '${file.name}'.`
          );
        }
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

      if (!isNaN(calculatedY)) {
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
        const val = parseFloat(inputMapping[idx]);
        if (isNaN(val))
          throw new Error(`Invalid constant value for ${input.label}`);
        constants.push(val);
      } else {
        const signalName = inputMapping[idx];
        const signalData = file.signals[signalName];
        if (!signalData)
          throw new Error(
            `Signal '${signalName}' not found in file '${file.name}'.`
          );
        signals.push(signalData);
      }
    });

    if (signals.length === 0)
      throw new Error('Custom process requires at least one signal.');
    return definition.customProcess(signals, constants);
  }

  #applySmoothing(data, windowSize) {
    const smoothed = [];
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = 0; j < windowSize; j++) {
        if (i - j >= 0) {
          sum += data[i - j].y;
          count++;
        }
      }
      smoothed.push({ x: data[i].x, y: sum / count });
    }
    return smoothed;
  }

  #finalizeChannel(file, resultData, finalName, unit) {
    if (!finalName.startsWith('Math: ')) {
      finalName = `Math: ${finalName}`;
    }

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
      unit: unit || 'Math',
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
    if (t2 === t1) return parseFloat(p1.y);

    return (
      parseFloat(p1.y) +
      (parseFloat(p2.y) - parseFloat(p1.y)) * ((targetTime - t1) / (t2 - t1))
    );
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
      if (!def.isHidden) {
        select.innerHTML += `<option value="${def.id}">${def.name}</option>`;
      }
    });

    document.getElementById('mathInputsContainer').innerHTML = '';

    const descContainer = document.getElementById('mathDescriptionContainer');
    if (descContainer) descContainer.style.display = 'none';

    const nameContainer = document.getElementById('mathNameContainer');
    if (nameContainer) nameContainer.style.display = 'none';

    const nameInput = document.getElementById('mathChannelName');
    if (nameInput) nameInput.value = '';
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

    const descContainer = document.getElementById('mathDescriptionContainer');
    const nameContainer = document.getElementById('mathNameContainer');
    const nameInput = document.getElementById('mathChannelName');

    if (!definition) {
      if (descContainer) descContainer.style.display = 'none';
      if (nameContainer) nameContainer.style.display = 'none';
      return;
    }

    const descText = document.getElementById('mathFormulaDescription');
    if (descContainer && descText) {
      descText.innerText =
        definition.description || 'No description available.';
      descContainer.style.display = 'block';
    }

    if (nameContainer && nameInput) {
      nameContainer.style.display = 'block';
      nameInput.value = definition.name;
      nameInput.disabled = !!definition.isBatch;
      if (definition.isBatch) {
        nameInput.value = '[Auto Generated: Multiple Channels]';
      }
    }

    if (AppState.files.length === 0) {
      container.innerHTML = "<p style='color:red'>No log file loaded.</p>";
      return;
    }

    let targetFileIndex = 0;

    const inputsWrapper = document.createElement('div');
    inputsWrapper.id = 'mathFormulaInputs';

    if (AppState.files.length > 1) {
      const fileSelectWrapper = document.createElement('div');
      fileSelectWrapper.style.marginBottom = '15px';
      fileSelectWrapper.innerHTML = `<label class="math-label-small">Target File:</label>`;

      const fileSelect = document.createElement('select');
      fileSelect.id = 'mathTargetFile';
      fileSelect.className = 'template-select';

      AppState.files.forEach((f, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.text = `${i + 1}. ${f.name}`;
        fileSelect.appendChild(opt);
      });

      fileSelect.onchange = (e) => {
        targetFileIndex = parseInt(e.target.value, 10);
        this.#renderFormulaInputs(inputsWrapper, definition, targetFileIndex);
      };

      fileSelectWrapper.appendChild(fileSelect);
      container.appendChild(fileSelectWrapper);
    }

    container.appendChild(inputsWrapper);

    this.#renderFormulaInputs(inputsWrapper, definition, targetFileIndex);
    this.#renderPostProcessingUI(container);
  }

  #renderFormulaInputs(container, definition, fileIndex) {
    container.innerHTML = '';
    const file = AppState.files[fileIndex];

    definition.inputs.forEach((input, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'math-input-wrapper';
      wrapper.innerHTML = `<label class="math-label-small">${input.label}</label>`;

      if (input.isConstant) {
        let inputEl;
        if (input.options && Array.isArray(input.options)) {
          inputEl = document.createElement('select');
          input.options.forEach((opt) => {
            const optionEl = document.createElement('option');
            optionEl.value = opt.value;
            optionEl.innerText = opt.label;
            inputEl.appendChild(optionEl);
          });
          inputEl.value = input.defaultValue;
        } else {
          inputEl = document.createElement('input');
          inputEl.type = 'text';
          inputEl.value = input.defaultValue;
        }
        inputEl.id = `math-input-${idx}`;
        inputEl.className = 'template-select';
        inputEl.style.width = '100%';
        wrapper.appendChild(inputEl);
      } else {
        const searchableSelect = this.#createSearchableSelect(
          idx,
          file.availableSignals,
          input.name,
          input.isMulti
        );
        wrapper.appendChild(searchableSelect);
      }
      container.appendChild(wrapper);
    });
  }

  #renderPostProcessingUI(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'math-post-processing';

    const label = document.createElement('label');
    label.className = 'math-section-label';
    label.innerText = 'Post-Processing';
    wrapper.appendChild(label);

    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'math-checkbox-container';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = 'math-opt-smooth';

    const checkLabel = document.createElement('span');
    checkLabel.innerText = 'Apply Smoothing';

    checkboxContainer.appendChild(check);
    checkboxContainer.appendChild(checkLabel);
    wrapper.appendChild(checkboxContainer);

    const windowContainer = document.createElement('div');
    windowContainer.style.marginBottom = '5px';
    windowContainer.innerHTML = `<label class="math-label-small">Smoothing Window (Samples)</label>`;

    const winInput = document.createElement('input');
    winInput.type = 'number';
    winInput.id = 'math-opt-window';
    winInput.value = '5';
    winInput.className = 'template-select';
    winInput.style.width = '100%';
    winInput.disabled = true;

    check.onchange = () => {
      winInput.disabled = !check.checked;
    };

    windowContainer.appendChild(winInput);
    wrapper.appendChild(windowContainer);
    container.appendChild(wrapper);
  }

  #createSearchableSelect(idx, signals, inputFilterName, isMulti = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `math-input-${idx}`;
    input.className = 'searchable-input template-select';
    input.placeholder = isMulti
      ? 'Click signals to add...'
      : 'Search or Select Signal...';
    input.autocomplete = 'off';

    const resultsList = document.createElement('div');
    resultsList.className = 'search-results-list';

    if (!isMulti) {
      let defaultSignal = null;
      const searchTerms = Array.isArray(inputFilterName)
        ? inputFilterName
        : [inputFilterName];

      for (const term of searchTerms) {
        defaultSignal = signals.find((s) =>
          s.toLowerCase().includes(term.toLowerCase())
        );
        if (defaultSignal) break;
      }

      if (defaultSignal) input.value = defaultSignal;
    }

    const renderOptions = (filterText = '') => {
      resultsList.innerHTML = '';

      let lowerFilter = filterText.toLowerCase();

      if (isMulti) {
        const parts = filterText.split(',');
        const lastPart = parts[parts.length - 1];
        lowerFilter = lastPart ? lastPart.trim().toLowerCase() : '';
      }

      const filtered = signals.filter((s) =>
        s.toLowerCase().includes(lowerFilter)
      );

      if (isMulti && filtered.length > 0) {
        const selectAllDiv = document.createElement('div');
        selectAllDiv.className = 'search-option search-select-all';
        selectAllDiv.textContent = '(Select All / Deselect All matches)';

        selectAllDiv.onclick = (e) => {
          e.stopPropagation();

          const parts = input.value.split(',');
          const rawLast = parts[parts.length - 1].trim();

          let currentSelected = parts
            .map((s) => s.trim())
            .filter((s) => s && signals.includes(s));

          const allVisibleSelected = filtered.every((sig) =>
            currentSelected.includes(sig)
          );

          if (allVisibleSelected) {
            const newSelection = currentSelected.filter(
              (sel) => !filtered.includes(sel)
            );
            input.value =
              newSelection.join(', ') + (newSelection.length > 0 ? ', ' : '');
          } else {
            const toAdd = filtered.filter(
              (sig) => !currentSelected.includes(sig)
            );
            const combined = [...currentSelected, ...toAdd];
            input.value = combined.join(', ') + ', ';
          }
          renderOptions();
          input.focus();
        };
        resultsList.appendChild(selectAllDiv);
      }

      if (filtered.length === 0) {
        const noResDiv = document.createElement('div');
        noResDiv.className = 'search-option search-no-results';
        noResDiv.textContent = 'No signals found';
        resultsList.appendChild(noResDiv);
      } else {
        filtered.forEach((sig) => {
          const opt = document.createElement('div');
          opt.className = 'search-option';
          opt.textContent = sig;

          if (isMulti && input.value.includes(sig)) {
            opt.classList.add('selected');
          }

          opt.onclick = () => {
            if (isMulti) {
              const cleanList = input.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s);

              if (cleanList.includes(sig)) {
                const newList = cleanList.filter((s) => s !== sig);
                input.value =
                  newList.join(', ') + (newList.length > 0 ? ', ' : '');
              } else {
                const parts = input.value.split(',');
                parts.pop();
                parts.push(' ' + sig);

                input.value =
                  parts
                    .map((s) => s.trim())
                    .filter((s) => s)
                    .join(', ') + ', ';
              }
              renderOptions();
              input.focus();
            } else {
              input.value = sig;
              resultsList.style.display = 'none';
            }
          };

          resultsList.appendChild(opt);
        });
      }
    };

    input.addEventListener('focus', () => {
      renderOptions(isMulti ? input.value : input.value);
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
    const fileSelect = document.getElementById('mathTargetFile');
    const newNameInput = document.getElementById('mathChannelName').value;

    const targetFileIndex = fileSelect ? parseInt(fileSelect.value, 10) : 0;

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

    const smoothCheck = document.getElementById('math-opt-smooth');
    const smoothWinInput = document.getElementById('math-opt-window');

    const options = {
      smooth: smoothCheck ? smoothCheck.checked : false,
      smoothWindow: smoothWinInput ? parseInt(smoothWinInput.value, 10) : 0,
    };

    try {
      let createdName = '';

      if (definition.isBatch) {
        const sourceString = inputMapping[0];
        const sources = sourceString
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);

        if (sources.length === 0) throw new Error('No signals selected.');

        const targetFormulaId = definition.singleVariantId || 'filtered_single';

        sources.forEach((sourceName) => {
          const singleInputMapping = [sourceName, ...inputMapping.slice(1)];
          const generatedName = `Filtered: ${sourceName}`;

          const name = this.createChannel(
            targetFileIndex,
            targetFormulaId,
            singleInputMapping,
            generatedName,
            options
          );
          createdName = name;

          if (!options.isReplay) {
            messenger.emit('action:log', {
              type: 'CREATE_MATH_CHANNEL',
              description: `Created Channel (Batch): ${name}`,
              payload: {
                formulaId: targetFormulaId,
                inputs: singleInputMapping,
                channelName: generatedName,
                options: options,
              },
              fileIndex: targetFileIndex,
            });
          }
        });
        this.#closeModal();
      } else {
        createdName = this.createChannel(
          targetFileIndex,
          formulaId,
          inputMapping,
          newNameInput,
          options
        );

        if (!options.isReplay) {
          messenger.emit('action:log', {
            type: 'CREATE_MATH_CHANNEL',
            description: `Created Channel: ${createdName}`,
            payload: {
              formulaId: formulaId,
              inputs: inputMapping,
              channelName: newNameInput,
              options: options,
            },
            fileIndex: targetFileIndex,
          });
        }
        this.#closeModal();
      }

      if (typeof UI.renderSignalList === 'function') {
        UI.renderSignalList();

        if (createdName) {
          setTimeout(() => {
            const checkbox = document.querySelector(
              `input[data-key="${createdName}"][data-file-idx="${targetFileIndex}"]`
            );
            if (checkbox) {
              checkbox.checked = true;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, 100);
        }
      }
    } catch (e) {
      console.error(e);
      alert('Error creating channel: ' + e.message);
    }
  }
}

export const mathChannels = new MathChannels();
