import * as THREE from 'three';

export class ConstellationViz {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000510); // Deep space blue
        this.scene.fog = new THREE.Fog(0x000510, 50, 200);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 50;

        // CONFIG
        this.PARTICLE_COUNT = 200;
        this.CONNECTION_DISTANCE = 15;
        this.FREQ_BANDS = 8; // Split audio into frequency bands
        
        this.particles = [];
        this.time = 0;
        
        // Color palette that shifts over time
        this.palettePhase = 0;
        
        // Randomized rotation direction
        this.rotationAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = 0.05 + Math.random() * 0.1;
        
        this.initParticles();
        this.initConnections();

        window.addEventListener('resize', () => this.resize());
    }

    initParticles() {
        for (let i = 0; i < this.PARTICLE_COUNT; i++) {
            // Distribute particles in 3D space
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 20 + Math.random() * 20;
            
            // Varying particle sizes based on frequency band
            const freqBand = Math.floor(i / (this.PARTICLE_COUNT / this.FREQ_BANDS));
            const baseSize = 0.2 + (freqBand / this.FREQ_BANDS) * 0.4; // Low freq = smaller, high freq = bigger
            
            const geometry = new THREE.SphereGeometry(baseSize, 8, 8);
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
            
            // Store particle data
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
                baseSize
            });
        }
    }

    initConnections() {
        // Create line geometry for connections between particles
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
        
        // Pre-allocate enough space for all possible connections
        const maxConnections = this.PARTICLE_COUNT * 10;
        const positions = new Float32Array(maxConnections * 6); // 2 points per connection * 3 coords
        
        this.connectionLines.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
        );
        
        this.connectionLines.geometry.setDrawRange(0, 0);
        this.scene.add(this.connectionLines);
    }

    getPaletteColor(t, audioIntensity) {
        // Shift through different color palettes over time
        // t is a value that slowly increases, creating palette transitions
        const paletteIndex = Math.floor(t / 20) % 4; // Change palette every 20 time units
        const blend = (t % 20) / 20; // Smooth blend between palettes
        
        let hue, sat, light;
        
        switch(paletteIndex) {
            case 0: // Cool blues and cyans
                hue = 0.5 + audioIntensity * 0.15;
                sat = 0.8;
                light = 0.5 + audioIntensity * 0.3;
                break;
            case 1: // Purples and magentas
                hue = 0.75 + audioIntensity * 0.15;
                sat = 0.9;
                light = 0.5 + audioIntensity * 0.25;
                break;
            case 2: // Warm oranges and reds
                hue = 0.05 + audioIntensity * 0.1;
                sat = 0.85;
                light = 0.55 + audioIntensity * 0.2;
                break;
            case 3: // Greens and teals
                hue = 0.35 + audioIntensity * 0.15;
                sat = 0.75;
                light = 0.5 + audioIntensity * 0.3;
                break;
        }
        
        return { h: hue, s: sat, l: light };
    }

    animate(metrics, rawData) {
        this.time += 0.01;
        this.palettePhase += 0.02;
        
        // Split audio data into frequency bands
        const bandSize = Math.floor(rawData.length / this.FREQ_BANDS);
        const bands = [];
        
        for (let i = 0; i < this.FREQ_BANDS; i++) {
            let sum = 0;
            for (let j = 0; j < bandSize; j++) {
                sum += rawData[i * bandSize + j];
            }
            bands.push(sum / bandSize / 255.0);
        }
        
        // Update particles based on their frequency band
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const audioIntensity = bands[p.freqBand];
            
            // Pulse effect based on audio - size varies by frequency band
            const sizeMultiplier = 1 + (p.freqBand / this.FREQ_BANDS) * 0.5; // Higher freq = bigger pulses
            const scale = 1 + audioIntensity * 2 * sizeMultiplier;
            p.mesh.scale.setScalar(scale);
            
            // Update particle position with gentle motion
            p.velocity.x += (Math.random() - 0.5) * 0.001;
            p.velocity.y += (Math.random() - 0.5) * 0.001;
            p.velocity.z += (Math.random() - 0.5) * 0.001;
            
            // Apply velocity with damping
            p.mesh.position.x += p.velocity.x;
            p.mesh.position.y += p.velocity.y;
            p.mesh.position.z += p.velocity.z;
            
            p.velocity.multiplyScalar(0.98);
            
            // Pull back toward base position (spring effect)
            const diff = p.basePos.clone().sub(p.mesh.position);
            p.velocity.add(diff.multiplyScalar(0.01));
            
            // Audio reactive wave motion
            const wave = Math.sin(this.time * 2 + p.phase) * audioIntensity * 3;
            p.mesh.position.y += wave;
            
            // Update color with shifting palette
            const color = this.getPaletteColor(this.palettePhase + p.phase, audioIntensity);
            p.mesh.material.color.setHSL(color.h, color.s, color.l);
            p.mesh.material.opacity = 0.6 + audioIntensity * 0.4;
        }
        
        // Update connections between nearby particles
        this.updateConnections();
        
        // Rotate camera along randomized axis
        const angle = this.time * this.rotationSpeed;
        this.camera.position.x = Math.cos(angle) * 50 * this.rotationAxis.x + Math.sin(angle) * 50 * this.rotationAxis.z;
        this.camera.position.y = 50 * this.rotationAxis.y + Math.sin(angle * 0.5) * 20;
        this.camera.position.z = Math.sin(angle) * 50 * this.rotationAxis.x + Math.cos(angle) * 50 * this.rotationAxis.z;
        this.camera.lookAt(0, 0, 0);
        
        this.renderer.render(this.scene, this.camera);
    }

    updateConnections() {
        const positions = this.connectionLines.geometry.attributes.position.array;
        let connectionCount = 0;
        
        // Find connections between close particles
        for (let i = 0; i < this.particles.length; i++) {
            const p1 = this.particles[i];
            
            for (let j = i + 1; j < this.particles.length; j++) {
                const p2 = this.particles[j];
                const dist = p1.mesh.position.distanceTo(p2.mesh.position);
                
                if (dist < this.CONNECTION_DISTANCE) {
                    // Add connection
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