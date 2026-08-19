/**
 * Shared obfuscation config for scripts/obfuscate.js, mirroring
 * tuning-tools/webapp/scripts/obfuscator-config.js (the hextune app) so both
 * apps in the product line obfuscate their production bundle the same way.
 */

export const LICENSE_BANNER = `/*!
 * My Giulia Telemetry Analyzer -- browser-based OBD2 log viewer
 * Copyright (C) Tomek Zebrowski
 * Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
 * You are entitled to the complete corresponding source code of this
 * program, including any modifications. See the LICENSE file shipped
 * alongside this build, or https://github.com/tzebrowski/ObdGraphsLogViewer
 */
`;

// deadCodeInjection and controlFlowFlattening are deliberately left off -- on
// hextune's real production bundle they measured ~7x and >5x gzipped-size
// blowups respectively, a bad trade for a "load instantly in your browser"
// tool (see tuning-tools/webapp/scripts/obfuscator-config.js). The transforms
// below still hide every string literal and identifier name, at a much
// smaller size cost.
export const OBFUSCATOR_OPTIONS = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  target: 'browser',
};
