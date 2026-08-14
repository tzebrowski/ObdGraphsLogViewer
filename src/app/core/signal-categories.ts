/**
 * Groups signals in the sidebar's signal list by what they measure, mirroring AutoTuner's
 * "Measures" panel (Basics / Air / Boost / Fuel / AFR / Load-Torque, each with a group-level
 * checkbox). No upstream source (the ObdMetrics registry, SignalRegistryService, or the loaded
 * file itself) carries a category for a signal -- see signal-registry.service.ts's
 * `SignalMetadata`/`RemoteMetric` shapes -- so this is a keyword matcher over the signal's
 * display name rather than a lookup table, since real signal names (e.g. "AFR Upstream",
 * "Measured Intake Pressure") vary more than the ~17-entry canonical list in signals.json covers.
 * Order matters: the first matching rule wins, so more specific categories (e.g. Temperature)
 * are listed before broader ones they'd otherwise be swallowed by (e.g. Air / Intake).
 */

export const SIGNAL_CATEGORIES = [
  'Basics',
  'Ignition',
  'Fuel / AFR',
  'Boost',
  'Load / Torque',
  'Temperature',
  'Air / Intake',
  'Electrical',
  'Location',
  'Other',
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

interface CategoryRule {
  category: SignalCategory;
  pattern: RegExp;
}

const RULES: CategoryRule[] = [
  {
    category: 'Ignition',
    pattern: /spark|ignition|timing adv|misfire/i,
  },
  {
    category: 'Fuel / AFR',
    pattern: /\bafr\b|lambda|fuel|air.?fuel|\bo2\b|oxygen/i,
  },
  {
    category: 'Boost',
    pattern:
      /boost|wastegate|turbo|manifold|intake pressure|\bmap\b|atmospheric|baro/i,
  },
  {
    category: 'Load / Torque',
    pattern: /torque|\bload\b|horsepower|horse power|\bhp\b/i,
  },
  {
    category: 'Temperature',
    pattern: /temp/i,
  },
  {
    category: 'Air / Intake',
    pattern: /\bair\b|\bmaf\b|flow/i,
  },
  {
    category: 'Electrical',
    pattern: /voltage|battery|\bibs\b|oil level|oil degradation/i,
  },
  {
    category: 'Location',
    pattern: /latitude|longitude|\blat\b|\blon\b|\blng\b|gps/i,
  },
  {
    category: 'Basics',
    pattern: /speed|\brpm\b|pedal|throttle|gear|selector|distance|odometer/i,
  },
];

export function categoryForSignal(name: string): SignalCategory {
  const clean = name.replace(/^Math:\s*/, '');
  for (const rule of RULES) {
    if (rule.pattern.test(clean)) return rule.category;
  }
  return 'Other';
}
