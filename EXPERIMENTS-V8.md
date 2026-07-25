# V8 Experiment Log

Dataset: committed `synthetic-v1` development/adversarial fixtures at 44.1 and 48 kHz. No fixture or fixed baseline/reference metric was changed. Node browser mode means 128-sample blocks plus structured clone and is directional, not a browser claim.

| Candidate/configuration | Failure pattern | Change/result | Decision |
|---|---|---|---|
| Existing V7-shaped quantized flux | Many false triggers and cadence-dependent state | Control: F1@50 0.499, 106.7 FP/min | retain unchanged control |
| Half-wave global flux, 512/128 | Strong onset timing, cannot represent simultaneous classes; 55 ms refractory missed close pairs | 30 ms refractory retained at F1 0.700, 49.7 FP/min | retain as low-latency personality |
| Multiband relative flux, initial ungated | Tiny relative changes in near-empty bands caused steady-tone and tail triggers | Added global-novelty and absolute band-energy guards; F1 0.852, 16.0 FP/min | retain; strongest onset balance |
| Multiband simultaneous interpretation | Some extra cross-band events, but useful compound visual accents and actual dual events | Macro class F1 0.699; simultaneous remains optional | retain as expressive alternative |
| Robust median/MAD, initial | Median history stayed near zero after isolated spikes, causing tail retriggers | Added hysteresis, 140 ms refractory, and decaying peak-envelope threshold floor; F1 0.776, class F1 0.772 | retain; best conservative semantic balance |
| Robust classifier=`simultaneous` | Cross-band leakage reduced precision | Default robust interpretation changed to `band-dominance`; simultaneous remains selectable | reject as robust default |
| Multiband 512/128 | Faster Node browser-mode mean (0.241 ms/128 at 48 kHz), but F1 fell to 0.724 and FP/min rose to 53.7 | Restored 1024/256 | reject |
| Robust 512/128 | Faster, but F1 fell to 0.541 and FP/min rose to 105.1 | Restored 1024/256 | reject |
| Complex/phase-aware onset | Added state and trigonometric cost without a diagnosed failure that magnitude flux did not address; no implementation benchmark justified retention | Omitted from runtime and registry | reject before retention |
| `v7-peak` normalization | Fast attack/recovery, visibly peak-dependent; level-step steady variation 0.156 | kept for compatibility | retain switch |
| `fast-slow-envelope` | Lower level-step variation (0.086) with 23.3 ms recovery | selected default | retain |
| `robust-percentile` | Very stable quiet tail (variation 0.002), but 242 ms recovery after loud-to-quiet step | useful slow/stable visual personality | retain alternative |
| normalization `off` | Honest raw movement, lower range and slower fixture attack measure | useful diagnostic/minimal path | retain switch |
| interval mean / median / tempo candidates / phase follower | Mean is sensitive to outliers; candidate switching can cause phase instability | confidence decay, bounded hypothesis changes, circular phase correction, and no implicit 120 BPM except V7 compatibility | retain all comparison modes |

Subjective listening was not performed in this automated environment. Visual personality notes above are engineering expectations from envelope/event behavior, not listening claims.
