export class AudioAnalyzer {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = 2.5; 
        
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048; 
        this.analyser.smoothingTimeConstant = 0.4; // Reduced for better transient response
        
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        
        this.bands = { bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
        this.level = 0;
        this.centroid = 0;
        
        // Track energy history for onset detection
        this.history = {
            bass: [0, 0, 0],
            lowMid: [0, 0, 0],
            mid: [0, 0, 0]
        };
        
        // Kick detection
        this.kick = {
            detected: false,
            energy: 0,
            threshold: 0.25,
            lastTriggerTime: 0,
            minInterval: 150 // ms between kicks
        };

        // Snare detection
        this.snare = {
            detected: false,
            energy: 0,
            threshold: 0.22,
            lastTriggerTime: 0,
            minInterval: 120, // ms between snares
            kickLockout: 100 // ms after kick before snare can trigger
        };
    }

    async init() {
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const source = this.ctx.createMediaStreamSource(stream);
            source.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            console.log("🔊 Titan Engine V5 (Onset Detection) Initialized");
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
        if (!this.analyser) return;

        this.analyser.getByteFrequencyData(this.dataArray);

        let sumBass = 0, sumLowMid = 0, sumMid = 0, sumHighMid = 0, sumTreble = 0, total = 0;
        let weightedSum = 0;
        
        // Frequency bands (at 44.1kHz, bin width ~21.5Hz)
        // Bass: 0-100Hz (bins 0-5) - kick fundamental
        // LowMid: 100-250Hz (bins 5-12) - kick body/punch
        // Mid: 250-1000Hz (bins 12-47) - snare body
        // HighMid: 1000-4000Hz (bins 47-186) - snare crack/clap brightness
        // Treble: 4000Hz+ - cymbals/air
        
        const bassEnd = 5;
        const lowMidEnd = 12;
        const midEnd = 47;
        const highMidEnd = 186;
        
        for (let i = 0; i < this.bufferLength; i++) {
            const val = this.dataArray[i] / 255.0;
            total += val;
            weightedSum += i * val;

            if (i <= bassEnd) sumBass += val;
            else if (i <= lowMidEnd) sumLowMid += val;
            else if (i <= midEnd) sumMid += val;
            else if (i <= highMidEnd) sumHighMid += val;
            else sumTreble += val;
        }

        // Calculate normalized band levels
        this.bands.bass = sumBass / (bassEnd + 1); 
        this.bands.lowMid = sumLowMid / (lowMidEnd - bassEnd); 
        this.bands.mid = sumMid / (midEnd - lowMidEnd); 
        this.bands.highMid = sumHighMid / (highMidEnd - midEnd);
        this.bands.treble = sumTreble / (this.bufferLength - highMidEnd);
        this.level = total / this.bufferLength;
        this.centroid = total > 0 ? (weightedSum / total) / (this.bufferLength / 2) : 0;

        const now = performance.now();

        // === KICK DETECTION ===
        // Kick signature: strong bass + lowMid, sudden onset, low spectral centroid
        const kickEnergy = (this.bands.bass * 1.5) + this.bands.lowMid; // Weight bass more
        
        // Calculate onset (difference from recent average)
        const kickHistory = this.history.bass;
        const kickAvg = (kickHistory[0] + kickHistory[1] + kickHistory[2]) / 3;
        const kickOnset = Math.max(0, kickEnergy - kickAvg);
        
        this.kick.detected = false;
        let kickTriggered = false;
        
        if (now - this.kick.lastTriggerTime > this.kick.minInterval) {
            // Require: strong onset, high absolute energy, dark sound
            if (kickOnset > 0.15 && 
                kickEnergy > this.kick.threshold &&
                this.centroid < 0.40) {
                
                this.kick.detected = true;
                this.kick.lastTriggerTime = now;
                kickTriggered = true;
            }
        }
        
        // Update history
        kickHistory.shift();
        kickHistory.push(kickEnergy);

        // === SNARE DETECTION ===
        // Snare signature: strong mid + highMid, sudden onset, bright spectral centroid
        const snareEnergy = this.bands.mid + (this.bands.highMid * 1.3); // Weight brightness
        
        // Calculate onset
        const snareHistory = this.history.mid;
        const snareAvg = (snareHistory[0] + snareHistory[1] + snareHistory[2]) / 3;
        const snareOnset = Math.max(0, snareEnergy - snareAvg);
        
        this.snare.detected = false;
        
        // Check both snare interval AND kick lockout
        const timeSinceKick = now - this.kick.lastTriggerTime;
        const timeSinceSnare = now - this.snare.lastTriggerTime;
        
        if (timeSinceSnare > this.snare.minInterval && 
            timeSinceKick > this.snare.kickLockout &&
            !kickTriggered) { // Kick wins if both would trigger
            
            // Require: strong onset, high absolute energy, BRIGHT sound (claps are very bright)
            if (snareOnset > 0.12 && 
                snareEnergy > this.snare.threshold &&
                this.centroid > 0.40 && // Raised from 0.30
                this.centroid < 0.85 &&
                kickEnergy < snareEnergy * 0.8) { // Kick must be relatively quiet
                
                this.snare.detected = true;
                this.snare.lastTriggerTime = now;
            }
        }
        
        // Update history
        snareHistory.shift();
        snareHistory.push(snareEnergy);
    }

    getMetrics() {
        return {
            bass: this.bands.bass,
            mid: this.bands.mid,
            treble: this.bands.treble,
            vol: this.level,
            centroid: this.centroid,
            isKick: this.kick.detected, 
            isSnare: this.snare.detected,
            // Debug info
            kickEnergy: (this.bands.bass * 1.5) + this.bands.lowMid,
            snareEnergy: this.bands.mid + (this.bands.highMid * 1.3)
        };
    }
}