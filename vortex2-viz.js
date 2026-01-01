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

        // --- STATE ---
        this.kickImpulse = 0;
        this.snareImpulse = 0;
        this.time = 0;

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

    animate(metrics) {
        this.time += 0.01;

        // Physics Decay
        this.kickImpulse *= 0.90; 
        this.snareImpulse *= 0.92; 

        if (metrics.isKick) this.kickImpulse = 1.0;
        if (metrics.isSnare) this.snareImpulse = 1.0;

        // --- MOVEMENT ---
        // Rotation: Smooth constant spin. Kick adds a TINY nudge to rotation only.
        this.particles.rotation.z -= (0.02 + (this.kickImpulse * 0.05));

        // THE FIX: Removed kickImpulse from speed. 
        // Speed is now purely based on volume (Smooth Drift)
        const speed = 2 + (metrics.vol * 10);
        this.camera.position.z -= speed;

        // Particle Logic
        const positions = this.particles.geometry.attributes.position.array;
        
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const v = this.velocities[i];

            positions[i3] += v.vx;
            positions[i3+1] += v.vy;

            // Wobbly tunnel effect (Kept this, it's subtle)
            //const wave = Math.sin(this.time * 2 + v.phase) * 0.5;
            // positions[i3] += wave * (this.kickImpulse * 1.5);

            // Infinite Loop (Guard 30)
            if (positions[i3 + 2] > this.camera.position.z - 30) {
                positions[i3 + 2] = this.camera.position.z - 1000 - (Math.random() * 500);
                
                const angle = Math.random() * Math.PI * 2;
                const radius = 40 + Math.random() * 50; 
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = Math.sin(angle) * radius; 
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;

        // --- RINGS ---
        this.rings.forEach((ring, i) => {
            if (ring.position.z > this.camera.position.z) {
                ring.position.z = this.camera.position.z - 1500;
            }
            // Pulse size on Kick (Visual pop, not movement)
            const scale = 1.0;// + (this.kickImpulse * 0.3);
            ring.scale.set(scale, scale, 1);
            
            const targetHue = 0.6 + (this.snareImpulse * 0.4); 
            ring.material.color.setHSL(targetHue, 1.0, 0.5);
        });

        // --- CAMERA ---
        // Subtle shake on kick
        const shake = this.kickImpulse * 1.0;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
        
        this.camera.position.x += (0 - this.camera.position.x) * 0.1;
        this.camera.position.y += (0 - this.camera.position.y) * 0.1;

        // --- POST PROCESSING ---
        this.rgbShiftPass.uniforms['amount'].value = 0.002 + (this.snareImpulse * 0.02);
        
        // Bloom: 1.2 -> 1.7 (Noticeable but not blinding)
        this.bloomPass.strength = 1.2 + (this.kickImpulse * 0.5);

        this.composer.render(); 
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}