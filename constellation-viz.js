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
            camRadius: 60,       // Zoom level
            rotationSpeed: 0.002, // Base rotation speed
            connectDist: 18,     // Base web density
            particleSize: 1.0    // Global particle scaler
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000510); 
        this.scene.fog = new THREE.Fog(0x000510, 50, 200);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = this.config.camRadius;

        // CONFIG
        this.PARTICLE_COUNT = 250;
        
        this.particles = [];
        this.palettePhase = 0;
        
        // Track current angle for smooth incremental rotation
        this.currentAngle = 0; 
        
        this.initParticles();
        this.initConnections();

        window.addEventListener('resize', () => this.resize());
    }

    // --- MANUAL CONTROLS ---
    getParams() {
        return [
            {
                name: 'Zoom',
                min: 20, max: 150, step: 1, value: this.config.camRadius,
                onChange: (v) => this.config.camRadius = v
            },
            {
                name: 'Speed',
                min: 0, max: 0.02, step: 0.0001, value: this.config.rotationSpeed,
                onChange: (v) => this.config.rotationSpeed = v
            },
            {
                name: 'Web Dist',
                min: 5, max: 40, step: 1, value: this.config.connectDist,
                onChange: (v) => this.config.connectDist = v
            },
            {
                name: 'P-Size',
                min: 0.1, max: 3.0, step: 0.1, value: this.config.particleSize,
                onChange: (v) => this.config.particleSize = v
            }
        ];
    }

    initParticles() {
        const geometry = new THREE.SphereGeometry(1, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

        for (let i = 0; i < this.PARTICLE_COUNT; i++) {
            const mesh = new THREE.Mesh(geometry, material.clone());
            
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 20 + Math.random() * 30;
            
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);
            
            mesh.position.set(x, y, z);
            this.scene.add(mesh);
            
            // Randomly assign types for organic variation
            const typeRand = Math.random();
            let type = 'mid';
            if(typeRand > 0.7) type = 'treble';
            if(typeRand < 0.3) type = 'bass';

            this.particles.push({
                mesh,
                basePos: new THREE.Vector3(x, y, z),
                velocity: new THREE.Vector3(0,0,0),
                type: type,
                baseScale: 0.3 + Math.random() * 0.5
            });
        }
    }

    initConnections() {
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending
        });
        
        this.connectionLines = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            lineMaterial
        );
        
        const maxConnections = this.PARTICLE_COUNT * 12;
        const positions = new Float32Array(maxConnections * 6); 
        
        this.connectionLines.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
        );
        
        this.connectionLines.geometry.setDrawRange(0, 0);
        this.scene.add(this.connectionLines);
    }

    animate(metrics) {
        this.palettePhase += 0.01;

        // --- ROTATION (Manual + Bass) ---
        // Base speed from slider, plus kick reaction
        const speed = this.config.rotationSpeed + (metrics.bass * 0.02);
        this.currentAngle += speed;

        // --- CAMERA (Manual Zoom) ---
        // Orbit using manual Radius
        const rad = this.config.camRadius;
        this.camera.position.x = Math.sin(this.currentAngle) * rad;
        this.camera.position.z = Math.cos(this.currentAngle) * rad;
        this.camera.lookAt(0, 0, 0);

        // --- PARTICLE LOGIC ---
        this.particles.forEach(p => {
            let intensity = 0;
            if (p.type === 'bass') intensity = metrics.bass;
            else if (p.type === 'mid') intensity = metrics.mid;
            else intensity = metrics.treble;

            // Scale: (Base Scale * Manual Multiplier) + Audio
            const targetScale = (p.baseScale * this.config.particleSize) + (intensity * 1.5);
            p.mesh.scale.setScalar(targetScale);

            // Color: Continuous Rainbow Fade
            const hue = (this.palettePhase + (intensity * 0.2)) % 1.0;
            p.mesh.material.color.setHSL(hue, 0.8, 0.5 + (intensity * 0.5));
            
            // Physics: Kick Reaction
            if (metrics.isKick) {
                const dir = p.mesh.position.clone().normalize();
                p.velocity.add(dir.multiplyScalar(0.5)); 
            }

            p.mesh.position.add(p.velocity);
            p.velocity.multiplyScalar(0.90); // Damping
            
            // Return to start
            const diff = p.basePos.clone().sub(p.mesh.position);
            p.velocity.add(diff.multiplyScalar(0.02)); 
        });
        
        this.updateConnections(metrics.bass);
        this.renderer.render(this.scene, this.camera);
    }

    updateConnections(bassLevel) {
        const positions = this.connectionLines.geometry.attributes.position.array;
        let connectionCount = 0;
        const pArr = this.particles;
        
        // Threshold: Manual Base + Bass expansion ("Breathing")
        const distThreshold = this.config.connectDist + (bassLevel * 5);

        for (let i = 0; i < pArr.length; i++) {
            for (let j = i + 1; j < pArr.length; j++) {
                const dist = pArr[i].mesh.position.distanceTo(pArr[j].mesh.position);
                
                if (dist < distThreshold) {
                    const idx = connectionCount * 6;
                    
                    positions[idx] = pArr[i].mesh.position.x;
                    positions[idx + 1] = pArr[i].mesh.position.y;
                    positions[idx + 2] = pArr[i].mesh.position.z;
                    
                    positions[idx + 3] = pArr[j].mesh.position.x;
                    positions[idx + 4] = pArr[j].mesh.position.y;
                    positions[idx + 5] = pArr[j].mesh.position.z;
                    
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