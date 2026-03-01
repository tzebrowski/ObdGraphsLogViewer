import { signalRegistry } from './signalregistry.js';

class TelemetryAnalyzer {
  constructor() {}

  analyze(file) {
    if (!file || !file.signals) return null;

    const stats = {
      duration: 0,
      distanceKm: 0,
      maxSpeed: 0,
      avgSpeed: 0,
      maxRPM: 0,
      maxBoost: 0,
      maxOilTemp: 0,
      maxCoolantTemp: 0,
      idleTimeSec: 0,
      idlePercentage: 0,
      zeroToSixty: null,
    };

    const signals = file.availableSignals || [];

    const speedName =
      signalRegistry.findSignal('Vehicle Speed', signals) ||
      signalRegistry.findSignal('GPS Speed', signals);

    const rpmName = signalRegistry.findSignal('Engine Speed', signals);

    const boostName =
      signalRegistry.findSignal('Boost', signals) ||
      signalRegistry.findSignal('Intake Manifold Pressure', signals);

    const oilTempName = signalRegistry.findSignal('Oil Temp', signals);
    const coolantTempName = signalRegistry.findSignal(
      'Engine Coolant Temp',
      signals
    );

    const speedSig = speedName ? file.signals[speedName] : null;
    const rpmSig = rpmName ? file.signals[rpmName] : null;
    const boostSig = boostName ? file.signals[boostName] : null;
    const oilTempSig = oilTempName ? file.signals[oilTempName] : null;
    const coolantTempSig = coolantTempName
      ? file.signals[coolantTempName]
      : null;

    if (!speedSig || !speedSig.length) return stats;

    let totalSpeed = 0;
    let validSpeedCount = 0;
    let lastTime = speedSig[0].x;

    let perfTimer = { active: false, startTime: 0 };

    for (let i = 0; i < speedSig.length; i++) {
      const p = speedSig[i];
      const speed = parseFloat(p.y);
      const time = p.x;
      const dt = (time - lastTime) / 1000;

      if (speed > stats.maxSpeed) stats.maxSpeed = speed;
      if (speed > 1) {
        totalSpeed += speed;
        validSpeedCount++;
      }

      let isIdle = false;
      if (speed < 2) {
        if (rpmSig) {
          const rpmVal = this.#getValueAt(rpmSig, time);
          if (rpmVal > 400) isIdle = true;
        } else {
          isIdle = true;
        }
      }

      if (isIdle && dt > 0 && dt < 5) {
        stats.idleTimeSec += dt;
      }

      // Distance Accumulation
      if (i > 0 && dt > 0 && dt < 5) {
        const prevSpeed = parseFloat(speedSig[i - 1].y);
        const avgSegSpeed = (speed + prevSpeed) / 2; // km/h
        const distSegKm = avgSegSpeed * (dt / 3600);
        stats.distanceKm += distSegKm;
      }

      // 0-100 km/h Detection
      if (!perfTimer.active && speed < 1.0) {
        // Ready
      } else if (
        !perfTimer.active &&
        speed > 1.0 &&
        i > 0 &&
        parseFloat(speedSig[i - 1].y) <= 1.0
      ) {
        perfTimer.active = true;
        perfTimer.startTime = time;
      } else if (perfTimer.active) {
        if (speed >= 100) {
          const duration = (time - perfTimer.startTime) / 1000;
          if (stats.zeroToSixty === null || duration < stats.zeroToSixty) {
            stats.zeroToSixty = duration;
          }
          perfTimer.active = false;
        } else if (speed < parseFloat(speedSig[i - 1].y) - 5) {
          perfTimer.active = false; // Aborted run
        }
      }

      lastTime = time;
    }

    if (rpmSig) stats.maxRPM = this.#getMax(rpmSig);

    if (boostSig) {
      let maxB = this.#getMax(boostSig);
      if (maxB > 2000) maxB = maxB / 1000;
      stats.maxBoost = maxB;
    }

    if (oilTempSig) stats.maxOilTemp = this.#getMax(oilTempSig);
    if (coolantTempSig) stats.maxCoolantTemp = this.#getMax(coolantTempSig);

    const totalTimeSec =
      (speedSig[speedSig.length - 1].x - speedSig[0].x) / 1000;
    stats.duration = totalTimeSec;

    if (validSpeedCount > 0) {
      stats.avgSpeed = totalSpeed / validSpeedCount;
    }

    if (stats.duration > 0) {
      stats.idlePercentage = (stats.idleTimeSec / stats.duration) * 100;
    }

    return stats;
  }

  #getMax(data) {
    if (!data || data.length === 0) return 0;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const val = parseFloat(data[i].y);
      if (val > max) max = val;
    }
    return max;
  }

  #getValueAt(signalData, time) {
    const p = signalData.find((p) => p.x >= time);
    return p ? parseFloat(p.y) : 0;
  }
}

export const telemetryAnalyzer = new TelemetryAnalyzer();
