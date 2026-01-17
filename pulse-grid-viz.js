import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class PulseGrid {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // --- MANUAL CONFIG ---
        this.config = {
            gridSpeed: 1.0,
            warpAmount: 15.0,
            fov: 80,
            bloomStrength: 2.5,
            objectSpeed: 1.0
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0010); // Deep Purple Void
        this.scene.fog = new THREE.Fog(0x0a0010, 50, 250);

        this.camera = new THREE.PerspectiveCamera(this.config.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 15, 60);

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = this.config.bloomStrength;
        this.bloomPass.radius = 0.4;
        this.bloomPass.threshold = 0.1;
        this.composer.addPass(this.bloomPass);

        this.shockwaves = []; 
        this.objects = []; 
        
        this.paletteTime = 0;

        this.initGrids();
        this.initObjects();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Speed',
                min: 0, max: 4, step: 0.1, value: this.config.gridSpeed,
                onChange: (v) => this.config.gridSpeed = v
            },
            {
                name: 'Warp',
                min: 0, max: 40, step: 1, value: this.config.warpAmount,
                onChange: (v) => this.config.warpAmount = v
            },
            {
                name: 'Bloom',
                min: 0, max: 4, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Obj Spd',
                min: 0, max: 3, step: 0.1, value: this.config.objectSpeed,
                onChange: (v) => this.config.objectSpeed = v
            }
        ];
    }

    initGrids() {
        const geometry = new THREE.PlaneGeometry(400, 400, 60, 60);
        geometry.rotateX(-Math.PI / 2);
        
        const count = geometry.attributes.position.count;
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

        // SHARED MATERIAL: Used for both Grid AND Spikes to make them visually indistinct
        this.gridMaterial = new THREE.MeshBasicMaterial({ 
            vertexColors: true, 
            wireframe: true, 
            transparent: true, 
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });
        
        this.floor = new THREE.Mesh(geometry.clone(), this.gridMaterial);
        this.floor.position.y = -20;
        this.scene.add(this.floor);

        this.ceiling = new THREE.Mesh(geometry.clone(), this.gridMaterial);
        this.ceiling.position.y = 50;
        this.scene.add(this.ceiling);
        
        this.floor.originalPos = this.floor.geometry.attributes.position.array.slice();
        this.ceiling.originalPos = this.ceiling.geometry.attributes.position.array.slice();
    }

    initObjects() {
        // GEOMETRY: Massive jagged spikes (Tetrahedrons)
        // Radius: 15, Height: 80, RadialSegments: 4 (Pyramid)
        const geo = new THREE.ConeGeometry(15, 80, 4, 1, true); 
        
        // MATERIAL: Clone the grid material but disable vertexColors 
        // (we will set the solid color in animate loop to match the gradient)
        const mat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, // Will be overridden
            wireframe: true, 
            transparent: true, 
            opacity: 0.6,    // Slightly ghostlier
            blending: THREE.AdditiveBlending
        });
        
        for(let i=0; i<16; i++) {
            const obj = new THREE.Mesh(geo, mat.clone());
            obj.position.set(0, -1000, 0); 
            obj.active = false;
            this.objects.push(obj);
            this.scene.add(obj);
        }
    }

    spawnObject() {
        const obj = this.objects.find(o => !o.active);
        if(!obj) return;

        obj.active = true;
        
        // Decide: Floor (Stalagmite) or Ceiling (Stalactite)?
        const isCeiling = Math.random() > 0.5;
        
        // Position X: Random lanes
        const width = 30 + Math.random() * 80;
        const side = Math.random() > 0.5 ? 1 : -1;
        
        obj.position.x = side * width;
        obj.position.z = -300; // Start far back
        
        if (isCeiling) {
            obj.position.y = 50;
            obj.rotation.x = 0; // Point Down (Cone default is tip up, wait... ThreeJS Cone tip is Y+. We need to flip)
            obj.rotation.z = Math.PI; // Flip upside down for ceiling
        } else {
            obj.position.y = -20;
            obj.rotation.x = 0;
            obj.rotation.z = 0; // Point Up
        }
        
        // Randomize rotation slightly for "Jagged" natural look
        obj.rotation.y = Math.random() * Math.PI;
    }

    animate(metrics) {
        this.paletteTime += 0.005;

        // 1. GRID MOVEMENT
        const speed = (this.config.gridSpeed + metrics.vol * 2.0);
        const limit = 400 / 60; 
        
        this.floor.position.z = (this.floor.position.z + speed) % limit;
        this.ceiling.position.z = this.floor.position.z;

        // 2. SPAWN LOGIC
        if (metrics.bassHit > 0.8) {
            this.shockwaves.push({ z: -80, strength: 1.0, width: 20 });
            this.camera.position.y += 2.0; 
        }

        // Spawn Spikes
        if (metrics.midHit > 0.6 && Math.random() > 0.5) {
            this.spawnObject();
        }

        // Process Shockwaves
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.z += speed * 2.0 + 2.0; 
            wave.strength *= 0.96; 
            if (wave.z > 100 || wave.strength < 0.01) this.shockwaves.splice(i, 1);
        }

        // 3. COLOR PALETTE CALCULATION
        const color1 = new THREE.Color(0xff00cc); // Magenta
        const color2 = new THREE.Color(0x00aaff); // Cyan
        const baseColor = new THREE.Color().lerpColors(color1, color2, (Math.sin(this.paletteTime) + 1) / 2);

        // 4. UPDATE GRIDS
        this.displaceAndColor(this.floor, 1.0, baseColor, metrics);
        this.displaceAndColor(this.ceiling, -1.0, baseColor, metrics);

        // 5. UPDATE OBJECTS (STALAGMITES/STALACTITES)
        this.objects.forEach(obj => {
            if(!obj.active) return;
            
            // Move with grid
            obj.position.z += speed * this.config.objectSpeed + 1.0;
            
            // SYNC COLOR: Make them visually indistinct from grid
            // We use the same baseColor we calculated for the floor
            obj.material.color.copy(baseColor);
            
            // Pulse Width on beat (Warp effect)
            const s = 1.0 + (metrics.mid * 0.3);
            obj.scale.set(s, 1, s); // Don't scale Y, only thickness
            
            // Reset
            if (obj.position.z > 100) {
                obj.active = false;
                obj.position.y = -1000;
            }
        });

        // 6. CAMERA
        this.camera.position.y += (15 - this.camera.position.y) * 0.1;
        this.camera.rotation.z = Math.sin(this.paletteTime * 0.5) * 0.05;

        // Bloom
        this.bloomPass.strength = this.config.bloomStrength + (metrics.bass * 1.0);

        this.composer.render();
    }

    displaceAndColor(mesh, direction, baseColor, metrics) {
        const positions = mesh.geometry.attributes.position.array;
        const colors = mesh.geometry.attributes.color.array;
        const original = mesh.originalPos;
        const white = new THREE.Color(0xffffff);

        for (let i = 0; i < positions.length; i += 3) {
            const yIndex = i + 1;
            const x = original[i];
            const z = original[i + 2];
            
            const worldZ = z + mesh.position.z;
            
            let displacement = 0;
            let highlight = 0;

            this.shockwaves.forEach(wave => {
                const dist = Math.abs(worldZ - wave.z);
                if (dist < wave.width) { 
                    const normDist = dist / wave.width; 
                    const bump = Math.exp(-4 * normDist * normDist); 
                    const amount = bump * wave.strength * this.config.warpAmount;
                    displacement += amount;
                    highlight += bump * wave.strength; 
                }
            });

            positions[yIndex] = original[yIndex] + (displacement * direction);

            const finalColor = baseColor.clone();
            if (highlight > 0.1) finalColor.lerp(white, highlight); 
            
            const distFactor = THREE.MathUtils.smoothstep(worldZ, -200, -50);
            finalColor.multiplyScalar(distFactor);

            colors[i] = finalColor.r;
            colors[i + 1] = finalColor.g;
            colors[i + 2] = finalColor.b;
        }
        
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.attributes.color.needsUpdate = true;
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}