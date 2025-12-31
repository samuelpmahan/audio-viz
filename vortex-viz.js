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
        
        this.scene = new THREE.Scene();
        // Fog creates depth fading
        this.scene.fog = new THREE.FogExp2(0x000000, 0.002);

        // 1. SETUP CAMERA (Must happen BEFORE Composer)
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 100;

        // 2. SETUP COMPOSER (Post-Processing)
        this.composer = new EffectComposer(this.renderer);
        
        // Layer 1: The Scene
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Layer 2: Unreal Bloom (Neon Glow)
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = 1.5; 
        this.bloomPass.radius = 0.1;   
        this.bloomPass.threshold = 0.2;  
        this.composer.addPass(this.bloomPass);

        // Layer 3: RGB Shift (Glitch)
        this.rgbShiftPass = new ShaderPass(RGBShiftShader);
        this.rgbShiftPass.uniforms['amount'].value = 0.002; 
        this.composer.addPass(this.rgbShiftPass);

        // 3. SETUP PARTICLES
        this.particles = null;
        this.count = 2000; 
        this.initParticles();

        window.addEventListener('resize', () => this.resize());
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
        this.particles.frustumCulled = false; // Prevents "Ghost in the machine" bug
        this.scene.add(this.particles);
    }

    animate(metrics) {
        // --- 1. MOVEMENT & PHYSICS ---
        // Rotate Tunnel based on Wub (Centroid)
        const rotationSpeed = (metrics.centroid - 0.5) * 0.2; 
        this.particles.rotation.z += rotationSpeed;

        // Warp Speed based on Volume
        const speed = 2 + (metrics.vol * 20); 
        this.camera.position.z -= speed;

        // Infinite Loop Logic
        const positions = this.particles.geometry.attributes.position.array;
        
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            
            if (positions[i3 + 2] > this.camera.position.z - 20) {
                positions[i3 + 2] = this.camera.position.z - 1000 - (Math.random() * 500);
                
                // Optional: Randomize X/Y again so patterns don't repeat exactly
                const angle = Math.random() * Math.PI * 2;
                const radius = 40 + Math.random() * 40; // Match your new radius
                positions[i3] = Math.cos(angle) * radius; // X
                positions[i3 + 1] = Math.sin(angle) * radius; // Y
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;

        // --- 2. VISUAL REACTIVITY ---
        // Color tinting
        this.particles.material.color.setHSL(metrics.centroid * 0.8, 1.0, 0.5); 
        
        // Shake on KICK
        if (metrics.hit) {
            this.camera.position.x = (Math.random() - 0.5) * 2;
            this.camera.position.y = (Math.random() - 0.5) * 2;
            this.particles.material.size = 3.0; 
        } else {
            this.camera.position.x += (0 - this.camera.position.x) * 0.1;
            this.camera.position.y += (0 - this.camera.position.y) * 0.1;
            this.particles.material.size = 1.5;
        }

        // --- 3. POST-PROCESSING UPDATES ---
        // Bloom Pulse
        this.bloomPass.strength = 1.2 + (metrics.bass * 0.5);

        // RGB Glitch on Beat
        if (metrics.hit) {
            this.rgbShiftPass.uniforms['amount'].value = 0.02; 
        } else {
            this.rgbShiftPass.uniforms['amount'].value += (0.002 - this.rgbShiftPass.uniforms['amount'].value) * 0.1;
        }

        // --- 4. RENDER ---
        this.composer.render(); 
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}