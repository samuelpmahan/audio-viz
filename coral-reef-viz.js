import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- CAUSTIC SHADER: Animated underwater light ripples ---
const CausticShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'time': { value: 0.0 },
        'intensity': { value: 0.3 },
        'speed': { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float intensity;
        uniform float speed;
        varying vec2 vUv;
        
        // Simple 2D noise
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        
        void main() {
            vec2 uv = vUv;
            
            // Create animated caustic pattern
            float caustic1 = noise(uv * 10.0 + vec2(time * speed * 0.3, 0.0));
            float caustic2 = noise(uv * 15.0 - vec2(0.0, time * speed * 0.4));
            float caustic = (caustic1 + caustic2) * 0.5;
            
            // Ripple effect
            float ripple = sin(uv.x * 20.0 + time * speed) * sin(uv.y * 20.0 + time * speed * 0.7);
            caustic += ripple * 0.2;
            
            vec4 color = texture2D(tDiffuse, uv);
            
            // Add caustic brightness
            color.rgb += vec3(caustic * intensity * 0.5);
            
            // Slight blue tint for underwater feel
            color.rgb *= vec3(0.8, 0.9, 1.0);
            
            gl_FragColor = color;
        }
    `
};

export class CoralReef {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            swayAmount: 1.0,
            fishCount: 50,
            causticIntensity: 0.4,
            waterColor: new THREE.Color(0x001a33), // Deep ocean blue
            bloomStrength: 1.2,
            currentStrength: 1.0
        };

        this.scene = new THREE.Scene();
        this.scene.background = this.config.waterColor.clone();
        this.scene.fog = new THREE.FogExp2(0x001a33, 0.015);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 40);
        this.camera.lookAt(0, 5, 0);

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        this.bloomPass.strength = this.config.bloomStrength;
        this.bloomPass.radius = 0.5;
        this.bloomPass.threshold = 0.2;
        this.composer.addPass(this.bloomPass);

        // Caustic shader pass
        this.causticPass = new ShaderPass(CausticShader);
        this.composer.addPass(this.causticPass);

        // --- STATE ---
        this.time = 0;
        this.corals = [];
        this.fish = [];
        this.bubbles = [];
        this.genreMode = 'neutral';
        this.genreCheckTimer = 0;
        
        // Boids flocking parameters
        this.flockCenter = new THREE.Vector3(0, 10, 0);
        this.scatterForce = 0;
        
        this.initLighting();
        this.initSeafloor();
        this.initCorals();
        this.initFish();
        this.initBubbles();
        this.initParticulates();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Sway',
                min: 0, max: 3, step: 0.1, value: this.config.swayAmount,
                onChange: (v) => this.config.swayAmount = v
            },
            {
                name: 'Fish',
                min: 0, max: 150, step: 10, value: this.config.fishCount,
                onChange: (v) => this.updateFishCount(v)
            },
            {
                name: 'Caustics',
                min: 0, max: 1, step: 0.05, value: this.config.causticIntensity,
                onChange: (v) => this.config.causticIntensity = v
            },
            {
                name: 'Bloom',
                min: 0, max: 3, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Current',
                min: 0, max: 3, step: 0.1, value: this.config.currentStrength,
                onChange: (v) => this.config.currentStrength = v
            }
        ];
    }

    initLighting() {
        // Ambient underwater glow
        const ambient = new THREE.AmbientLight(0x112244, 0.4);
        this.scene.add(ambient);

        // Directional light from above (sunlight through water)
        this.sunlight = new THREE.DirectionalLight(0x88ccff, 0.8);
        this.sunlight.position.set(10, 50, 10);
        this.scene.add(this.sunlight);
    }

    initSeafloor() {
        const geometry = new THREE.PlaneGeometry(200, 200, 50, 50);
        geometry.rotateX(-Math.PI / 2);
        
        // Add some variation to the seafloor
        const positions = geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] = Math.random() * 2 - 1; // Y variation
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshStandardMaterial({
            color: 0x2a4a5a,
            roughness: 0.9,
            metalness: 0.1
        });
        
        this.seafloor = new THREE.Mesh(geometry, material);
        this.seafloor.position.y = -5;
        this.seafloor.receiveShadow = true;
        this.scene.add(this.seafloor);
    }

    initCorals() {
        const coralTypes = [
            { segments: 8, height: 6, radiusTop: 0.2, radiusBottom: 0.8, color: 0xff6b9d }, // Pink
            { segments: 6, height: 8, radiusTop: 0.1, radiusBottom: 0.5, color: 0xffa500 }, // Orange
            { segments: 10, height: 5, radiusTop: 0.3, radiusBottom: 1.0, color: 0x9b59b6 }, // Purple
            { segments: 12, height: 7, radiusTop: 0.15, radiusBottom: 0.6, color: 0x3498db }  // Blue
        ];

        for (let i = 0; i < 30; i++) {
            const type = coralTypes[Math.floor(Math.random() * coralTypes.length)];
            
            const geometry = new THREE.CylinderGeometry(
                type.radiusTop,
                type.radiusBottom,
                type.height,
                type.segments,
                8
            );
            
            // Store original positions for sway animation
            const positions = geometry.attributes.position.array;
            geometry.setAttribute('originalPosition', new THREE.Float32BufferAttribute(positions.slice(), 3));
            
            const material = new THREE.MeshStandardMaterial({
                color: type.color,
                roughness: 0.7,
                metalness: 0.2,
                emissive: type.color,
                emissiveIntensity: 0.0 // Will be animated
            });
            
            const coral = new THREE.Mesh(geometry, material);
            
            // Random placement
            const angle = Math.random() * Math.PI * 2;
            const radius = 10 + Math.random() * 30;
            coral.position.x = Math.cos(angle) * radius;
            coral.position.z = Math.sin(angle) * radius;
            coral.position.y = -5 + type.height / 2;
            
            coral.rotation.y = Math.random() * Math.PI * 2;
            
            // Store metadata
            coral.userData.swayPhase = Math.random() * Math.PI * 2;
            coral.userData.swaySpeed = 0.5 + Math.random() * 0.5;
            coral.userData.baseColor = new THREE.Color(type.color);
            
            this.corals.push(coral);
            this.scene.add(coral);
        }
    }

    initFish() {
        // Fish geometry (simple elongated shape)
        const fishGeo = new THREE.ConeGeometry(0.3, 1.5, 4);
        fishGeo.rotateX(Math.PI / 2); // Point forward
        
        for (let i = 0; i < this.config.fishCount; i++) {
            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
                emissive: new THREE.Color().setHSL(Math.random(), 0.5, 0.3),
                emissiveIntensity: 0.2
            });
            
            const fish = new THREE.Mesh(fishGeo, material);
            
            // Random starting position
            fish.position.set(
                (Math.random() - 0.5) * 60,
                Math.random() * 25 + 5,
                (Math.random() - 0.5) * 60
            );
            
            // Boids properties
            fish.userData.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 2
            );
            fish.userData.baseColor = material.color.clone();
            
            this.fish.push(fish);
            this.scene.add(fish);
        }
    }

    updateFishCount(newCount) {
        const diff = newCount - this.fish.length;
        
        if (diff > 0) {
            // Add fish
            const fishGeo = new THREE.ConeGeometry(0.3, 1.5, 4);
            fishGeo.rotateX(Math.PI / 2);
            
            for (let i = 0; i < diff; i++) {
                const material = new THREE.MeshStandardMaterial({
                    color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
                    emissive: new THREE.Color().setHSL(Math.random(), 0.5, 0.3),
                    emissiveIntensity: 0.2
                });
                
                const fish = new THREE.Mesh(fishGeo, material);
                fish.position.copy(this.flockCenter);
                fish.userData.velocity = new THREE.Vector3(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 2
                );
                fish.userData.baseColor = material.color.clone();
                
                this.fish.push(fish);
                this.scene.add(fish);
            }
        } else if (diff < 0) {
            // Remove fish
            for (let i = 0; i < Math.abs(diff); i++) {
                const fish = this.fish.pop();
                this.scene.remove(fish);
            }
        }
        
        this.config.fishCount = newCount;
    }

    initBubbles() {
        const bubbleGeo = new THREE.SphereGeometry(0.1, 8, 8);
        
        for (let i = 0; i < 50; i++) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.3
            });
            
            const bubble = new THREE.Mesh(bubbleGeo, material);
            bubble.position.set(
                (Math.random() - 0.5) * 40,
                -5,
                (Math.random() - 0.5) * 40
            );
            bubble.userData.active = false;
            bubble.userData.speed = 0.5 + Math.random() * 1.0;
            
            this.bubbles.push(bubble);
            this.scene.add(bubble);
        }
    }

    initParticulates() {
        // Floating particles (plankton, sediment)
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        
        for (let i = 0; i < 1000; i++) {
            positions.push(
                (Math.random() - 0.5) * 100,
                Math.random() * 60 - 5,
                (Math.random() - 0.5) * 100
            );
            
            const color = new THREE.Color();
            if (Math.random() > 0.7) {
                color.setHSL(0.5 + Math.random() * 0.1, 0.5, 0.7); // Bioluminescent
            } else {
                color.setHSL(0.6, 0.1, 0.5); // Sediment
            }
            colors.push(color.r, color.g, color.b);
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 0.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        
        this.particulates = new THREE.Points(geometry, material);
        this.scene.add(this.particulates);
    }

    detectGenre(metrics) {
        this.genreCheckTimer += 0.016;
        if (this.genreCheckTimer < 2.0) return;
        this.genreCheckTimer = 0;

        if (metrics.bassPresence > 0.6 && metrics.bpm > 120) {
            this.genreMode = 'electronic';
        } else if (metrics.highPresence > 0.5 && metrics.bpm < 100) {
            this.genreMode = 'ambient';
        } else {
            this.genreMode = 'neutral';
        }
    }

    updateCorals(metrics) {
        this.corals.forEach(coral => {
            const positions = coral.geometry.attributes.position.array;
            const original = coral.geometry.attributes.originalPosition.array;
            
            // Sway animation using LFOs
            const swayX = Math.sin(this.time * coral.userData.swaySpeed + coral.userData.swayPhase) 
                        * this.config.swayAmount 
                        * (metrics.lfo2 * 0.5 + 0.5);
            const swayZ = Math.cos(this.time * coral.userData.swaySpeed * 0.7 + coral.userData.swayPhase) 
                        * this.config.swayAmount 
                        * (metrics.lfo4 * 0.5 + 0.5);
            
            // Apply sway to vertices (more sway at the top)
            for (let i = 0; i < positions.length; i += 3) {
                const y = original[i + 1];
                const normalizedHeight = (y + coral.geometry.parameters.height / 2) / coral.geometry.parameters.height;
                const swayFactor = Math.pow(normalizedHeight, 2);
                
                positions[i] = original[i] + swayX * swayFactor;
                positions[i + 2] = original[i + 2] + swayZ * swayFactor;
            }
            coral.geometry.attributes.position.needsUpdate = true;
            
            // Bioluminescence
            if (this.genreMode === 'electronic') {
                // Neon glow on bass hits
                const emissive = metrics.bassHit * 0.8;
                coral.material.emissiveIntensity = emissive;
            } else if (this.genreMode === 'ambient') {
                // Gentle pulsing
                coral.material.emissiveIntensity = (metrics.lfo8 * 0.3 + 0.1);
            } else {
                // Subtle response to mid
                coral.material.emissiveIntensity = metrics.mid * 0.2;
            }
        });
    }

    updateFish(metrics) {
        // Boids flocking algorithm
        const cohesionRadius = 5.0;
        const separationRadius = 2.0;
        const alignmentRadius = 4.0;
        
        // Bass causes scatter
        this.scatterForce *= 0.95;
        if (metrics.bassHit > 0.8) {
            this.scatterForce = 1.0;
        }
        
        // Update flock center (follows camera with offset)
        this.flockCenter.lerp(
            new THREE.Vector3(
                this.camera.position.x,
                10 + Math.sin(metrics.lfo8 * Math.PI * 2) * 5,
                this.camera.position.z - 10
            ),
            0.02
        );
        
        this.fish.forEach((fish, idx) => {
            const velocity = fish.userData.velocity;
            
            // Boids forces
            const cohesion = new THREE.Vector3();
            const separation = new THREE.Vector3();
            const alignment = new THREE.Vector3();
            let cohesionCount = 0;
            let separationCount = 0;
            let alignmentCount = 0;
            
            // Check neighbors
            this.fish.forEach((other, otherIdx) => {
                if (idx === otherIdx) return;
                
                const distance = fish.position.distanceTo(other.position);
                
                // Cohesion: steer towards average position
                if (distance < cohesionRadius) {
                    cohesion.add(other.position);
                    cohesionCount++;
                }
                
                // Separation: avoid crowding
                if (distance < separationRadius) {
                    const diff = new THREE.Vector3().subVectors(fish.position, other.position);
                    diff.divideScalar(distance); // Weight by distance
                    separation.add(diff);
                    separationCount++;
                }
                
                // Alignment: match velocity
                if (distance < alignmentRadius) {
                    alignment.add(other.userData.velocity);
                    alignmentCount++;
                }
            });
            
            // Average the forces
            if (cohesionCount > 0) {
                cohesion.divideScalar(cohesionCount);
                cohesion.sub(fish.position);
                cohesion.normalize().multiplyScalar(0.02);
            }
            
            if (separationCount > 0) {
                separation.divideScalar(separationCount);
                separation.normalize().multiplyScalar(0.04);
            }
            
            if (alignmentCount > 0) {
                alignment.divideScalar(alignmentCount);
                alignment.normalize().multiplyScalar(0.01);
            }
            
            // Attraction to flock center
            const toCenter = new THREE.Vector3().subVectors(this.flockCenter, fish.position);
            toCenter.normalize().multiplyScalar(0.015);
            
            // Scatter on bass
            const scatter = new THREE.Vector3(
                (Math.random() - 0.5) * this.scatterForce * 2,
                (Math.random() - 0.5) * this.scatterForce,
                (Math.random() - 0.5) * this.scatterForce * 2
            );
            
            // Ambient current
            const current = new THREE.Vector3(
                Math.sin(this.time * 0.5) * this.config.currentStrength * 0.1,
                0,
                Math.cos(this.time * 0.3) * this.config.currentStrength * 0.1
            );
            
            // Apply forces
            velocity.add(cohesion);
            velocity.add(separation);
            velocity.add(alignment);
            velocity.add(toCenter);
            velocity.add(scatter);
            velocity.add(current);
            
            // Limit speed
            const maxSpeed = 0.5 + metrics.vol * 0.5;
            if (velocity.length() > maxSpeed) {
                velocity.normalize().multiplyScalar(maxSpeed);
            }
            
            // Update position
            fish.position.add(velocity);
            
            // Boundaries (soft repel)
            const boundaryRadius = 50;
            const distFromCenter = fish.position.length();
            if (distFromCenter > boundaryRadius) {
                const repel = new THREE.Vector3().copy(fish.position).normalize().multiplyScalar(-0.1);
                velocity.add(repel);
            }
            
            // Point in direction of travel
            if (velocity.length() > 0.01) {
                const targetRotation = Math.atan2(velocity.x, velocity.z);
                fish.rotation.y = targetRotation;
            }
            
            // Color shift based on genre
            if (this.genreMode === 'electronic') {
                const hue = (idx / this.fish.length + metrics.beatPhase) % 1.0;
                fish.material.color.setHSL(hue, 0.9, 0.5);
                fish.material.emissiveIntensity = 0.5;
            } else {
                fish.material.color.copy(fish.userData.baseColor);
                fish.material.emissiveIntensity = 0.2;
            }
        });
    }

    updateBubbles(metrics) {
        this.bubbles.forEach(bubble => {
            if (!bubble.userData.active) {
                // Spawn on mid hits
                if (metrics.midHit > 0.6 && Math.random() < 0.1) {
                    bubble.userData.active = true;
                    
                    // Spawn from random coral
                    if (this.corals.length > 0) {
                        const coral = this.corals[Math.floor(Math.random() * this.corals.length)];
                        bubble.position.copy(coral.position);
                    }
                    
                    const scale = 0.5 + Math.random() * 1.5;
                    bubble.scale.setScalar(scale);
                }
            } else {
                // Rise and wobble
                bubble.position.y += bubble.userData.speed * (0.5 + metrics.treble * 0.5);
                bubble.position.x += Math.sin(this.time * 2 + bubble.position.y) * 0.1;
                bubble.position.z += Math.cos(this.time * 1.5 + bubble.position.y) * 0.1;
                
                // Fade out as it rises
                const height = bubble.position.y;
                bubble.material.opacity = Math.max(0, 0.5 - (height / 40));
                
                // Reset
                if (height > 35 || bubble.material.opacity <= 0) {
                    bubble.userData.active = false;
                    bubble.position.y = -5;
                }
            }
        });
    }

    updateParticulates(metrics) {
        const positions = this.particulates.geometry.attributes.position.array;
        const colors = this.particulates.geometry.attributes.color.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            // Drift with current
            positions[i] += Math.sin(this.time * 0.3 + i) * 0.02 * this.config.currentStrength;
            positions[i + 2] += Math.cos(this.time * 0.2 + i) * 0.02 * this.config.currentStrength;
            
            // Gentle vertical motion
            positions[i + 1] += Math.sin(this.time + i) * 0.01;
            
            // Wrap around
            if (positions[i] > 50) positions[i] = -50;
            if (positions[i] < -50) positions[i] = 50;
            if (positions[i + 2] > 50) positions[i + 2] = -50;
            if (positions[i + 2] < -50) positions[i + 2] = 50;
            if (positions[i + 1] > 55) positions[i + 1] = -5;
            
            // Bioluminescence on treble
            if (i % 30 === 0 && metrics.highHit > 0.5) {
                const color = new THREE.Color();
                color.setHSL(0.5 + Math.random() * 0.2, 1.0, 0.8);
                colors[i] = color.r;
                colors[i + 1] = color.g;
                colors[i + 2] = color.b;
            }
        }
        
        this.particulates.geometry.attributes.position.needsUpdate = true;
        this.particulates.geometry.attributes.color.needsUpdate = true;
    }

    animate(metrics) {
        this.time += 0.016;

        // ========================================
        // GENRE DETECTION
        // ========================================
        this.detectGenre(metrics);

        // ========================================
        // UPDATE ELEMENTS
        // ========================================
        this.updateCorals(metrics);
        this.updateFish(metrics);
        this.updateBubbles(metrics);
        this.updateParticulates(metrics);

        // ========================================
        // CAUSTIC SHADER
        // ========================================
        this.causticPass.uniforms['time'].value = this.time;
        this.causticPass.uniforms['intensity'].value = this.config.causticIntensity + metrics.treble * 0.2;
        this.causticPass.uniforms['speed'].value = 1.0 + metrics.ramp4 * 0.5;

        // ========================================
        // LIGHTING
        // ========================================
        // Sunlight sways (surface waves)
        this.sunlight.position.x = 10 + Math.sin(this.time * 0.5) * 5;
        this.sunlight.position.z = 10 + Math.cos(this.time * 0.3) * 5;
        
        // Intensity based on presence
        this.sunlight.intensity = 0.6 + metrics.midPresence * 0.4;

        // ========================================
        // CAMERA
        // ========================================
        // Slow drift
        if (this.genreMode === 'ambient') {
            this.camera.position.x += Math.sin(metrics.lfo8 * Math.PI * 2) * 0.05;
            this.camera.position.y += Math.cos(metrics.lfo4 * Math.PI * 2) * 0.03;
            this.camera.rotation.z = Math.sin(metrics.lfo8 * Math.PI * 2) * 0.02;
        } else {
            // Return to neutral
            this.camera.position.x *= 0.98;
            this.camera.position.y += (10 - this.camera.position.y) * 0.05;
            this.camera.rotation.z *= 0.95;
        }
        
        // Look at flock center
        const lookTarget = this.flockCenter.clone();
        this.camera.lookAt(lookTarget);

        // ========================================
        // BLOOM
        // ========================================
        let bloomTarget = this.config.bloomStrength;
        if (this.genreMode === 'electronic') {
            bloomTarget += metrics.bass * 1.0;
        }
        this.bloomPass.strength = bloomTarget;

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}