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

        this.previousDataArray = new Uint8Array(this.bufferLength);
        
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
                    //"spectralFlux",     // Onset/Transient detection (The "Change" over time)
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

        // 1. Get Smoothed Data (Legacy)
        this.analyser.getByteFrequencyData(this.dataArray);

        // 2. Manual Flux Calculation
        let flux = 0;
        for (let i = 0; i < this.bufferLength; i++) {
            flux += Math.abs(this.dataArray[i] - this.previousDataArray[i]);
        }
        flux /= this.bufferLength;
        this.previousDataArray.set(this.dataArray);

        // 3. Meyda Features
        const features = this.meydaAnalyzer.get();
        if(!features) return;

        // --- METRICS ---
        
        const m = features.melBands;
        const bassSum = m.slice(0, 4).reduce((a,b)=>a+b, 0) / 4;
        const midSum = m.slice(4, 15).reduce((a,b)=>a+b, 0) / 11;
        const trebleSum = m.slice(15).reduce((a,b)=>a+b, 0) / (m.length - 15);

        this.metrics.bass = Math.min(1, bassSum / 30);
        this.metrics.mid = Math.min(1, midSum / 20);
        this.metrics.treble = Math.min(1, trebleSum / 10);
        this.metrics.vol = features.rms;

        // --- FIX 1: Correct Centroid Normalization ---
        // Meyda (512 buffer) returns bin index 0-256. 
        this.metrics.centroid = Math.min(1, features.spectralCentroid / 256);

        // --- BEAT DETECTION ---
        this.avgFlux = (this.avgFlux * 0.96) + (flux * 0.04);
        
        // --- FIX 2: Lower Threshold Multiplier (1.5 -> 1.2) ---
        // Since our data is smoothed, the "spike" is smaller relative to the average.
        const currentThreshold = Math.max(0.5, this.avgFlux * 1.2);

        this.metrics.isKick = false;
        this.metrics.isSnare = false;
        
        // Using manual 'flux' here
        if (flux > currentThreshold) {
            const now = performance.now();
            
            // KICK: Low Centroid
            if (this.metrics.centroid < 0.35 && (now - this.kick.lastTime > 150)) {
                this.metrics.isKick = true;
                this.kick.lastTime = now;
            }
            // SNARE: High Centroid
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