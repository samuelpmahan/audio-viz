import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class CrystalViz2 {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            rotSpeed: 0.005,
            deformAmount: 15,
            plasmaSpeed: 0.5,
            bloomStrength: 0.6
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000); 

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 30;

        // --- GLOW ENGINE ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = this.config.bloomStrength; 
        this.bloomPass.radius = 0.5;   
        this.bloomPass.threshold = 0.2; 
        this.composer.addPass(this.bloomPass);

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.initGeometry();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Rotation',
                min: 0, max: 0.05, step: 0.001, value: this.config.rotSpeed,
                onChange: (v) => this.config.rotSpeed = v
            },
            {
                name: 'Deform',
                min: 0, max: 30, step: 1, value: this.config.deformAmount,
                onChange: (v) => this.config.deformAmount = v
            },
            {
                name: 'Plasma Spd',
                min: 0, max: 5, step: 0.1, value: this.config.plasmaSpeed,
                onChange: (v) => this.config.plasmaSpeed = v
            },
            {
                name: 'Bloom',
                min: 0, max: 3, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            }
        ];
    }

    initGeometry() {
        // 1. THE PLASMA CORE
        const geometry = new THREE.IcosahedronGeometry(10, 3); 
        this.originalPositions = geometry.attributes.position.array.slice();
        
        const count = geometry.attributes.position.count;
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

        const material = new THREE.MeshBasicMaterial({ 
            vertexColors: true,   
            wireframe: false
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.group.add(this.mesh);

        // 2. THE CAGE
        const wireGeo = new THREE.IcosahedronGeometry(11, 1); 
        const wireMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,      
            wireframe: true,
            transparent: true,
            opacity: 0.15 
        });
        this.wireframe = new THREE.Mesh(wireGeo, wireMat);
        this.group.add(this.wireframe);
    }

    animate(metrics, rawData) {
        this.group.rotation.x += this.config.rotSpeed * 0.6;
        this.group.rotation.y += this.config.rotSpeed;
        
        // BLOOM: Manual + Bass
        this.bloomPass.strength = this.config.bloomStrength + (metrics.bass * 0.6);

        // Pulse Wireframe
        const s = 1 + (metrics.bass * 0.2);
        this.wireframe.scale.set(s, s, s);
        this.wireframe.rotation.z -= 0.01;

        // --- PLASMA LOGIC ---
        const positionAttribute = this.mesh.geometry.attributes.position;
        const colorAttribute = this.mesh.geometry.attributes.color;
        const vertex = new THREE.Vector3();
        const color = new THREE.Color();
        
        // Plasma Speed Control
        const time = Date.now() * 0.001 * this.config.plasmaSpeed;

        for (let i = 0; i < positionAttribute.count; i++) {
            const ox = this.originalPositions[i * 3];
            const oy = this.originalPositions[i * 3 + 1];
            const oz = this.originalPositions[i * 3 + 2];

            const audioIndex = (i % Math.floor(rawData.length / 4)); 
            const audioValue = rawData[audioIndex] / 255.0;

            // Displacement: Manual Deform * Audio
            vertex.set(ox, oy, oz).normalize();
            const dist = 10 + (audioValue * this.config.deformAmount * metrics.bass); 
            vertex.multiplyScalar(dist);
            positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);

            // COLOR LOGIC
            const noise = (vertex.x * 0.05) + (vertex.y * 0.05) + (time * 0.5);
            const hue = (noise + (audioValue * 0.2)) % 1.0;
            
            const lightness = 0.3 + (audioValue * 0.4); 

            color.setHSL(hue, 1.0, lightness);
            colorAttribute.setXYZ(i, color.r, color.g, color.b);
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.color.needsUpdate = true;

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}