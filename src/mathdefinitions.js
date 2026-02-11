import { signalRegistry } from './signalregistry.js';

export const MATH_DEFINITIONS = [
  {
    id: 'gps_distance_accumulated',
    name: 'GPS Trip Distance',
    unit: 'km',
    category: 'Business',
    description:
      'Calculates total distance traveled based on GPS path (Haversine method).',
    inputs: [
      { name: signalRegistry.mappings['Latitude'], label: 'Latitude Signal' },
      { name: signalRegistry.mappings['Longitude'], label: 'Longitude Signal' },
    ],
    customProcess: (signals) => {
      const latSig = signals[0];
      const lonSig = signals[1];
      if (!latSig || !lonSig || latSig.length === 0) return [];

      const result = [];
      const toRad = (val) => (val * Math.PI) / 180;
      const R = 6371e3; // Earth radius in meters
      let totalDist = 0;

      for (let i = 1; i < latSig.length; i++) {
        const t2 = latSig[i].x;

        const lat1 = toRad(latSig[i - 1].y);
        const lat2 = toRad(latSig[i].y);
        const lon1 = toRad(lonSig[i - 1].y);
        const lon2 = toRad(lonSig[i].y);

        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const stepDist = R * c; // meters

        // Filter huge jumps (GPS glitches > 100m per sample)
        if (stepDist < 100) {
          totalDist += stepDist;
        }

        result.push({ x: t2, y: totalDist / 1000 }); // Convert to km
      }
      return result;
    },
  },
  {
    id: 'gps_accel_g',
    name: 'GPS Acceleration (Long. G)',
    unit: 'G',
    category: 'Business',
    description:
      'Estimates longitudinal G-Force derived from GPS Speed changes.',
    inputs: [
      { name: signalRegistry.mappings['Latitude'], label: 'Latitude Signal' },
      { name: signalRegistry.mappings['Longitude'], label: 'Longitude Signal' },
    ],
    customProcess: (signals) => {
      const latSig = signals[0];
      const lonSig = signals[1];
      if (!latSig || !lonSig || latSig.length === 0) return [];

      const result = [];
      const toRad = (val) => (val * Math.PI) / 180;
      const R = 6371e3;

      for (let i = 1; i < latSig.length; i++) {
        const t1 = latSig[i - 1].x;
        const t2 = latSig[i].x;
        const dt = (t2 - t1) / 1000; // seconds

        if (dt <= 0.05) continue; // Skip tiny time steps to avoid noise

        const lat1 = toRad(latSig[i - 1].y);
        const lat2 = toRad(latSig[i].y);
        const dLat = lat2 - lat1;
        const dLon = toRad(lonSig[i].y) - toRad(lonSig[i - 1].y);

        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        const v = dist / dt; // speed in m/s

        // Acceleration = delta V / delta T
        // We need previous velocity. For i=1 we assume 0 start or just skip
        if (i > 1) {
          // Robust approach: Calculate V current, V prev
          const prevV = result[result.length - 1]?._rawV || 0;
          const accelMps2 = (v - prevV) / dt;

          // Convert to G (1G = 9.81 m/s^2)
          let gForce = accelMps2 / 9.81;

          // Clamp noise
          if (gForce > 2.0) gForce = 2.0;
          if (gForce < -2.0) gForce = -2.0;

          // Store metadata for next iteration
          const point = { x: t2, y: gForce, _rawV: v };
          result.push(point);
        } else {
          result.push({ x: t2, y: 0, _rawV: v });
        }
      }
      return result;
    },
  },

  {
    id: 'gps_speed_calc',
    name: 'GPS Speed (Calculated)',
    unit: 'km/h',
    category: 'Business',
    description:
      'Calculates vehicle speed based on GPS coordinates (Latitude/Longitude) and time delta.',
    inputs: [
      { name: signalRegistry.mappings['Latitude'], label: 'Latitude Signal' },
      { name: signalRegistry.mappings['Longitude'], label: 'Longitude Signal' },
    ],
    customProcess: (signals) => {
      const latSig = signals[0];
      const lonSig = signals[1];

      if (!latSig || !lonSig || latSig.length === 0) return [];

      const result = [];
      const toRad = (val) => (val * Math.PI) / 180;
      const R = 6371e3; // Earth radius in meters

      // Start from the second point so we have a previous point to compare
      for (let i = 1; i < latSig.length; i++) {
        const t1 = latSig[i - 1].x;
        const t2 = latSig[i].x;
        const dt = (t2 - t1) / 1000; // Delta time in seconds

        if (dt <= 0) continue; // Skip duplicate timestamps

        const lat1 = toRad(latSig[i - 1].y);
        const lat2 = toRad(latSig[i].y);
        const lon1 = toRad(lonSig[i - 1].y);
        const lon2 = toRad(lonSig[i].y);
        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        // Haversine Formula
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c; // Distance in meters

        const speedMps = distance / dt; // m/s
        const speedKph = speedMps * 3.6; // km/h

        // Filter massive spikes (e.g. GPS jump) - limit to 350 km/h
        if (speedKph < 350) {
          result.push({ x: t2, y: speedKph });
        }
      }
      return result;
    },
  },
  {
    id: 'trip_cost_sensor',
    name: 'Trip Cost (Sensor Based)',
    unit: 'Currency',
    category: 'Business',
    description:
      'Calculates cost by measuring the actual drop in fuel level. Warning: Subject to "fuel slosh" noise.',
    inputs: [
      {
        name: signalRegistry.mappings['Fuel Level'],
        label: 'Fuel Level (%)',
      },
      {
        name: 'capacity',
        label: 'Tank Capacity (Liters)',
        isConstant: true,
        defaultValue: 58,
      },
      {
        name: 'price',
        label: 'Fuel Price (per Liter)',
        isConstant: true,
        defaultValue: 1.5,
      },
    ],
    customProcess: (signals, constants) => {
      const source = signals[0];
      const capacity = constants[0];
      const price = constants[1];

      if (!source || source.length === 0) return [];

      // Get the starting fuel level (percentage)
      const startPct = Math.min(Math.max(source[0].y, 0), 100);
      const startLiters = (startPct / 100) * capacity;

      return source.map((point) => {
        // Clamp current reading 0-100
        const currentPct = Math.min(Math.max(point.y, 0), 100);
        const currentLiters = (currentPct / 100) * capacity;

        // Fuel Consumed = Start - Current
        // We use Math.max(0, ...) to prevent negative cost if fuel sloshes "up"
        const consumedLiters = Math.max(0, startLiters - currentLiters);

        return {
          x: point.x,
          y: consumedLiters * price,
        };
      });
    },
  },
  {
    id: 'fuel_volume',
    name: 'Fuel Volume (Liters)',
    unit: 'L',
    category: 'Business',
    description:
      'Calculates current fuel volume in liters based on tank percentage (clamped to 100%).',
    inputs: [
      {
        name: signalRegistry.mappings['Fuel Level'],
        label: 'Fuel Level (%)',
      },
      {
        name: 'capacity',
        label: 'Tank Capacity (Liters)',
        isConstant: true,
        defaultValue: 58,
      },
    ],
    formula: (values) => {
      const pct = Math.min(Math.max(values[0], 0), 100);
      return (pct / 100) * values[1];
    },
  },
  {
    id: 'est_range_fixed',
    name: 'Est. Range (Fixed Cons.)',
    unit: 'km',
    category: 'Business',
    description:
      'Stable range estimate using your known Average Consumption (e.g., 10 L/100km).',
    inputs: [
      {
        name: signalRegistry.mappings['Fuel Level'],
        label: 'Fuel Level (%)',
      },
      {
        name: 'capacity',
        label: 'Tank Capacity (Liters)',
        isConstant: true,
        defaultValue: 58,
      },
      {
        name: signalRegistry.mappings['Fuel Consumption'],
        label: 'Known Avg Cons. (L/100km)',
        isConstant: true,
        defaultValue: 10.5, // Changed to a more realistic daily average
      },
    ],
    formula: (values) => {
      const pct = Math.min(Math.max(values[0], 0), 100);
      const cap = values[1];
      const cons = values[2];

      if (cons <= 0.1) return 0;

      const liters = (pct / 100) * cap;
      return (liters / cons) * 100;
    },
  },
  {
    id: 'est_range_dynamic',
    name: 'Est. Range (Dynamic Signal)',
    unit: 'km',
    category: 'Business',
    description:
      'Real-time range estimate using "Current Consumption" signal. Shows how range drops during acceleration.',
    inputs: [
      {
        name: signalRegistry.mappings['Fuel Level'],
        label: 'Fuel Level (%)',
      },
      {
        name: signalRegistry.mappings['Fuel Consumption'],
        label: 'Current Cons. Signal',
      },
      {
        name: 'capacity',
        label: 'Tank Capacity (Liters)',
        isConstant: true,
        defaultValue: 58,
      },
    ],
    formula: (values) => {
      const pct = Math.min(Math.max(values[0], 0), 100);
      const cons = Math.max(values[1], 0.1); // Prevent div/0
      const cap = values[2];

      const liters = (pct / 100) * cap;
      return (liters / cons) * 100;
    },
  },
  {
    id: 'trip_distance',
    name: 'Trip Distance',
    unit: 'km',
    category: 'Business',
    description:
      'Calculates distance traveled since the start of the log: Current Odometer - Initial Odometer.',
    inputs: [
      {
        name: signalRegistry.mappings.Distance || 'Distance',
        label: 'Odometer Signal',
      },
    ],
    customProcess: (signals) => {
      const source = signals[0];
      if (!source || source.length === 0) return [];

      const initialValue = source[0].y;

      return source.map((point) => ({
        x: point.x,
        y: point.y - initialValue,
      }));
    },
  },
  {
    id: 'power_from_torque',
    name: 'Power (Torque)',
    unit: 'HP',
    category: 'Business',
    description:
      'Calculates HP from Torque and RPM. Formula: (Torque * RPM) / 7127. Use Factor=10 if Torque is in daNm.',
    inputs: [
      {
        name: signalRegistry.mappings.Torque,
        label: 'Torque (Nm or daNm)',
      },
      {
        name: signalRegistry.mappings['Engine Speed'],
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
    id: 'est_power_kgh',
    name: 'Est. Power (MAF kg/h)',
    unit: 'HP',
    category: 'Business',
    description:
      'Estimates Engine Power based on Air Mass Flow (kg/h). Formula: (MAF / 3.6) * Factor.',
    inputs: [
      {
        name: signalRegistry.mappings.MAF,
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
    category: 'Business',
    description:
      'Estimates Engine Power based on Air Mass Flow (g/s). Formula: MAF * Factor.',
    inputs: [
      {
        name: signalRegistry.mappings.MAF,
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
    id: 'acceleration',
    name: 'Acceleration',
    unit: 'm/s²',
    category: 'Business',
    description:
      'Calculates acceleration (derivative of speed). Useful for 0-100km/h analysis.',
    inputs: [
      {
        name: signalRegistry.mappings['Vehicle Speed'],
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
    id: 'boost',
    name: 'Boost Pressure',
    unit: 'Bar',
    category: 'Business',
    description: 'Calculates Turbo Boost Pressure: MAP - Barometric Pressure.',
    inputs: [
      {
        name: signalRegistry.mappings['Intake Manifold Pressure'],
        label: 'Intake Manifold Pressure',
      },
      {
        name: signalRegistry.mappings['Atmospheric Pressure'],
        label: 'Atmospheric Pressure',
      },
    ],
    formula: (values) => values[0] - values[1],
  },
  {
    id: 'afr_error',
    name: 'AFR Error',
    unit: 'AFR',
    category: 'Business',
    description: 'Calculates AFR deviation: Commanded AFR - Measured AFR.',
    inputs: [
      {
        name: signalRegistry.mappings['AFR Commanded'],
        label: 'AFR Commanded',
      },
      {
        name: signalRegistry.mappings['AFR Measured'],
        label: 'AFR Measured',
      },
    ],
    formula: (values) => values[0] - values[1],
  },
  {
    id: 'pressure_ratio',
    name: 'Pressure Ratio',
    unit: 'Ratio',
    category: 'Business',
    description: 'Calculates Turbo Pressure Ratio: MAP / Barometric Pressure.',
    inputs: [
      {
        name: signalRegistry.mappings['Intake Manifold Pressure'],
        label: 'Intake Manifold Pressure',
      },
      {
        name: signalRegistry.mappings['Atmospheric Pressure'],
        label: 'Atmospheric Pressure',
      },
    ],
    formula: (values) => (values[1] !== 0 ? values[0] / values[1] : 0),
  },

  // --- TECHNICAL FORMULAS ---
  {
    id: 'filter_gt',
    name: 'Filtered (> Threshold)',
    unit: '',
    category: 'Technical',
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
    category: 'Technical',
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
    id: 'filtered_batch',
    name: 'Filtered (Multi-Signal)',
    unit: 'Match Source',
    category: 'Technical',
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
    category: 'Technical',
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
    category: 'Technical',
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
    category: 'Technical',
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
    category: 'Technical',
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
    category: 'Technical',
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
    id: 'multiply_const',
    name: 'Multiplied Signal',
    unit: '',
    category: 'Technical',
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
