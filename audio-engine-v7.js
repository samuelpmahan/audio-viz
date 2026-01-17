import Meyda from 'meyda';

export class AudioAnalyzer {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Main volume control
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = 2.5; 
        
        // Standard Analyser (for visual compatibility)
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048; 
        this.analyser.smoothingTimeConstant = 0.4;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        this.previousDataArray = new Uint8Array(this.bufferLength); // For manual flux calculation
        
        // Internal State
        this.isInit = false;
        this.meydaAnalyzer = null;
        this.lastUpdateTime = performance.now();
        
        // ======== ADAPTIVE NORMALIZATION ========
        // Instead of fixed magic numbers, track peaks for auto-scaling
        this.peaks = {
            bass: 1.0,
            mid: 1.0,
            treble: 1.0
        };
        
        // ======== ADAPTIVE THRESHOLDING ========
        this.avgFlux = 0;
        this.avgVol = 0;
        
        // ======== LEGACY BEAT DETECTION ========
        // Keeping your original kick/snare for backwards compatibility
        this.kick = { detected: false, lastTime: 0 };
        this.snare = { detected: false, lastTime: 0 };
        
        // ======== MULTI-BAND HIT DETECTION ========
        this.hits = {
            bass: { 
                detected: false, 
                lastTime: 0, 
                avgEnergy: 0, 
                prevEnergy: 0,
                value: 0  // Decaying 0-1 value for smooth animations
            },
            mid: { 
                detected: false, 
                lastTime: 0, 
                avgEnergy: 0, 
                prevEnergy: 0,
                value: 0 
            },
            high: { 
                detected: false, 
                lastTime: 0, 
                avgEnergy: 0, 
                prevEnergy: 0,
                value: 0 
            }
        };
        
        // ======== PRESENCE TRACKING ========
        // Long-term average (3-5 second window)
        this.presence = {
            bass: 0,
            mid: 0,
            high: 0
        };
        
        // ======== TIME TRACKING ========
        // Milliseconds since last significant event
        this.timers = {
            bass: 0,
            mid: 0,
            high: 0
        };
        
        // ======== BEAT TRACKING ========
        this.beatTracking = {
            bpm: 0,
            confidence: 0,
            beatPhase: 0,
            lastBeatTime: 0,
            beatInterval: 500, // ms between beats (120 BPM default)
            beatHistory: [], // Recent beat timestamps
            onBeat: 0 // 0-1 confidence we're "on beat" right now
        };
        
        // ======== LFOs (Synthetic Oscillators) ========
        this.lfoPhases = {
            lfo2: 0,  // 2 beats per cycle
            lfo4: 0,  // 4 beats per cycle (1 bar at 4/4)
            lfo8: 0   // 8 beats per cycle (2 bars)
        };
        
        // ======== RAMPS (Sawtooth Oscillators) ========
        this.rampPhases = {
            ramp2: 0,
            ramp4: 0,
            ramp8: 0
        };
        
        // ======== PUBLIC METRICS ========
        // This is what visualizers consume
        this.metrics = {
            // Frequency bands (instantaneous)
            bass: 0, 
            mid: 0, 
            treble: 0,
            
            // Overall metrics
            vol: 0, 
            centroid: 0,
            
            // Legacy beat detection (kept for compatibility)
            isKick: false, 
            isSnare: false,
            
            // Multi-band hits (NEW)
            bassHit: 0,    // 0-1, decays after hit
            midHit: 0,
            highHit: 0,
            
            // Presence (long-term average) (NEW)
            bassPresence: 0,
            midPresence: 0,
            highPresence: 0,
            
            // Time since last event (NEW)
            bassTime: 0,   // milliseconds
            midTime: 0,
            highTime: 0,
            
            // Beat tracking (NEW)
            bpm: 0,
            onBeat: 0,     // 0-1 confidence
            beatPhase: 0,  // 0-1 position in beat cycle
            
            // LFOs (NEW)
            lfo2: 0,       // 0-1 sine wave
            lfo4: 0,
            lfo8: 0,
            
            // Ramps (NEW)
            ramp2: 0,      // 0-1 sawtooth
            ramp4: 0,
            ramp8: 0
        };
    }

    async init() {
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const source = this.ctx.createMediaStreamSource(stream);
            
            // Connect Graph: Source -> Gain -> Analyser
            source.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            
            // --- MEYDA SETUP ---
            this.meydaAnalyzer = Meyda.createMeydaAnalyzer({
                "audioContext": this.ctx,
                "source": this.gainNode,
                "bufferSize": 512,
                "featureExtractors": ["rms", "spectralCentroid", "melBands"]
                // No callback needed - we pull data with .get()
            });
            this.meydaAnalyzer.start();

            this.isInit = true;
            this.lastUpdateTime = performance.now();
            console.log("🔊 Titan Engine V7 (Full Metrics Suite) Initialized");
        } catch (e) {
            console.error("Mic access denied", e);
        }
    }

    setGain(val) {
        if(this.gainNode) this.gainNode.gain.value = val;
    }

    getRawData() {
        return this.dataArray;
    }

    update() {
        if (!this.isInit || !this.meydaAnalyzer) return;

        const now = performance.now();
        const deltaTime = now - this.lastUpdateTime;
        this.lastUpdateTime = now;

        // 1. Legacy FFT data for visualizers
        this.analyser.getByteFrequencyData(this.dataArray);

        // 2. Manual Flux Calculation (Meyda's spectralFlux is buggy)
        let flux = 0;
        for (let i = 0; i < this.bufferLength; i++) {
            flux += Math.abs(this.dataArray[i] - this.previousDataArray[i]);
        }
        flux /= this.bufferLength;
        this.previousDataArray.set(this.dataArray);

        // 3. Get Meyda features
        const features = this.meydaAnalyzer.get();
        if (!features || !features.melBands) return;

        // ========================================
        // FREQUENCY BAND EXTRACTION (Improved)
        // ========================================
        const m = features.melBands;
        const numBands = m.length;
        
        // Dynamic slicing based on actual band count
        const bassEnd = Math.floor(numBands * 0.2);    // Bottom 20%
        const midEnd = Math.floor(numBands * 0.5);     // Next 30%
        
        const bassSum = m.slice(0, bassEnd).reduce((a,b) => a+b, 0) / bassEnd;
        const midSum = m.slice(bassEnd, midEnd).reduce((a,b) => a+b, 0) / (midEnd - bassEnd);
        const trebleSum = m.slice(midEnd).reduce((a,b) => a+b, 0) / (numBands - midEnd);
        
        // Adaptive normalization with peak tracking
        this.peaks.bass = Math.max(this.peaks.bass * 0.999, bassSum);
        this.peaks.mid = Math.max(this.peaks.mid * 0.999, midSum);
        this.peaks.treble = Math.max(this.peaks.treble * 0.999, trebleSum);
        
        this.metrics.bass = Math.min(1, bassSum / Math.max(0.1, this.peaks.bass * 0.8));
        this.metrics.mid = Math.min(1, midSum / Math.max(0.1, this.peaks.mid * 0.8));
        this.metrics.treble = Math.min(1, trebleSum / Math.max(0.1, this.peaks.treble * 0.8));
        
        // Volume
        this.metrics.vol = features.rms;
        
        // Centroid (FIXED: proper normalization to Nyquist frequency)
        const nyquist = this.ctx.sampleRate / 2;
        this.metrics.centroid = Math.min(1, features.spectralCentroid / nyquist);

        // ========================================
        // ADAPTIVE FLUX THRESHOLD
        // ========================================
        this.avgFlux = (this.avgFlux * 0.96) + (flux * 0.04);
        this.avgVol = (this.avgVol * 0.99) + (features.rms * 0.01);
        const fluxThreshold = Math.max(0.5, this.avgFlux * 1.2); // Using 1.2 for smoothed data

        // ========================================
        // LEGACY KICK/SNARE DETECTION
        // ========================================
        this.metrics.isKick = false;
        this.metrics.isSnare = false;

        if (flux > fluxThreshold) {
            const hasBassEnergy = this.metrics.bass > 0.3;
            
            // KICK: Low centroid + bass energy
            if (this.metrics.centroid < 0.35 && hasBassEnergy && (now - this.kick.lastTime > 150)) {
                this.metrics.isKick = true;
                this.kick.lastTime = now;
            }
            
            // SNARE: High centroid
            else if (this.metrics.centroid > 0.35 && (now - this.snare.lastTime > 100)) {
                this.metrics.isSnare = true;
                this.snare.lastTime = now;
            }
        }

        // ========================================
        // MULTI-BAND HIT DETECTION
        // ========================================
        const bands = [
            { name: 'bass', energy: this.metrics.bass, cooldown: 120 },
            { name: 'mid', energy: this.metrics.mid, cooldown: 100 },
            { name: 'high', energy: this.metrics.treble, cooldown: 80 }
        ];

        bands.forEach(({ name, energy, cooldown }) => {
            const hit = this.hits[name];
            
            // Update running average
            hit.avgEnergy = (hit.avgEnergy * 0.95) + (energy * 0.05);
            
            // Calculate delta (how much energy increased)
            const delta = energy - hit.prevEnergy;
            hit.prevEnergy = energy;
            
            // Dynamic threshold based on average
            const threshold = Math.max(0.1, hit.avgEnergy * 0.5);
            
            // Detect transient
            const isTransient = delta > threshold;
            const cooledDown = (now - hit.lastTime > cooldown);
            
            if (isTransient && cooledDown && energy > 0.2) {
                hit.detected = true;
                hit.lastTime = now;
                hit.value = 1.0;
                
                // Reset timer
                this.timers[name] = 0;
            } else {
                hit.detected = false;
            }
            
            // Decay hit value for smooth animations
            hit.value *= 0.85;
            
            // Expose to metrics
            this.metrics[`${name}Hit`] = hit.value;
        });

        // ========================================
        // PRESENCE TRACKING (Long-term average)
        // ========================================
        const presenceSmoothing = 0.98; // Very slow (3-5 second window)
        this.presence.bass = (this.presence.bass * presenceSmoothing) + (this.metrics.bass * (1 - presenceSmoothing));
        this.presence.mid = (this.presence.mid * presenceSmoothing) + (this.metrics.mid * (1 - presenceSmoothing));
        this.presence.high = (this.presence.high * presenceSmoothing) + (this.metrics.treble * (1 - presenceSmoothing));
        
        this.metrics.bassPresence = this.presence.bass;
        this.metrics.midPresence = this.presence.mid;
        this.metrics.highPresence = this.presence.high;

        // ========================================
        // TIME TRACKING
        // ========================================
        this.timers.bass += deltaTime;
        this.timers.mid += deltaTime;
        this.timers.high += deltaTime;
        
        this.metrics.bassTime = this.timers.bass;
        this.metrics.midTime = this.timers.mid;
        this.metrics.highTime = this.timers.high;

        // ========================================
        // BEAT TRACKING (Simple Implementation)
        // ========================================
        this.updateBeatTracking(now, this.metrics.bass, this.metrics.bassHit);

        // ========================================
        // LFOs (Synthetic Oscillators)
        // ========================================
        this.updateLFOs(deltaTime);

        // ========================================
        // RAMPS (Sawtooth Oscillators)
        // ========================================
        this.updateRamps(deltaTime);
    }

    updateBeatTracking(now, bassEnergy, bassHit) {
        const bt = this.beatTracking;
        
        // Detect potential beats (bass transients)
        if (bassHit > 0.8) {
            const timeSinceLastBeat = now - bt.lastBeatTime;
            
            // Filter out double-triggers (too close together)
            if (timeSinceLastBeat > 200) {
                bt.beatHistory.push(now);
                bt.lastBeatTime = now;
                
                // Keep only recent history (last 8 beats)
                if (bt.beatHistory.length > 8) {
                    bt.beatHistory.shift();
                }
                
                // Calculate BPM from recent intervals
                if (bt.beatHistory.length >= 4) {
                    const intervals = [];
                    for (let i = 1; i < bt.beatHistory.length; i++) {
                        intervals.push(bt.beatHistory[i] - bt.beatHistory[i-1]);
                    }
                    
                    // Average interval
                    const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
                    bt.beatInterval = avgInterval;
                    
                    // Calculate BPM
                    bt.bpm = Math.round(60000 / avgInterval);
                    
                    // Confidence based on consistency
                    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
                    const stdDev = Math.sqrt(variance);
                    bt.confidence = Math.max(0, 1 - (stdDev / avgInterval));
                }
            }
        }
        
        // Calculate beat phase (0-1 position in beat cycle)
        if (bt.beatInterval > 0) {
            const timeSinceLastBeat = now - bt.lastBeatTime;
            bt.beatPhase = (timeSinceLastBeat % bt.beatInterval) / bt.beatInterval;
            
            // OnBeat confidence (peaks at 0 and 1, dips at 0.5)
            // Uses cosine wave centered at beat points
            bt.onBeat = Math.pow(Math.cos(bt.beatPhase * Math.PI * 2), 2);
        }
        
        // Expose to metrics
        this.metrics.bpm = bt.bpm;
        this.metrics.onBeat = bt.onBeat * bt.confidence;
        this.metrics.beatPhase = bt.beatPhase;
    }

    updateLFOs(deltaTime) {
        const bt = this.beatTracking;
        const bpm = bt.bpm > 0 ? bt.bpm : 120; // Default 120 BPM
        const beatsPerSecond = bpm / 60;
        const deltaSeconds = deltaTime / 1000;
        
        // LFO 2: Half tempo (2 beats per cycle)
        this.lfoPhases.lfo2 += (beatsPerSecond / 2) * deltaSeconds * Math.PI * 2;
        this.metrics.lfo2 = (Math.sin(this.lfoPhases.lfo2) + 1) / 2;
        
        // LFO 4: Bar length (4 beats per cycle)
        this.lfoPhases.lfo4 += (beatsPerSecond / 4) * deltaSeconds * Math.PI * 2;
        this.metrics.lfo4 = (Math.sin(this.lfoPhases.lfo4) + 1) / 2;
        
        // LFO 8: Two bars (8 beats per cycle)
        this.lfoPhases.lfo8 += (beatsPerSecond / 8) * deltaSeconds * Math.PI * 2;
        this.metrics.lfo8 = (Math.sin(this.lfoPhases.lfo8) + 1) / 2;
    }

    updateRamps(deltaTime) {
        const bt = this.beatTracking;
        const bpm = bt.bpm > 0 ? bt.bpm : 120;
        const beatsPerSecond = bpm / 60;
        const deltaSeconds = deltaTime / 1000;
        
        // Ramp 2: Sawtooth at 2 beats per cycle
        this.rampPhases.ramp2 = (this.rampPhases.ramp2 + (beatsPerSecond / 2) * deltaSeconds) % 1.0;
        this.metrics.ramp2 = this.rampPhases.ramp2;
        
        // Ramp 4: Sawtooth at 4 beats per cycle
        this.rampPhases.ramp4 = (this.rampPhases.ramp4 + (beatsPerSecond / 4) * deltaSeconds) % 1.0;
        this.metrics.ramp4 = this.rampPhases.ramp4;
        
        // Ramp 8: Sawtooth at 8 beats per cycle
        this.rampPhases.ramp8 = (this.rampPhases.ramp8 + (beatsPerSecond / 8) * deltaSeconds) % 1.0;
        this.metrics.ramp8 = this.rampPhases.ramp8;
    }

    getMetrics() {
        return this.metrics;
    }
}