# Optional dataset acquisition and preparation

No dataset audio is downloaded by scripts or committed to Git. Set `AUDIO_VIZ_DATA_DIR` to storage outside the repository. The adapters accept local PCM/IEEE-float WAV (16/24/32-bit, mono or downmixed multichannel) plus text/CSV onset annotations. Manifests sort records, SHA-256-check audio and annotations, and retain only local paths and dataset identifiers in failures.

Suggested layout:

```text
$AUDIO_VIZ_DATA_DIR/
  enst/...
  idmt-smt-drums/...
  onset_db/...
```

Use `buildExternalManifest({ root, adapter: 'enst' | 'idmt' | 'onset_db' })`. Missing roots produce an actionable message and never fail the self-contained synthetic suite.

## Initial corpora

- **ENST-Drums:** obtain from its official research distributor. Do not redistribute its audio from this repository. Preserve performer/session directories because they are split groups.
- **IDMT-SMT-Drums:** obtain through the official Fraunhofer/IDMT distribution and comply with its current terms. Preserve drummer/session or source directories.
- **onset_db-compatible annotations:** annotation and corresponding audio rights can differ. Use annotations only where the matching audio was acquired legally. Unknown instrument labels remain `unclassifiedTransient`: they are valid for onset timing, not low/high class scoring.

License terms and download locations can change; verify them with each official distributor before acquisition. The manifest's `licenseNote` is a reminder, not legal advice or a license grant.

## Split and leakage policy

`grouped-v1` hashes performer/session/source groups with seed `20260117`. Non-synthetic groups map 65% development, 20% validation, and 15% private holdout. Synthetic/adversarial fixtures are forced to the adversarial partition. A group is assigned once, so clips from the same drummer, session, kit, room, or source do not cross partitions when that metadata is represented in `groupId`.

Directory-inferred metadata is imperfect: renamed or flattened datasets can leak performers, kits, backing tracks, room responses, or derived stems. Inspect generated groups before trusting a split. Never split isolated stems and their full mix independently. Keep private-holdout audio and labels outside the repository and optimization environment; run `aggregatePrivateHoldout` inside that environment and release aggregate scores only.

## Later extension points (not scored now)

Adapters and manifests can later cover Ballroom and SMC beat data, Beatles/Isophonics beat/downbeat annotations, and SALAMI section boundaries. Those datasets are neither required nor scored by the initial onset/transient harness. Their licenses, audio availability, recording-family grouping, and task-specific annotation parsers must be reviewed before activation.
