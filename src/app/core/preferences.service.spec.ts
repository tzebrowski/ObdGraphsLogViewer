import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the dark theme, no custom palette, and map off', () => {
    const preferences = new PreferencesService();
    expect(preferences.darkTheme()).toBe(true);
    expect(preferences.useCustomPalette()).toBe(false);
    expect(preferences.loadMap()).toBe(false);
    expect(preferences.customPalette()).toEqual({});
  });

  it('persists the theme preference across instances', () => {
    new PreferencesService().setDarkTheme(false);
    expect(new PreferencesService().darkTheme()).toBe(false);
  });

  it('persists the custom-palette toggle across instances', () => {
    new PreferencesService().setUseCustomPalette(true);
    expect(new PreferencesService().useCustomPalette()).toBe(true);
  });

  it('persists custom per-signal colors, merging rather than overwriting', () => {
    const preferences = new PreferencesService();
    preferences.setCustomColor('file.csv_RPM', '#ff0000');
    preferences.setCustomColor('file.csv_Speed', '#00ff00');

    const reloaded = new PreferencesService();
    expect(reloaded.customPalette()).toEqual({
      'file.csv_RPM': '#ff0000',
      'file.csv_Speed': '#00ff00',
    });
  });

  it('persists rememberFiles/googleClientId as before', () => {
    const preferences = new PreferencesService();
    preferences.setRememberFiles(false);
    preferences.googleClientId = 'abc123';

    const reloaded = new PreferencesService();
    expect(reloaded.rememberFiles()).toBe(false);
    expect(reloaded.googleClientId).toBe('abc123');
  });

  it('defaults area-fills/rememberFiles/persistence to true and smooth-lines/labels/performance to false', () => {
    const preferences = new PreferencesService();
    expect(preferences.rememberFiles()).toBe(true);
    expect(preferences.showAreaFills()).toBe(true);
    expect(preferences.persistence()).toBe(true);
    expect(preferences.smoothLines()).toBe(false);
    expect(preferences.showLabels()).toBe(false);
    expect(preferences.performance()).toBe(false);
  });

  it('persists showAreaFills/smoothLines/showLabels/performance across instances', () => {
    const preferences = new PreferencesService();
    preferences.setShowAreaFills(false);
    preferences.setSmoothLines(true);
    preferences.setShowLabels(true);
    preferences.setPerformance(true);

    const reloaded = new PreferencesService();
    expect(reloaded.showAreaFills()).toBe(false);
    expect(reloaded.smoothLines()).toBe(true);
    expect(reloaded.showLabels()).toBe(true);
    expect(reloaded.performance()).toBe(true);
  });

  it('clears the saved sidebar layout when persistence is turned off', () => {
    localStorage.setItem(
      'sidebar_collapsed_states',
      JSON.stringify(['signals'])
    );
    const preferences = new PreferencesService();

    preferences.setPersistence(false);

    expect(preferences.persistence()).toBe(false);
    expect(localStorage.getItem('sidebar_collapsed_states')).toBeNull();
  });
});
