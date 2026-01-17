import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';

export class ParticleTunnel2 {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.002);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 100;

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = 1.2; 
        this.bloomPass.radius = 0.2;   
        this.bloomPass.threshold = 0.1;  
        this.composer.addPass(this.bloomPass);

        this.rgbShiftPass = new ShaderPass(RGBShiftShader);
        this.rgbShiftPass.uniforms['amount'].value = 0.002; 
        this.composer.addPass(this.rgbShiftPass);

        // --- STATE (ENHANCED) ---
        this.time = 0;
        
        // Multi-band impulses (replacing single kick/snare)
        this.bassImpulse = 0;
        this.midImpulse = 0;
        this.highImpulse = 0;
        
        // Anticipation tracking (bigger reactions after silence)
        this.lastBassTime = 0;
        this.anticipationMultiplier = 1.0;
        
        // Genre detection state
        this.genreMode = 'neutral'; // 'electronic', 'ambient', 'neutral'
        this.genreCheckTimer = 0;

        // --- PARTICLES ---
        this.particles = null;
        this.count = 2500; 
        this.velocities = []; 
        this.initParticles();

        // --- RINGS ---
        this.rings = [];
        this.initRings();

        window.addEventListener('resize', () => this.resize());
    }

    initParticles() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const color = new THREE.Color();

        for (let i = 0; i < this.count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 40 + Math.random() * 50; 
            const z = (Math.random() * 2000) - 1000;

            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            positions.push(x, y, z);

            // Gradient: Blue -> Pink
            const hue = 0.55 + (Math.random() * 0.35); 
            color.setHSL(hue, 1.0, 0.6);
            colors.push(color.r, color.g, color.b);

            this.velocities.push({
                vx: (Math.random() - 0.5) * 0.2,
                vy: (Math.random() - 0.5) * 0.2,
                phase: Math.random() * Math.PI * 2
            });
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 2.0,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 0.9
        });

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false; 
        this.scene.add(this.particles);
    }

    initRings() {
        for (let i = 0; i < 5; i++) {
            const geometry = new THREE.TorusGeometry(60, 0.4, 8, 100); 
            const material = new THREE.MeshBasicMaterial({
                color: 0x4444ff,
                transparent: true,
                opacity: 0.6, 
                blending: THREE.AdditiveBlending
            });
            const ring = new THREE.Mesh(geometry, material);
            ring.position.z = this.camera.position.z - 200 - (i * 300);
            this.rings.push(ring);
            this.scene.add(ring);
        }
    }

    detectGenre(metrics) {
        // Check genre every 2 seconds
        this.genreCheckTimer += 0.016; // ~60fps
        if (this.genreCheckTimer < 2.0) return;
        this.genreCheckTimer = 0;

        // ELECTRONIC: Heavy bass, fast BPM, consistent rhythm
        if (metrics.bassPresence > 0.7 && metrics.bpm > 120 && metrics.bpm < 180) {
            this.genreMode = 'electronic';
        }
        // AMBIENT: Low bass, high treble, slow or no BPM
        else if (metrics.highPresence > 0.6 && metrics.bassPresence < 0.3 && metrics.bpm < 100) {
            this.genreMode = 'ambient';
        }
        // NEUTRAL: Everything else
        else {
            this.genreMode = 'neutral';
        }
    }

    animate(metrics) {
        this.time += 0.01;

        // ========================================
        // GENRE DETECTION
        // ========================================
        this.detectGenre(metrics);

        // ========================================
        // MULTI-BAND IMPULSE TRACKING
        // ========================================
        // Decay existing impulses
        this.bassImpulse *= 0.90; 
        this.midImpulse *= 0.92;
        this.highImpulse *= 0.94;

        // Update from new hits
        if (metrics.bassHit > 0.8) {
            // ANTICIPATION: Bigger reaction after silence
            this.anticipationMultiplier = 1.0 + Math.min(2.0, metrics.bassTime / 2000);
            this.bassImpulse = 1.0 * this.anticipationMultiplier;
        }
        
        if (metrics.midHit > 0.8) {
            this.midImpulse = 1.0;
        }
        
        if (metrics.highHit > 0.8) {
            this.highImpulse = 1.0;
        }

        // ========================================
        // ADAPTIVE FOG (Based on Bass Presence)
        // ========================================
        // Heavy bass = thicker fog (more mysterious)
        const targetFogDensity = 0.001 + (metrics.bassPresence * 0.002);
        this.scene.fog.density += (targetFogDensity - this.scene.fog.density) * 0.1;

        // ========================================
        // MOVEMENT
        // ========================================
        
        // Rotation: Genre-dependent style
        let rotationSpeed = 0.02;
        
        if (this.genreMode === 'electronic') {
            // Sharp, aggressive rotation
            rotationSpeed = 0.03 + (this.bassImpulse * 0.1);
        } else if (this.genreMode === 'ambient') {
            // Smooth, LFO-driven rotation
            rotationSpeed = 0.01 + (metrics.lfo8 * 0.02);
        }
        
        this.particles.rotation.z -= rotationSpeed;

        // Speed: Volume-based with genre modulation
        let baseSpeed = 2 + (metrics.vol * 10);
        
        if (this.genreMode === 'electronic') {
            // Punchy, hit-driven speed boosts
            baseSpeed += this.bassImpulse * 15;
        } else if (this.genreMode === 'ambient') {
            // Gentle, flowing speed
            baseSpeed = 1 + (metrics.vol * 5) + (metrics.lfo4 * 2);
        }
        
        const speed = baseSpeed;
        this.camera.position.z -= speed;

        // ========================================
        // PARTICLE LOGIC
        // ========================================
        const positions = this.particles.geometry.attributes.position.array;
        const colors = this.particles.geometry.attributes.color.array;
        const color = new THREE.Color();
        
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const v = this.velocities[i];

            // Movement
            positions[i3] += v.vx;
            positions[i3+1] += v.vy;

            // Infinite Loop (Guard 30)
            if (positions[i3 + 2] > this.camera.position.z - 30) {
                positions[i3 + 2] = this.camera.position.z - 1000 - (Math.random() * 500);
                
                const angle = Math.random() * Math.PI * 2;
                const radius = 40 + Math.random() * 50; 
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = Math.sin(angle) * radius; 
            }

            // ========================================
            // COLOR REACTIVITY (Multi-band + Genre)
            // ========================================
            let hue, sat, light;
            
            if (this.genreMode === 'electronic') {
                // Electronic: Sharp color shifts on hits
                if (this.bassImpulse > 0.5) {
                    hue = 0.95; // Deep red on bass
                    sat = 1.0;
                    light = 0.5 + (this.bassImpulse * 0.3);
                } else if (this.midImpulse > 0.5) {
                    hue = 0.15; // Orange on mid
                    sat = 1.0;
                    light = 0.6;
                } else {
                    hue = 0.55 + (metrics.centroid * 0.15); // Blue baseline
                    sat = 0.8;
                    light = 0.5;
                }
            } else if (this.genreMode === 'ambient') {
                // Ambient: Smooth LFO-driven color shifts
                hue = 0.5 + (metrics.lfo8 * 0.3); // Cyan to purple
                sat = 0.6 + (metrics.highPresence * 0.3);
                light = 0.4 + (metrics.ramp4 * 0.3);
            } else {
                // Neutral: Original behavior with mid-hit accents
                hue = 0.55 + (metrics.centroid * 0.35);
                sat = 0.8 + (this.midImpulse * 0.2);
                light = 0.5 + (this.bassImpulse * 0.2);
            }
            
            color.setHSL(hue, sat, light);
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }
        
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;

        // ========================================
        // PARTICLE SIZE (Mid-hit reactive)
        // ========================================
        this.particles.material.size = 2.0 + (this.midImpulse * 2.0);

        // ========================================
        // RINGS
        // ========================================
        this.rings.forEach((ring, i) => {
            ring.position.z += speed;
            
            if (ring.position.z > this.camera.position.z) {
                ring.position.z = this.camera.position.z - 1500;
            }
            
            // Size pulse on bass
            const scale = 1.0 + (this.bassImpulse * 0.3);
            ring.scale.set(scale, scale, 1);
            
            // Color shift on mid hits
            let ringHue;
            if (this.genreMode === 'electronic') {
                ringHue = 0.6 + (this.midImpulse * 0.4); // Blue to magenta
            } else if (this.genreMode === 'ambient') {
                ringHue = 0.5 + (metrics.lfo4 * 0.2); // Gentle cyan shifts
            } else {
                ringHue = 0.6 + (this.midImpulse * 0.3);
            }
            
            ring.material.color.setHSL(ringHue, 1.0, 0.5);
            
            // Opacity based on presence
            ring.material.opacity = 0.4 + (metrics.midPresence * 0.3);
        });

        // ========================================
        // CAMERA EFFECTS
        // ========================================
        
        // Multi-band shake
        let shakeAmount = 0;
        shakeAmount += this.bassImpulse * 2.0;  // Bass = strong shake
        shakeAmount += this.midImpulse * 1.0;   // Mid = medium shake
        shakeAmount += this.highImpulse * 0.5;  // High = subtle shake
        
        this.camera.position.x += (Math.random() - 0.5) * shakeAmount;
        this.camera.position.y += (Math.random() - 0.5) * shakeAmount;
        
        // Return to center
        this.camera.position.x += (0 - this.camera.position.x) * 0.1;
        this.camera.position.y += (0 - this.camera.position.y) * 0.1;

        // LFO-driven camera sway (during quiet/ambient sections)
        if (metrics.vol < 0.3 || this.genreMode === 'ambient') {
            this.camera.position.x += Math.sin(metrics.lfo8 * Math.PI * 2) * 2;
            this.camera.position.y += Math.cos(metrics.lfo4 * Math.PI * 2) * 1;
        }

        // ========================================
        // POST PROCESSING
        // ========================================
        
        // RGB Shift: High-frequency hits create glitch effect
        const baseShift = 0.002;
        const highShift = this.highImpulse * 0.03;  // NEW: High-hit glitch
        const midShift = this.midImpulse * 0.01;    // Mid adds subtle shift
        this.rgbShiftPass.uniforms['amount'].value = baseShift + highShift + midShift;
        
        // Bloom: Multi-band control
        let bloomStrength = 1.2;
        bloomStrength += this.bassImpulse * 0.5;    // Bass pumps bloom
        bloomStrength += metrics.highPresence * 0.3; // High presence adds glow
        
        // Genre-specific bloom adjustments
        if (this.genreMode === 'electronic') {
            bloomStrength += 0.3; // Electronic = more intense
        } else if (this.genreMode === 'ambient') {
            bloomStrength += 0.5; // Ambient = soft glow
            this.bloomPass.threshold = 0.05; // Lower threshold for softer look
        } else {
            this.bloomPass.threshold = 0.1; // Normal threshold
        }
        
        this.bloomPass.strength = Math.min(2.5, bloomStrength);

        this.composer.render(); 
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}