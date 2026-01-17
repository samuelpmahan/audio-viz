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
        
        // --- CONFIGURATION STATE ---
        this.config = {
            bloomStrength: 1.2,
            rotationSpeed: 0.02,
            baseSpeed: 2.0,
            glitchAmount: 0.002,
            ringScale: 1.0
        };

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.002);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 100;

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = this.config.bloomStrength; 
        this.bloomPass.radius = 0.2;   
        this.bloomPass.threshold = 0.1;  
        this.composer.addPass(this.bloomPass);

        this.rgbShiftPass = new ShaderPass(RGBShiftShader);
        this.rgbShiftPass.uniforms['amount'].value = 0.002; 
        this.composer.addPass(this.rgbShiftPass);

        // --- STATE ---
        this.time = 0;
        this.bassImpulse = 0;
        this.midImpulse = 0;
        this.highImpulse = 0;
        this.genreMode = 'neutral';
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

    // --- MANUAL CONTROLS INTERFACE ---
    getParams() {
        return [
            {
                name: 'Bloom',
                min: 0, max: 4, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Speed',
                min: 0, max: 10, step: 0.1, value: this.config.baseSpeed,
                onChange: (v) => this.config.baseSpeed = v
            },
            {
                name: 'Rotation',
                min: 0, max: 0.1, step: 0.001, value: this.config.rotationSpeed,
                onChange: (v) => this.config.rotationSpeed = v
            },
            {
                name: 'Glitch',
                min: 0, max: 0.02, step: 0.0001, value: this.config.glitchAmount,
                onChange: (v) => this.config.glitchAmount = v
            },
            {
                name: 'Rings',
                min: 0, max: 2, step: 0.1, value: this.config.ringScale,
                onChange: (v) => this.config.ringScale = v
            }
        ];
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

            const hue = 0.55 + (Math.random() * 0.35); 
            color.setHSL(hue, 1.0, 0.6);
            colors.push(color.r, color.g, color.b);

            this.velocities.push({
                vx: (Math.random() - 0.5) * 0.2,
                vy: (Math.random() - 0.5) * 0.2
            });
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 2.0, vertexColors: true, blending: THREE.AdditiveBlending,
            depthWrite: false, transparent: true, opacity: 0.9
        });

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false; 
        this.scene.add(this.particles);
    }

    initRings() {
        for (let i = 0; i < 5; i++) {
            const geometry = new THREE.TorusGeometry(60, 0.4, 8, 100); 
            const material = new THREE.MeshBasicMaterial({
                color: 0x4444ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending
            });
            const ring = new THREE.Mesh(geometry, material);
            ring.position.z = this.camera.position.z - 200 - (i * 300);
            this.rings.push(ring);
            this.scene.add(ring);
        }
    }

    detectGenre(metrics) {
        this.genreCheckTimer += 0.016;
        if (this.genreCheckTimer < 2.0) return;
        this.genreCheckTimer = 0;

        if (metrics.bassPresence > 0.7 && metrics.bpm > 120 && metrics.bpm < 180) {
            this.genreMode = 'electronic';
        } else if (metrics.highPresence > 0.6 && metrics.bassPresence < 0.3 && metrics.bpm < 100) {
            this.genreMode = 'ambient';
        } else {
            this.genreMode = 'neutral';
        }
    }

    animate(metrics) {
        this.time += 0.01;
        this.detectGenre(metrics);

        // --- PHYSICS ---
        this.bassImpulse *= 0.90; 
        this.midImpulse *= 0.92;
        this.highImpulse *= 0.94;

        if (metrics.bassHit > 0.8) {
            const anticipation = 1.0 + Math.min(2.0, metrics.bassTime / 2000);
            this.bassImpulse = 1.0 * anticipation;
        }
        if (metrics.midHit > 0.8) this.midImpulse = 1.0;
        if (metrics.highHit > 0.8) this.highImpulse = 1.0;

        // --- MOVEMENT ---
        // 1. Rotation (Manual Config + Reactivity)
        let rotSpeed = this.config.rotationSpeed;
        if (this.genreMode === 'electronic') rotSpeed += (this.bassImpulse * 0.1);
        else if (this.genreMode === 'ambient') rotSpeed += (metrics.lfo8 * 0.02);
        this.particles.rotation.z -= rotSpeed;

        // 2. Speed (Manual Config + Reactivity)
        let speed = this.config.baseSpeed + (metrics.vol * 10);
        if (this.genreMode === 'electronic') speed += this.bassImpulse * 15;
        else if (this.genreMode === 'ambient') speed = 1 + (speed * 0.5) + (metrics.lfo4 * 2);
        this.camera.position.z -= speed;

        // --- PARTICLES ---
        const positions = this.particles.geometry.attributes.position.array;
        const colors = this.particles.geometry.attributes.color.array;
        const color = new THREE.Color();
        
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const v = this.velocities[i];
            positions[i3] += v.vx;
            positions[i3+1] += v.vy;

            if (positions[i3 + 2] > this.camera.position.z - 30) {
                positions[i3 + 2] = this.camera.position.z - 1000 - (Math.random() * 500);
                const angle = Math.random() * Math.PI * 2;
                const radius = 40 + Math.random() * 50; 
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = Math.sin(angle) * radius; 
            }

            // Color Logic
            let hue, sat, light;
            if (this.genreMode === 'electronic') {
                if (this.bassImpulse > 0.5) { hue = 0.95; sat = 1.0; light = 0.5 + (this.bassImpulse * 0.3); }
                else if (this.midImpulse > 0.5) { hue = 0.15; sat = 1.0; light = 0.6; }
                else { hue = 0.55 + (metrics.centroid * 0.15); sat = 0.8; light = 0.5; }
            } else {
                hue = 0.55 + (metrics.centroid * 0.35);
                sat = 0.8;
                light = 0.5 + (this.bassImpulse * 0.2);
            }
            
            color.setHSL(hue, sat, light);
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }
        
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
        this.particles.material.size = 2.0 + (this.midImpulse * 2.0);

        // --- RINGS ---
        this.rings.forEach((ring) => {
            ring.position.z += speed;
            if (ring.position.z > this.camera.position.z) {
                ring.position.z = this.camera.position.z - 1500;
            }
            // Manual Ring Scale + Bass Pulse
            const scale = this.config.ringScale + (this.bassImpulse * 0.3);
            ring.scale.set(scale, scale, 1);
            ring.material.opacity = 0.4 + (metrics.midPresence * 0.3);
        });

        // --- POST PROCESSING ---
        // 1. Glitch (Manual + High Freq)
        const totalGlitch = this.config.glitchAmount + (this.highImpulse * 0.03);
        this.rgbShiftPass.uniforms['amount'].value = totalGlitch;
        
        // 2. Bloom (Manual + Bass)
        let bloom = this.config.bloomStrength + (this.bassImpulse * 0.5);
        if (this.genreMode === 'electronic') bloom += 0.3;
        this.bloomPass.strength = Math.min(4.0, bloom);

        this.composer.render(); 
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}