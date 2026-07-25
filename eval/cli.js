#!/usr/bin/env node
import { baselineDetectors, detectorIds } from './detectors/index.js';
import { generateSyntheticFixtures, SYNTHETIC_MANIFEST_VERSION, SYNTHETIC_SEED } from './synthetic/generator.js';
import { generateSplits } from './datasets/splits.js';
import { evaluateDetector } from './evaluate.js';
import { writeRunArtifacts } from './artifacts.js';

function parseArguments(argv) {
  const options = { suite: 'synthetic', mode: 'fast', detector: null, outputRoot: 'runs', compareModes: true };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--suite') options.suite = argv[++i];
    else if (argument === '--mode') { options.mode = argv[++i]; options.compareModes = false; }
    else if (argument === '--detector') options.detector = argv[++i];
    else if (argument === '--output-dir') options.outputRoot = argv[++i];
    else if (argument === '--compare-modes') options.compareModes = true;
    else if (argument === '--no-compare-modes') options.compareModes = false;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function help() {
  console.log(`audio-viz deterministic DSP evaluation\n\nOptions:\n  --suite smoke|synthetic\n  --mode fast|browser\n  --detector ID\n  --output-dir PATH\n  --[no-]compare-modes\n\nDetectors: ${detectorIds().join(', ')}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return help();
  if (!['smoke', 'synthetic'].includes(options.suite)) throw new Error('Only smoke and synthetic suites require no external corpus');
  const fixtures = generateSyntheticFixtures({ smoke: options.suite === 'smoke' });
  const split = generateSplits(fixtures);
  const ids = options.detector ? [options.detector] : baselineDetectors.map((Detector) => Detector.id);
  const table = [];
  for (const detectorId of ids) {
    const evaluation = await evaluateDetector({ detectorId, fixtures, mode: options.mode, compareModes: options.compareModes });
    const runConfig = {
      detector: evaluation.descriptor,
      suite: options.suite,
      mode: options.mode,
      compareModes: options.compareModes,
      blockSize: 128,
      sampleRates: [44100, 48000],
      datasetManifestVersion: SYNTHETIC_MANIFEST_VERSION,
      splitVersion: split.version,
      splitSeed: split.seed,
      seed: SYNTHETIC_SEED,
      command: `node eval/cli.js ${process.argv.slice(2).join(' ')}`.trim()
    };
    const runDirectory = await writeRunArtifacts({ evaluation, runConfig, outputRoot: options.outputRoot });
    const equivalenceFailures = evaluation.equivalence.filter((item) => !item.equivalent).length;
    table.push({
      detector: detectorId,
      f1_25ms: evaluation.summary.onset25ms.f1.toFixed(3),
      f1_50ms: evaluation.summary.onset50ms.f1.toFixed(3),
      macroClassF1: evaluation.summary.classes.macroF1.toFixed(3),
      falsePositivesPerMinute: evaluation.summary.onset50ms.falsePositivesPerMinute.toFixed(1),
      modeEquivalenceFailures: equivalenceFailures,
      runDirectory
    });
  }
  console.table(table);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
