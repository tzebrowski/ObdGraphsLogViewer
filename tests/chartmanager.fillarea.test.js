import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { ChartManager, Sliders } from '../src/chartmanager.js';
import { AppState, DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { PaletteManager } from '../src/palettemanager.js';
import { Chart } from 'chart.js';
import { Preferences } from '../src/preferences.js';

UI.updateDataLoadedState = jest.fn();
UI.renderSignalList = jest.fn();
PaletteManager.getColorForSignal = jest.fn(() => '#ff0000');

Chart.register = jest.fn();
const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  zoom: jest.fn(),
  pan: jest.fn(),
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {} },
    scales: { x: { min: 0, max: 0 } },
  },
};

describe('ChartManager.updateAreaFills', () => {
  let mockChart;

  beforeEach(() => {
    // Reset mocks and state before each test
    jest.clearAllMocks();
    
    mockChart = {
      data: {
        datasets: [
          {
            label: 'Signal A',
            borderColor: '#ff0000', // Red
            fill: false,
            backgroundColor: 'transparent'
          }
        ]
      },
      update: jest.fn()
    };

    AppState.chartInstances = [mockChart];
    
    // Mock the helper method to return a predictable string
    ChartManager.getAlphaColor = jest.fn((hex, alpha) => `rgba_mock(${hex}, ${alpha})`);
  });

  test('should apply semi-transparent fills when showAreaFills is true', () => {
    // 1. Setup State
    Preferences.prefs = { showAreaFills: true };

    // 2. Execute
    ChartManager.updateAreaFills();

    // 3. Assertions
    const dataset = mockChart.data.datasets[0];
    
    // Check if fill is enabled
    expect(dataset.fill).toBe('origin');
    
    // Check if background color uses the alpha helper
    expect(dataset.backgroundColor).toBe('rgba_mock(#ff0000, 0.1)');
    
    // Verify the chart was refreshed
    expect(mockChart.update).toHaveBeenCalledWith('none');
  });

  test('should remove fills and set background to transparent when showAreaFills is false', () => {
    // 1. Setup State (starting with a fill already present)
    Preferences.prefs = { showAreaFills: false };
    mockChart.data.datasets[0].fill = 'origin';
    mockChart.data.datasets[0].backgroundColor = 'rgba(255, 0, 0, 0.1)';

    // 2. Execute
    ChartManager.updateAreaFills();

    // 3. Assertions
    const dataset = mockChart.data.datasets[0];
    
    // Check if fill is disabled
    expect(dataset.fill).toBe(false);
    
    // Check if background is reset
    expect(dataset.backgroundColor).toBe('transparent');
    
    // Verify refresh
    expect(mockChart.update).toHaveBeenCalledWith('none');
  });
});