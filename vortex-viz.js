import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';

export class ParticleTunnel {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            baseSpeed: 2.0,
            bloomStrength: 1.5,
            glitchAmount: 0.002,
            rotationSens: 0.2
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
        this.bloomPass.radius = 0.1;   
        this.bloomPass.threshold = 0.2;  
        this.composer.addPass(this.bloomPass);

        this.rgbShiftPass = new ShaderPass(RGBShiftShader);
        this.rgbShiftPass.uniforms['amount'].value = 0.002; 
        this.composer.addPass(this.rgbShiftPass);

        this.particles = null;
        this.count = 2000; 
        this.initParticles();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Speed',
                min: 0, max: 20, step: 0.1, value: this.config.baseSpeed,
                onChange: (v) => this.config.baseSpeed = v
            },
            {
                name: 'Bloom',
                min: 0, max: 4, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Glitch',
                min: 0, max: 0.05, step: 0.001, value: this.config.glitchAmount,
                onChange: (v) => this.config.glitchAmount = v
            },
            {
                name: 'Rot Sens',
                min: 0, max: 1.0, step: 0.01, value: this.config.rotationSens,
                onChange: (v) => this.config.rotationSens = v
            }
        ];
    }

    initParticles() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        for (let i = 0; i < this.count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 40 + Math.random() * 40; 
            const z = (Math.random() * 2000) - 1000;

            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            positions.push(x, y, z);
            colors.push(1, 1, 1);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 1.5,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 0.8
        });

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false; 
        this.scene.add(this.particles);
    }

    animate(metrics) {
        // --- 1. MOVEMENT & PHYSICS ---
        // Rotate Tunnel: Wub * Manual Sensitivity
        const rotationSpeed = (metrics.centroid - 0.5) * this.config.rotationSens; 
        this.particles.rotation.z += rotationSpeed;

        // Warp Speed: Manual Base + Volume
        const speed = this.config.baseSpeed + (metrics.vol * 20); 
        this.camera.position.z -= speed;

        // Infinite Loop Logic
        const positions = this.particles.geometry.attributes.position.array;
        
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            
            if (positions[i3 + 2] > this.camera.position.z - 20) {
                positions[i3 + 2] = this.camera.position.z - 1000 - (Math.random() * 500);
                const angle = Math.random() * Math.PI * 2;
                const radius = 40 + Math.random() * 40; 
                positions[i3] = Math.cos(angle) * radius; 
                positions[i3 + 1] = Math.sin(angle) * radius; 
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;

        // --- 2. VISUAL REACTIVITY ---
        this.particles.material.color.setHSL(metrics.centroid * 0.8, 1.0, 0.5); 
        
        if (metrics.isKick) { // Updated to V7 isKick
            this.camera.position.x = (Math.random() - 0.5) * 2;
            this.camera.position.y = (Math.random() - 0.5) * 2;
            this.particles.material.size = 3.0; 
        } else {
            this.camera.position.x += (0 - this.camera.position.x) * 0.1;
            this.camera.position.y += (0 - this.camera.position.y) * 0.1;
            this.particles.material.size = 1.5;
        }

        // --- 3. POST-PROCESSING UPDATES ---
        // Bloom Pulse: Manual + Bass
        this.bloomPass.strength = this.config.bloomStrength + (metrics.bass * 0.5);

        // RGB Glitch: Manual + Kick
        if (metrics.isKick) {
            this.rgbShiftPass.uniforms['amount'].value = 0.02 + this.config.glitchAmount; 
        } else {
            // Decay back to manual baseline
            const current = this.rgbShiftPass.uniforms['amount'].value;
            this.rgbShiftPass.uniforms['amount'].value += (this.config.glitchAmount - current) * 0.1;
        }

        this.composer.render(); 
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}