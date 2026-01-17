import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- CUSTOM SHADER: BLUE CHANNEL SHIFT ONLY ---
const BlueGlitchShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'amount': { value: 0.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        varying vec2 vUv;
        void main() {
            vec4 base = texture2D(tDiffuse, vUv);
            float blueShifted = texture2D(tDiffuse, vUv + vec2(amount, 0.0)).b;
            gl_FragColor = vec4(base.r, base.g, blueShifted, base.a);
        }
    `
};

export class Landslide {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0); 
        
        // --- MANUAL CONFIG ---
        this.config = {
            baseSpeed: 3.0,
            bloomStrength: 1.0,
            glitchAmount: 0.01,
            particleSize: 3.0
        };

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020510, 0.0025);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 100;

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = this.config.bloomStrength; 
        this.bloomPass.radius = 0.5;   
        this.bloomPass.threshold = 0.3;  
        this.composer.addPass(this.bloomPass);

        this.blueGlitchPass = new ShaderPass(BlueGlitchShader);
        this.blueGlitchPass.uniforms['amount'].value = 0.0; 
        this.composer.addPass(this.blueGlitchPass);

        // --- STATE ---
        this.kickImpulse = 0;
        this.snareImpulse = 0;
        this.time = 0;

        // --- PARTICLES ---
        this.particles = null;
        this.count = 3500; 
        this.velocities = []; 
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
                min: 0, max: 3, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Glitch',
                min: 0, max: 0.05, step: 0.001, value: this.config.glitchAmount,
                onChange: (v) => this.config.glitchAmount = v
            },
            {
                name: 'P-Size',
                min: 0.5, max: 10, step: 0.5, value: this.config.particleSize,
                onChange: (v) => { 
                    this.config.particleSize = v; 
                    if(this.particles) this.particles.material.size = v; 
                }
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
            const radius = Math.sqrt(Math.random()) * 140; 
            const z = (Math.random() * 2000) - 1000;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            positions.push(x, y, z);

            const r = Math.random();
            if (r > 0.8) { color.setHex(0xffffff); } 
            else if (r > 0.5) { color.setHex(0xddeeff); } 
            else { color.setHSL(0.55 + (Math.random() * 0.05), 0.7, 0.7); } 
            colors.push(color.r, color.g, color.b);

            this.velocities.push({ rotationSpeed: (Math.random() - 0.5) * 0.01 });
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: this.config.particleSize, 
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 0.9,
        });

        material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                'vec4 diffuseColor = vec4( diffuse, opacity );',
                `
                vec4 diffuseColor = vec4( diffuse, opacity );
                float dist = distance(gl_PointCoord, vec2(0.5, 0.5));
                float circleAlpha = smoothstep(0.5, 0.1, dist);
                diffuseColor.a *= circleAlpha;
                `
            );
        };

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false; 
        this.scene.add(this.particles);
    }

    animate(metrics) {
        this.time += 0.01;

        // Physics Decay
        this.kickImpulse *= 0.90; 
        this.snareImpulse *= 0.88; 

        if (metrics.isKick) this.kickImpulse = 1.0;
        if (metrics.isSnare) this.snareImpulse = 1.0;

        // --- MOVEMENT ---
        const baseRotation = 0.015; 
        this.particles.rotation.z -= (baseRotation + (this.kickImpulse * 0.03));

        // SPEED: Manual + Vol
        const speed = this.config.baseSpeed + (metrics.vol * 20);
        this.camera.position.z -= speed;

        // Loop
        const positions = this.particles.geometry.attributes.position.array;
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            if (positions[i3 + 2] > this.camera.position.z) {
                positions[i3 + 2] = this.camera.position.z - 1200 - (Math.random() * 500);
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.sqrt(Math.random()) * 140; 
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = Math.sin(angle) * radius; 
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;

        // --- CAMERA SHAKE ---
        const shake = this.snareImpulse * 0.7;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
        this.camera.position.x += (0 - this.camera.position.x) * 0.1;
        this.camera.position.y += (0 - this.camera.position.y) * 0.1;

        // --- POST PROCESSING ---
        // GLITCH: Manual + Snare
        this.blueGlitchPass.uniforms['amount'].value = (this.snareImpulse * this.config.glitchAmount);
        
        // BLOOM: Manual + Kick
        this.bloomPass.strength = this.config.bloomStrength + (this.kickImpulse * 0.6);

        this.composer.render(); 
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}