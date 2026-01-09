import Meyda from 'meyda';

export class AudioAnalyzer {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Main volume control
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = 2.5; 
        
        // Standard Analyser (Kept for 'getRawData' visual compatibility)
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048; 
        this.analyser.smoothingTimeConstant = 0.4;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        
        // Internal State
        this.isInit = false;
        this.meydaAnalyzer = null;
        
        // Adaptive Thresholding State
        this.avgFlux = 0;
        this.fluxThreshold = 0;
        this.avgVol = 0;
        
        // Beat Detection Locks
        this.kick = { detected: false, lastTime: 0 };
        this.snare = { detected: false, lastTime: 0 };
        
        // Output Metrics (The public API)
        this.metrics = {
            bass: 0, mid: 0, treble: 0,
            vol: 0, centroid: 0,
            isKick: false, isSnare: false
        };
    }

    async init() {
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const source = this.ctx.createMediaStreamSource(stream);
            
            // Connect Graph: Source -> Gain -> Analyser -> Destination
            source.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            
            // --- MEYDA SETUP ---
            // We use 512 for faster transient detection, while the main analyser uses 2048 for detailed visuals
            this.meydaAnalyzer = Meyda.createMeydaAnalyzer({
                "audioContext": this.ctx,
                "source": this.gainNode,
                "bufferSize": 512,
                "featureExtractors": [
                    "rms",              // Volume
                    "spectralCentroid", // Brightness (Bass vs Snare discrimination)
                    "spectralFlux",     // Onset/Transient detection (The "Change" over time)
                    "melBands"          // Perceptual Frequency Bands (Better than linear FFT)
                ],
                "callback": (features) => {
                    // Meyda doesn't need a callback here since we pull data in update()
                    // But we can use this for debug if needed.
                }
            });
            this.meydaAnalyzer.start();

            this.isInit = true;
            console.log("🔊 Titan Engine V6 (Meyda Hybrid) Initialized");
        } catch (e) {
            console.error("Mic access denied", e);
        }
    }

    setGain(val) {
        if(this.gainNode) this.gainNode.gain.value = val;
    }

    // Used by JoyViz, CrystalViz for drawing raw lines
    getRawData() {
        return this.dataArray;
    }

    update() {
        if (!this.isInit || !this.meydaAnalyzer) return;

        // 1. Legacy Data (for visualizers that draw lines)
        this.analyser.getByteFrequencyData(this.dataArray);

        // 2. Get SOTA Features from Meyda
        const features = this.meydaAnalyzer.get();
        if(!features) return;

        const now = performance.now();

        // --- ENHANCEMENT 1: MEL BANDS ---
        // Meyda gives us ~24-40 bands tailored to human hearing.
        // We aggregate them into 3 simple groups for the visualizer.
        // Mel Bands are usually 0-40. We assume 40 bands here.
        
        const m = features.melBands;
        // Bass: Bottom 20% of bands (Sub & Punch)
        const bassSum = m.slice(0, 4).reduce((a,b)=>a+b, 0) / 4;
        // Mid: Next 30% (Vocals/Snare)
        const midSum = m.slice(4, 15).reduce((a,b)=>a+b, 0) / 11;
        // Treble: Top 50% (Hats/Air)
        const trebleSum = m.slice(15).reduce((a,b)=>a+b, 0) / (m.length - 15);

        // Normalize (Mel bands can be unbounded, but usually 0-50 range)
        // We dampen them slightly to fit 0-1 range better
        this.metrics.bass = Math.min(1, bassSum / 30);
        this.metrics.mid = Math.min(1, midSum / 20);
        this.metrics.treble = Math.min(1, trebleSum / 10);
        
        this.metrics.vol = features.rms;
        // Normalize centroid (Nyquist is ~22050Hz). 
        // 0.0 - 0.2 = Bass heavy
        // 0.2 - 0.5 = Balanced
        // 0.5+ = High frequency noise
        this.metrics.centroid = Math.min(1, features.spectralCentroid / 100);

        // --- ENHANCEMENT 2 & 3: ADAPTIVE FLUX THRESHOLD ---
        // Spectral Flux measures "How much did the spectrum change?"
        // We compare current Flux to the Running Average Flux.
        
        // 1. Update Average (Slow learning)
        this.avgFlux = (this.avgFlux * 0.96) + (features.spectralFlux * 0.04);
        this.avgVol = (this.avgVol * 0.99) + (features.rms * 0.01);

        // 2. Calculate Dynamic Threshold
        // If the song is quiet, threshold drops. If chaotic, it rises.
        // Multiplier 1.5 means "50% more change than average"
        const currentThreshold = Math.max(0.5, this.avgFlux * 1.5);

        this.metrics.isKick = false;
        this.metrics.isSnare = false;

        // 3. Trigger Logic
        if (features.spectralFlux > currentThreshold) {
            
            // Discrimination Logic: KICK vs SNARE
            // Low Centroid = Kick. High Centroid = Snare.
            
            // KICK CHECK
            if (this.metrics.centroid < 0.35 && (now - this.kick.lastTime > 150)) {
                this.metrics.isKick = true;
                this.kick.lastTime = now;
            }
            
            // SNARE CHECK
            // Snares are brighter (higher centroid) and often have less sub-bass
            else if (this.metrics.centroid > 0.35 && (now - this.snare.lastTime > 100)) {
                this.metrics.isSnare = true;
                this.snare.lastTime = now;
            }
        }
    }

    getMetrics() {
        return this.metrics;
    }
}