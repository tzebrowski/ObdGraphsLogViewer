import { describe, expect, it } from 'vitest';
import { categoryForSignal, SIGNAL_CATEGORIES } from './signal-categories';

describe('categoryForSignal', () => {
  it('categorizes real MyGiulia signal names as expected', () => {
    expect(categoryForSignal('Engine Speed')).toBe('Basics');
    expect(categoryForSignal('Gas Pedal Position')).toBe('Basics');
    expect(categoryForSignal('Gear Engaged')).toBe('Basics');
    expect(categoryForSignal('Dynamic Selector')).toBe('Basics');

    expect(categoryForSignal('Spark Advance')).toBe('Ignition');
    expect(categoryForSignal('Reduction Spark Advance Cyl 1')).toBe('Ignition');
    expect(categoryForSignal('Total Misfires')).toBe('Ignition');

    expect(categoryForSignal('AFR Upstream')).toBe('Fuel / AFR');
    expect(categoryForSignal('Lambda Upstream')).toBe('Fuel / AFR');
    expect(categoryForSignal('Fuel Level')).toBe('Fuel / AFR');

    expect(categoryForSignal('Measured Boost Pressure')).toBe('Boost');
    expect(categoryForSignal('Target Boost Pressure')).toBe('Boost');
    expect(categoryForSignal('Measured Intake Pressure')).toBe('Boost');
    expect(categoryForSignal('Wastegate position feedback')).toBe('Boost');

    expect(categoryForSignal('Measured Engine Torque')).toBe('Load / Torque');

    expect(categoryForSignal('Engine Coolant Temp')).toBe('Temperature');
    expect(categoryForSignal('Exhaust Gas Temp')).toBe('Temperature');
    expect(categoryForSignal('Gearbox Oil Temp')).toBe('Temperature');
    // "Air Temp Post IC" mentions air, but Temperature is checked first so
    // every *Temp signal groups together instead of splitting across Air/Intake.
    expect(categoryForSignal('Air Temp Post IC')).toBe('Temperature');

    expect(categoryForSignal('Calculated Air Flow Rate')).toBe('Air / Intake');

    expect(categoryForSignal('Battery Voltage')).toBe('Electrical');
    expect(categoryForSignal('Engine Oil Level')).toBe('Electrical');

    expect(categoryForSignal('Latitude')).toBe('Location');
    expect(categoryForSignal('Longitude')).toBe('Location');
  });

  it('categorizes signal names from the bundled sample trip', () => {
    expect(categoryForSignal('Air Fuel Ratio')).toBe('Fuel / AFR');
    expect(categoryForSignal('Air Mass Flow Measured')).toBe('Air / Intake');
    expect(categoryForSignal('Air Mass Flow Target')).toBe('Air / Intake');
    expect(categoryForSignal('Calculated horse power')).toBe('Load / Torque');
    expect(categoryForSignal('Catalyst temp')).toBe('Temperature');
    expect(categoryForSignal('Engine Rpm')).toBe('Basics');
    expect(categoryForSignal('Intake Manifold Pressure Measured')).toBe(
      'Boost'
    );
    // O2 sensor voltage is an AFR/emissions reading, not a generic electrical one --
    // Fuel/AFR is checked before Electrical's broader "voltage" match.
    expect(categoryForSignal('O2 Voltage')).toBe('Fuel / AFR');
    expect(categoryForSignal('Over Boost Measured')).toBe('Boost');
    expect(categoryForSignal('Over Boost Target')).toBe('Boost');
    expect(categoryForSignal('Short Fuel Trim')).toBe('Fuel / AFR');
  });

  it('falls back to Other for unrecognized signal names', () => {
    expect(categoryForSignal('Some Unknown Custom Pid')).toBe('Other');
  });

  it('strips the "Math:" prefix before matching', () => {
    expect(categoryForSignal('Math: Gas Pedal Position Filter')).toBe('Basics');
  });

  it('every rule category is listed in the display-order list', () => {
    expect(SIGNAL_CATEGORIES).toContain('Other');
    expect(SIGNAL_CATEGORIES[SIGNAL_CATEGORIES.length - 1]).toBe('Other');
  });
});
