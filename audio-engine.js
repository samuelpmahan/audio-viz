export class AudioAnalyzer {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 1. Create a Pre-Amp (Gain Node)
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = 2.5; // Default 2.5x boost
        
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048; 
        this.analyser.smoothingTimeConstant = 0.8;

        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        
        this.bands = { bass: 0, mid: 0, treble: 0 };
        this.level = 0;
        this.centroid = 0;
        this.isBeat = false; 
        
        this.beatThreshold = 1.3; 
        this.beatDecay = 0.96; // Faster decay to catch fast kicks
        this.currentThreshold = 0;
    }

    async init() {
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const source = this.ctx.createMediaStreamSource(stream);
            
            // 2. Connect Source -> Gain -> Analyzer
            source.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            
            console.log("🔊 Audio Engine Initialized (Gain: 2.5x)");
        } catch (e) {
            console.error("Mic access denied", e);
        }
    }

    setGain(val) {
        if(this.gainNode) this.gainNode.gain.value = val;
    }

    update() {
        if (!this.analyser) return;

        this.analyser.getByteFrequencyData(this.dataArray);

        let sumBass = 0, sumMid = 0, sumTreble = 0, total = 0;
        let weightedSum = 0; 

        // 3. Widen Bass Range slightly (up to ~250Hz) to catch "punchy" kicks
        // Bin width is ~21Hz. 12 bins ~= 250Hz
        const bassBins = 12; 

        for (let i = 0; i < this.bufferLength; i++) {
            const val = this.dataArray[i] / 255.0;
            total += val;
            weightedSum += i * val;

            if (i < bassBins) sumBass += val;
            else if (i < 90) sumMid += val;
            else sumTreble += val;
        }

        this.bands.bass = sumBass / bassBins; 
        this.bands.mid = sumMid / (90 - bassBins); 
        this.bands.treble = sumTreble / (this.bufferLength - 90);
        this.level = total / this.bufferLength;
        this.centroid = total > 0 ? (weightedSum / total) / (this.bufferLength / 2) : 0;

        // 4. Improved Beat Logic
        // Lowered floor from 0.3 to 0.15
        // Added dynamic thresholding
        if (this.bands.bass > this.currentThreshold && this.bands.bass > 0.15) {
            this.isBeat = true;
            this.currentThreshold = this.bands.bass * 1.5; 
        } else {
            this.isBeat = false;
            this.currentThreshold *= this.beatDecay; 
            if (this.currentThreshold < 0.15) this.currentThreshold = 0.15;
        }
    }

    getMetrics() {
        return {
            bass: this.bands.bass,
            mid: this.bands.mid,
            treble: this.bands.treble,
            vol: this.level,
            centroid: this.centroid,
            hit: this.isBeat
        };
    }

    getRawData() {
        return this.dataArray;
    }
}