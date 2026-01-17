import * as THREE from 'three';

export class ConstellationViz {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            camRadius: 50,
            rotationSpeed: 0.05,
            connectDist: 15,
            baseSize: 1.0
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000510); 
        this.scene.fog = new THREE.Fog(0x000510, 50, 200);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 50;

        // CONFIG
        this.PARTICLE_COUNT = 200;
        this.FREQ_BANDS = 8; 
        
        this.particles = [];
        this.time = 0;
        
        this.palettePhase = 0;
        
        this.rotationAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        
        this.initParticles();
        this.initConnections();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Zoom',
                min: 20, max: 100, step: 1, value: this.config.camRadius,
                onChange: (v) => this.config.camRadius = v
            },
            {
                name: 'Rotation',
                min: 0, max: 0.2, step: 0.001, value: this.config.rotationSpeed,
                onChange: (v) => this.config.rotationSpeed = v
            },
            {
                name: 'Link Dist',
                min: 5, max: 40, step: 1, value: this.config.connectDist,
                onChange: (v) => this.config.connectDist = v
            },
            {
                name: 'P-Size',
                min: 0.2, max: 3.0, step: 0.1, value: this.config.baseSize,
                onChange: (v) => this.config.baseSize = v
            }
        ];
    }

    initParticles() {
        for (let i = 0; i < this.PARTICLE_COUNT; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 20 + Math.random() * 20;
            
            const freqBand = Math.floor(i / (this.PARTICLE_COUNT / this.FREQ_BANDS));
            const baseSize = 0.2 + (freqBand / this.FREQ_BANDS) * 0.4; 
            
            const geometry = new THREE.SphereGeometry(1, 8, 8); // Base scale 1, we scale manually
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(Math.random() * 0.3 + 0.5, 0.8, 0.6),
                transparent: true,
                opacity: 0.8
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);
            
            mesh.position.set(x, y, z);
            
            this.scene.add(mesh);
            
            this.particles.push({
                mesh,
                basePos: new THREE.Vector3(x, y, z),
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.5) * 0.02
                ),
                freqBand,
                phase: Math.random() * Math.PI * 2,
                baseSize // Relative size factor
            });
        }
    }

    initConnections() {
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        
        this.connectionLines = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            lineMaterial
        );
        
        const maxConnections = this.PARTICLE_COUNT * 10;
        const positions = new Float32Array(maxConnections * 6); 
        
        this.connectionLines.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
        );
        
        this.connectionLines.geometry.setDrawRange(0, 0);
        this.scene.add(this.connectionLines);
    }

    getPaletteColor(t, audioIntensity) {
        const paletteIndex = Math.floor(t / 20) % 4; 
        const blend = (t % 20) / 20; 
        
        let hue, sat, light;
        
        switch(paletteIndex) {
            case 0: // Cool blues
                hue = 0.5 + audioIntensity * 0.15; sat = 0.8; light = 0.5 + audioIntensity * 0.3; break;
            case 1: // Purples
                hue = 0.75 + audioIntensity * 0.15; sat = 0.9; light = 0.5 + audioIntensity * 0.25; break;
            case 2: // Warm
                hue = 0.05 + audioIntensity * 0.1; sat = 0.85; light = 0.55 + audioIntensity * 0.2; break;
            case 3: // Greens
                hue = 0.35 + audioIntensity * 0.15; sat = 0.75; light = 0.5 + audioIntensity * 0.3; break;
        }
        return { h: hue, s: sat, l: light };
    }

    animate(metrics, rawData) {
        this.time += 0.01;
        this.palettePhase += 0.02;
        
        const bandSize = Math.floor(rawData.length / this.FREQ_BANDS);
        const bands = [];
        for (let i = 0; i < this.FREQ_BANDS; i++) {
            let sum = 0;
            for (let j = 0; j < bandSize; j++) {
                sum += rawData[i * bandSize + j];
            }
            bands.push(sum / bandSize / 255.0);
        }
        
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const audioIntensity = bands[p.freqBand];
            
            // SCALE: (Manual Base * Relative Size) + Audio
            const sizeMultiplier = p.baseSize; 
            const scale = (this.config.baseSize * sizeMultiplier) + (audioIntensity * 2 * sizeMultiplier);
            p.mesh.scale.setScalar(scale);
            
            // Update positions
            p.velocity.x += (Math.random() - 0.5) * 0.001;
            p.velocity.y += (Math.random() - 0.5) * 0.001;
            p.velocity.z += (Math.random() - 0.5) * 0.001;
            
            p.mesh.position.add(p.velocity);
            p.velocity.multiplyScalar(0.98);
            
            const diff = p.basePos.clone().sub(p.mesh.position);
            p.velocity.add(diff.multiplyScalar(0.01));
            
            const wave = Math.sin(this.time * 2 + p.phase) * audioIntensity * 3;
            p.mesh.position.y += wave;
            
            const color = this.getPaletteColor(this.palettePhase + p.phase, audioIntensity);
            p.mesh.material.color.setHSL(color.h, color.s, color.l);
            p.mesh.material.opacity = 0.6 + audioIntensity * 0.4;
        }
        
        this.updateConnections();
        
        // CAMERA: Manual Speed + Manual Radius
        const angle = this.time * this.config.rotationSpeed * 5.0; // Multiplier to make slider useful
        const rad = this.config.camRadius;
        
        this.camera.position.x = Math.cos(angle) * rad * this.rotationAxis.x + Math.sin(angle) * rad * this.rotationAxis.z;
        this.camera.position.y = rad * this.rotationAxis.y + Math.sin(angle * 0.5) * 20;
        this.camera.position.z = Math.sin(angle) * rad * this.rotationAxis.x + Math.cos(angle) * rad * this.rotationAxis.z;
        this.camera.lookAt(0, 0, 0);
        
        this.renderer.render(this.scene, this.camera);
    }

    updateConnections() {
        const positions = this.connectionLines.geometry.attributes.position.array;
        let connectionCount = 0;
        
        for (let i = 0; i < this.particles.length; i++) {
            const p1 = this.particles[i];
            
            for (let j = i + 1; j < this.particles.length; j++) {
                const p2 = this.particles[j];
                const dist = p1.mesh.position.distanceTo(p2.mesh.position);
                
                // CONTROL: Manual Connection Distance
                if (dist < this.config.connectDist) {
                    const idx = connectionCount * 6;
                    
                    positions[idx] = p1.mesh.position.x;
                    positions[idx + 1] = p1.mesh.position.y;
                    positions[idx + 2] = p1.mesh.position.z;
                    
                    positions[idx + 3] = p2.mesh.position.x;
                    positions[idx + 4] = p2.mesh.position.y;
                    positions[idx + 5] = p2.mesh.position.z;
                    
                    connectionCount++;
                }
            }
        }
        
        this.connectionLines.geometry.setDrawRange(0, connectionCount * 2);
        this.connectionLines.geometry.attributes.position.needsUpdate = true;
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}