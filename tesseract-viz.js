import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class Tesseract {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            rotationSpeed: 0.15,   // Reduced from 0.5 for smoother viewing
            trailLength: 100,      // Number of historical positions
            projectionDist: 3.0,   // 4D → 3D projection distance
            glowIntensity: 1.0,
            scale: 15.0
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 50;

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        this.bloomPass.strength = 2.5;
        this.bloomPass.radius = 0.6;
        this.bloomPass.threshold = 0.0;
        this.composer.addPass(this.bloomPass);

        // --- 4D STATE ---
        this.vertices4D = this.createTesseractVertices();
        this.edges = this.createTesseractEdges();
        
        // Rotation state (4D rotation planes)
        this.rotations = {
            xy: 0,  // Standard 3D-like rotations
            xz: 0,
            xw: 0,  // 4D rotations
            yz: 0,
            yw: 0,
            zw: 0
        };
        
        // Which planes to rotate (changes on beat)
        this.activePlanes = ['xy', 'xw'];
        this.lastBeatTime = 0;
        
        // Trail system
        this.vertexHistory = [];
        for (let i = 0; i < 16; i++) {
            this.vertexHistory[i] = [];
        }
        
        // Visual objects
        this.edgeLines = null;
        this.vertexPoints = [];
        this.trailLines = [];
        
        this.initVisuals();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Speed',
                min: 0, max: 3, step: 0.1, value: this.config.rotationSpeed,
                onChange: (v) => this.config.rotationSpeed = v
            },
            {
                name: 'Trails',
                min: 0, max: 200, step: 10, value: this.config.trailLength,
                onChange: (v) => this.config.trailLength = v
            },
            {
                name: 'Proj Dist',
                min: 1, max: 8, step: 0.1, value: this.config.projectionDist,
                onChange: (v) => this.config.projectionDist = v
            },
            {
                name: 'Glow',
                min: 0, max: 3, step: 0.1, value: this.config.glowIntensity,
                onChange: (v) => this.config.glowIntensity = v
            },
            {
                name: 'Scale',
                min: 5, max: 30, step: 1, value: this.config.scale,
                onChange: (v) => this.config.scale = v
            }
        ];
    }

    createTesseractVertices() {
        // 16 vertices of a tesseract (4D hypercube)
        // All combinations of (±1, ±1, ±1, ±1)
        const vertices = [];
        for (let i = 0; i < 16; i++) {
            vertices.push({
                x: (i & 1) ? 1 : -1,
                y: (i & 2) ? 1 : -1,
                z: (i & 4) ? 1 : -1,
                w: (i & 8) ? 1 : -1
            });
        }
        return vertices;
    }

    createTesseractEdges() {
        // Connect vertices that differ by exactly 1 coordinate
        const edges = [];
        for (let i = 0; i < 16; i++) {
            for (let j = i + 1; j < 16; j++) {
                const v1 = this.vertices4D[i];
                const v2 = this.vertices4D[j];
                
                // Count differing coordinates
                let diff = 0;
                if (v1.x !== v2.x) diff++;
                if (v1.y !== v2.y) diff++;
                if (v1.z !== v2.z) diff++;
                if (v1.w !== v2.w) diff++;
                
                if (diff === 1) {
                    edges.push([i, j]);
                }
            }
        }
        return edges; // 32 edges total
    }

    rotate4D(v, plane, angle) {
        // 4D rotation in a given plane
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const result = { x: v.x, y: v.y, z: v.z, w: v.w };
        
        switch(plane) {
            case 'xy':
                result.x = v.x * c - v.y * s;
                result.y = v.x * s + v.y * c;
                break;
            case 'xz':
                result.x = v.x * c - v.z * s;
                result.z = v.x * s + v.z * c;
                break;
            case 'xw':
                result.x = v.x * c - v.w * s;
                result.w = v.x * s + v.w * c;
                break;
            case 'yz':
                result.y = v.y * c - v.z * s;
                result.z = v.y * s + v.z * c;
                break;
            case 'yw':
                result.y = v.y * c - v.w * s;
                result.w = v.y * s + v.w * c;
                break;
            case 'zw':
                result.z = v.z * c - v.w * s;
                result.w = v.z * s + v.w * c;
                break;
        }
        
        return result;
    }

    project4Dto3D(v) {
        // Stereographic projection from 4D to 3D
        // Projects from a point at distance d along the w-axis
        const d = this.config.projectionDist;
        const scale = this.config.scale;
        
        // Avoid division by zero
        const denominator = d - v.w;
        const factor = denominator !== 0 ? scale / denominator : scale;
        
        return new THREE.Vector3(
            v.x * factor,
            v.y * factor,
            v.z * factor
        );
    }

    initVisuals() {
        // Edge wireframe
        const edgeGeometry = new THREE.BufferGeometry();
        const maxEdges = this.edges.length;
        const positions = new Float32Array(maxEdges * 6); // 2 points per edge * 3 coords
        edgeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        
        this.edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        this.scene.add(this.edgeLines);

        // Vertex points
        const pointGeometry = new THREE.SphereGeometry(0.3, 8, 8);
        for (let i = 0; i < 16; i++) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1.0
            });
            const point = new THREE.Mesh(pointGeometry, material);
            this.vertexPoints.push(point);
            this.scene.add(point);
        }

        // Trail lines (one per vertex)
        for (let i = 0; i < 16; i++) {
            const trailGeometry = new THREE.BufferGeometry();
            const maxTrailLength = 200; // Fixed max size
            const positions = new Float32Array(maxTrailLength * 3);
            trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            trailGeometry.setDrawRange(0, 0);
            
            const trailMaterial = new THREE.LineBasicMaterial({
                color: 0xff00ff,
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending
            });
            
            const trail = new THREE.Line(trailGeometry, trailMaterial);
            this.trailLines.push(trail);
            this.scene.add(trail);
        }
    }

    switchRotationPlanes(metrics) {
        // Deterministic plane selection based on beat pattern
        const planeOptions = [
            ['xy', 'zw'], // Standard rotation
            ['xw', 'yz'], // Full 4D
            ['xz', 'yw'], // Diagonal
            ['xy', 'xw'], // Hybrid
            ['yz', 'zw'], // Y-dominant
            ['xw', 'zw']  // W-dominant (most "alien")
        ];
        
        // Use beatPhase to pick deterministically
        const index = Math.floor(metrics.beatPhase * planeOptions.length);
        this.activePlanes = planeOptions[index % planeOptions.length];
    }

    animate(metrics) {
        // ========================================
        // ROTATION SPEED
        // ========================================
        const baseSpeed = this.config.rotationSpeed * 0.01;
        const beatBoost = metrics.onBeat * 0.005; // Reduced from 0.02 for smoother motion
        const speed = baseSpeed + beatBoost;

        // Increment rotation angles for active planes
        this.activePlanes.forEach(plane => {
            this.rotations[plane] += speed;
        });

        // ========================================
        // DIMENSION SHIFT ON BEAT
        // ========================================
        if (metrics.bassHit > 0.9 && metrics.bassPresence > 0.7) { // Higher thresholds
            const now = performance.now();
            if (now - this.lastBeatTime > 2000) { // Longer cooldown (was 500ms)
                this.switchRotationPlanes(metrics);
                this.lastBeatTime = now;
            }
        }

        // ========================================
        // 4D ROTATION & PROJECTION
        // ========================================
        const rotatedVertices = this.vertices4D.map(v => {
            let rotated = { ...v };
            
            // Apply all active rotations
            Object.keys(this.rotations).forEach(plane => {
                if (this.rotations[plane] !== 0) {
                    rotated = this.rotate4D(rotated, plane, this.rotations[plane]);
                }
            });
            
            return rotated;
        });

        // Project to 3D
        const projected3D = rotatedVertices.map(v => this.project4Dto3D(v));

        // ========================================
        // UPDATE EDGES
        // ========================================
        const edgePositions = this.edgeLines.geometry.attributes.position.array;
        this.edges.forEach((edge, idx) => {
            const [i, j] = edge;
            const p1 = projected3D[i];
            const p2 = projected3D[j];
            
            edgePositions[idx * 6] = p1.x;
            edgePositions[idx * 6 + 1] = p1.y;
            edgePositions[idx * 6 + 2] = p1.z;
            
            edgePositions[idx * 6 + 3] = p2.x;
            edgePositions[idx * 6 + 4] = p2.y;
            edgePositions[idx * 6 + 5] = p2.z;
        });
        this.edgeLines.geometry.attributes.position.needsUpdate = true;

        // Edge color based on rotation activity
        const hue = (metrics.beatPhase * 0.3 + 0.5) % 1.0;
        this.edgeLines.material.color.setHSL(hue, 1.0, 0.5);

        // ========================================
        // UPDATE VERTEX POINTS
        // ========================================
        projected3D.forEach((pos, i) => {
            const point = this.vertexPoints[i];
            point.position.copy(pos);
            
            // Color based on which band hits
            // Vertices 0-5: bass, 6-10: mid, 11-15: high
            let glowColor = new THREE.Color(0xffffff);
            let glowIntensity = 0.5;
            
            if (i < 6 && metrics.bassHit > 0.5) {
                glowColor.setHSL(0.0, 1.0, 0.5); // Red
                glowIntensity = metrics.bassHit * this.config.glowIntensity;
            } else if (i >= 6 && i < 11 && metrics.midHit > 0.5) {
                glowColor.setHSL(0.3, 1.0, 0.5); // Green
                glowIntensity = metrics.midHit * this.config.glowIntensity;
            } else if (i >= 11 && metrics.highHit > 0.5) {
                glowColor.setHSL(0.6, 1.0, 0.5); // Blue
                glowIntensity = metrics.highHit * this.config.glowIntensity;
            }
            
            point.material.color.copy(glowColor);
            point.material.opacity = 0.8 + glowIntensity * 0.1; // Reduced from 0.2
            
            const scale = 1.0 + glowIntensity * 0.8; // Reduced from 2.0 for less jarring size changes
            point.scale.setScalar(scale);
        });

        // ========================================
        // UPDATE TRAILS
        // ========================================
        projected3D.forEach((pos, i) => {
            // Add current position to history
            this.vertexHistory[i].push(pos.clone());
            
            // Limit trail length
            const maxLength = Math.floor(this.config.trailLength);
            if (this.vertexHistory[i].length > maxLength) {
                this.vertexHistory[i].shift();
            }
            
            // Update trail geometry
            const trail = this.trailLines[i];
            const positions = trail.geometry.attributes.position.array;
            const history = this.vertexHistory[i];
            
            for (let j = 0; j < history.length; j++) {
                positions[j * 3] = history[j].x;
                positions[j * 3 + 1] = history[j].y;
                positions[j * 3 + 2] = history[j].z;
            }
            
            trail.geometry.setDrawRange(0, history.length);
            trail.geometry.attributes.position.needsUpdate = true;
            
            // Trail color fades with age
            const trailHue = (hue + i * 0.05) % 1.0;
            trail.material.color.setHSL(trailHue, 1.0, 0.4);
        });

        // ========================================
        // CAMERA
        // ========================================
        // Slow orbit
        const orbitSpeed = 0.0003 + metrics.lfo8 * 0.0005; // Reduced from 0.001/0.002 for much slower orbit
        const orbitRadius = 50 + metrics.bassPresence * 10;
        const orbitAngle = performance.now() * orbitSpeed;
        
        this.camera.position.x = Math.sin(orbitAngle) * orbitRadius;
        this.camera.position.z = Math.cos(orbitAngle) * orbitRadius;
        this.camera.position.y = Math.sin(metrics.lfo4 * Math.PI * 2) * 10;
        this.camera.lookAt(0, 0, 0);
        
        // FOV pulse on beat
        const targetFOV = 75 + metrics.onBeat * 3; // Reduced from 10 for subtler pulse
        this.camera.fov += (targetFOV - this.camera.fov) * 0.1;
        this.camera.updateProjectionMatrix();

        // ========================================
        // BLOOM
        // ========================================
        const avgHit = (metrics.bassHit + metrics.midHit + metrics.highHit) / 3;
        this.bloomPass.strength = 2.5 + avgHit * this.config.glowIntensity * 0.5; // Reduced from 2.0 multiplier

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}