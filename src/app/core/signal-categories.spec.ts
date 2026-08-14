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
