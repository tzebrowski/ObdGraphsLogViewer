export const MATH_DEFINITIONS = [
  {
    id: 'filtered_batch',
    name: 'Filtered (Multi-Signal)',
    unit: 'Match Source',
    description:
      'Creates multiple channels at once. Filters selected Source signals based on the Condition.',
    isBatch: true,
    singleVariantId: 'filtered_single',
    inputs: [
      {
        name: 'sources',
        label: 'Signals to Filter (Click to add multiple)',
        isMulti: true,
      },
      { name: 'cond', label: 'Condition Signal' },
      {
        name: 'thresh',
        label: 'Threshold',
        isConstant: true,
        defaultValue: 100,
      },
      {
        name: 'mode',
        label: 'Filter Logic',
        isConstant: true,
        defaultValue: '1',
        options: [
          {
            value: '1',
            label: 'Pass if Condition > Threshold (High Pass)',
          },
          { value: '0', label: 'Pass if Condition < Threshold (Low Pass)' },
        ],
      },
      {
        name: 'fallback',
        label: 'Fallback Value (Default: 0)',
        isConstant: true,
        defaultValue: 0,
      },
    ],
    formula: () => 0,
  },
  {
    id: 'filtered_single',
    name: 'Filtered (Single)',
    unit: '',
    description: 'Internal Logic for Batch Filter',
    isHidden: true,
    inputs: [
      { name: 'source', label: 'Source' },
      { name: 'cond', label: 'Condition' },
      {
        name: 'thresh',
        label: 'Threshold',
        isConstant: true,
        defaultValue: 0,
      },
      {
        name: 'mode',
        label: 'Mode',
        isConstant: true,
        defaultValue: '1',
        options: [
          { value: '1', label: 'Greater Than (>)' },
          { value: '0', label: 'Less Than (<)' },
        ],
      },
      {
        name: 'fallback',
        label: 'Fallback',
        isConstant: true,
        defaultValue: 0,
      },
    ],
    formula: (values) => {
      const source = values[0];
      const cond = values[1];
      const thresh = values[2];
      const mode = values[3];
      const fallback = values[4];

      const conditionMet = mode === 1 ? cond > thresh : cond < thresh;
      return conditionMet ? source : fallback;
    },
  },
  {
    id: 'filter_range_batch',
    name: 'Filtered Range (Multi-Signal)',
    unit: 'Match Source',
    description:
      'Creates multiple channels at once. Passes the Source signals only if the Condition is within (or outside) the specified Range.',
    isBatch: true,
    singleVariantId: 'filter_range',
    inputs: [
      {
        name: 'sources',
        label: 'Signals to Filter (Click to add multiple)',
        isMulti: true,
      },
      { name: 'cond', label: 'Condition Signal' },
      {
        name: 'min',
        label: 'Min Value (<)',
        isConstant: true,
        defaultValue: 0,
      },
      {
        name: 'max',
        label: 'Max Value (>)',
        isConstant: true,
        defaultValue: 100,
      },
      {
        name: 'mode',
        label: 'Logic',
        isConstant: true,
        defaultValue: '1',
        options: [
          { value: '1', label: 'Pass if Inside Range (Min < X < Max)' },
          {
            value: '0',
            label: 'Pass if Outside Range (X < Min OR X > Max)',
          },
        ],
      },
      {
        name: 'fallback',
        label: 'Fallback Value',
        isConstant: true,
        defaultValue: 0,
      },
    ],
    formula: () => 0,
  },
  {
    id: 'filter_range',
    name: 'Filtered (Range)',
    unit: '',
    description:
      'Passes the Source signal if the Condition signal is within (or outside) the specified range [Min, Max].',
    inputs: [
      { name: 'source', label: 'Signal to Display' },
      { name: 'cond', label: 'Condition Signal' },
      {
        name: 'min',
        label: 'Min Value (<)',
        isConstant: true,
        defaultValue: 0,
      },
      {
        name: 'max',
        label: 'Max Value (>)',
        isConstant: true,
        defaultValue: 100,
      },
      {
        name: 'mode',
        label: 'Logic',
        isConstant: true,
        defaultValue: '1',
        options: [
          { value: '1', label: 'Pass if Inside Range (Min < X < Max)' },
          {
            value: '0',
            label: 'Pass if Outside Range (X < Min OR X > Max)',
          },
        ],
      },
      {
        name: 'fallback',
        label: 'Fallback Value',
        isConstant: true,
        defaultValue: 0,
      },
    ],
    formula: (values) => {
      const source = values[0];
      const cond = values[1];
      const min = values[2];
      const max = values[3];
      const mode = values[4]; // 1 = Inside, 0 = Outside
      const fallback = values[5];

      let conditionMet = false;
      if (mode === 1) {
        // Inside
        conditionMet = cond > min && cond < max;
      } else {
        // Outside
        conditionMet = cond < min || cond > max;
      }

      return conditionMet ? source : fallback;
    },
  },
  {
    id: 'smoothing_batch',
    name: 'Smoothed (Multi-Signal)',
    unit: 'Match Source',
    description:
      'Creates multiple smoothed channels at once using a Moving Average filter.',
    isBatch: true,
    singleVariantId: 'smoothing',
    inputs: [
      {
        name: 'sources',
        label: 'Signals to Smooth (Click to add multiple)',
        isMulti: true,
      },
      {
        name: 'window',
        label: 'Window Size (Samples)',
        isConstant: true,
        defaultValue: 5,
      },
    ],
    formula: () => 0,
  },
  {
    id: 'smoothing',
    name: 'Smoothed Signal',
    unit: '',
    description:
      'Reduces noise in a signal using a Moving Average filter over N samples.',
    inputs: [
      { name: 'source', label: 'Signal to Smooth' },
      {
        name: 'window',
        label: 'Window Size (Samples)',
        isConstant: true,
        defaultValue: 5,
      },
    ],
    customProcess: (signals, constants) => {
      const sourceData = signals[0];
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
    id: 'est_power_kgh',
    name: 'Est. Power (MAF kg/h)',
    unit: 'HP',
    description:
      'Estimates Engine Power based on Air Mass Flow (kg/h). Formula: (MAF / 3.6) * Factor.',
    inputs: [
      {
        name: ['Air Mass', 'MAF', 'Flow'],
        label: 'Air Mass Flow (kg/h)',
      },
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
    name: 'Est. Power (MAF g/s)',
    unit: 'HP',
    description:
      'Estimates Engine Power based on Air Mass Flow (g/s). Formula: MAF * Factor.',
    inputs: [
      {
        name: ['Air Mass', 'MAF', 'Flow'],
        label: 'Air Mass Flow (g/s)',
      },
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
    name: 'Power (Torque)',
    unit: 'HP',
    description:
      'Calculates HP from Torque and RPM. Formula: (Torque * RPM) / 7127. Use Factor=10 if Torque is in daNm.',
    inputs: [
      {
        name: ['Torque', 'Engine Torque', 'Nm'],
        label: 'Torque (Nm or daNm)',
      },
      {
        name: ['Engine RPM', 'Engine Speed', 'RPM'],
        label: 'Engine RPM',
      },
      {
        name: 'factor',
        label: 'Correction Factor (1 for Nm, 10 for daNm)',
        isConstant: true,
        defaultValue: 1.0,
      },
    ],
    formula: (values) => (values[0] * values[2] * values[1]) / 7127,
  },
  {
    id: 'acceleration',
    name: 'Acceleration',
    unit: 'm/s²',
    description:
      'Calculates acceleration (derivative of speed). Useful for 0-100km/h analysis.',
    inputs: [
      {
        name: ['Vehicle Speed', 'Speed', 'Velocity'],
        label: 'Speed (km/h)',
      },
    ],
    customProcess: (signals) => {
      const sourceData = signals[0];
      const result = [];
      for (let i = 1; i < sourceData.length; i++) {
        const p1 = sourceData[i - 1];
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
    id: 'filter_gt',
    name: 'Filtered (> Threshold)',
    unit: '',
    description:
      'Passes the Source signal ONLY if the Condition signal > Threshold. Otherwise returns Fallback value.',
    inputs: [
      { name: 'source', label: 'Signal to Display' },
      { name: 'cond', label: 'Condition Signal' },
      {
        name: 'thresh',
        label: 'Threshold',
        isConstant: true,
        defaultValue: 90,
      },
      {
        name: 'fallback',
        label: 'Fallback Value',
        isConstant: true,
        defaultValue: 0,
      },
    ],
    formula: (values) => (values[1] > values[2] ? values[0] : values[3]),
  },
  {
    id: 'filter_lt',
    name: 'Filtered (< Threshold)',
    unit: '',
    description:
      'Passes the Source signal ONLY if the Condition signal < Threshold. Otherwise returns Fallback value.',
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
    name: 'Boost Pressure',
    unit: 'Bar',
    description: 'Calculates Turbo Boost Pressure: MAP - Barometric Pressure.',
    inputs: [
      {
        name: ['Manifold Pressure', 'MAP', 'Boost'],
        label: 'Intake Manifold Pressure',
      },
      {
        name: ['Atmospheric', 'Baro'],
        label: 'Atmospheric Pressure',
      },
    ],
    formula: (values) => values[0] - values[1],
  },
  {
    id: 'afr_error',
    name: 'AFR Error',
    unit: 'AFR',
    description: 'Calculates AFR deviation: Commanded AFR - Measured AFR.',
    inputs: [
      {
        name: ['Commanded', 'Target'],
        label: 'AFR Commanded',
      },
      {
        name: ['Measured', 'Current'],
        label: 'AFR Measured',
      },
    ],
    formula: (values) => values[0] - values[1],
  },
  {
    id: 'pressure_ratio',
    name: 'Pressure Ratio',
    unit: 'Ratio',
    description: 'Calculates Turbo Pressure Ratio: MAP / Barometric Pressure.',
    inputs: [
      {
        name: ['Manifold Pressure', 'MAP'],
        label: 'Intake Manifold Pressure',
      },
      {
        name: ['Atmospheric', 'Baro'],
        label: 'Atmospheric Pressure',
      },
    ],
    formula: (values) => (values[1] !== 0 ? values[0] / values[1] : 0),
  },
  {
    id: 'multiply_const',
    name: 'Multiplied Signal',
    unit: '',
    description:
      'Multiplies a signal by a constant factor. Useful for unit matched conversion.',
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
