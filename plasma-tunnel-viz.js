import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CUSTOM SHADER: PLASMA TUNNEL ---
const PlasmaTunnelShader = {
    uniforms: {
        'time': { value: 0.0 },
        'turbulence': { value: 1.0 },
        'colorPhase': { value: 0.0 },
        'beatPulse': { value: 0.0 },
        'hotColor': { value: new THREE.Color(0xff3300) },  // Orange/Red
        'coldColor': { value: new THREE.Color(0x0088ff) }, // Blue
        'speed': { value: 1.0 }
    },
    vertexShader: `
        uniform float time;
        uniform float turbulence;
        uniform float beatPulse;
        uniform float speed;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying float vDisplacement;

        // 3D Perlin Noise (Simplified - production would use a texture)
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

        float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            
            i = mod289(i);
            vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
            
            float n_ = 0.142857142857;
            vec3 ns = n_ * D.wyz - D.xzx;
            
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
            
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }

        void main() {
            vUv = uv;
            vNormal = normalMatrix * normal;
            
            // --- THE FIX: WORLD SPACE COORDINATES ---
            // Convert local vertex position to world position
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            
            // Use worldPos.xyz for the noise instead of just 'position'
            // This makes the texture continuous across different segments
            vec3 noisePos = worldPos.xyz; 
            
            float scrollTime = time * speed;
            
            // Lower the frequency slightly (0.3 -> 0.2) to make the features larger/smoother
            // Note we use 'noisePos' here now
            float noise1 = snoise(noisePos * 0.2 + vec3(0.0, scrollTime * 0.5, 0.0));
            float noise2 = snoise(noisePos * 0.6 + vec3(scrollTime, 0.0, scrollTime * 0.3));
            float noise3 = snoise(noisePos * 1.5 + vec3(0.0, scrollTime * 1.5, 0.0));
            
            float displacement = (noise1 * 0.6 + noise2 * 0.3 + noise3 * 0.1) * turbulence;
            
            // Beat pulse (keep this logic)
            displacement -= beatPulse * 2.0;
            
            vDisplacement = displacement;
            
            // Apply displacement to the LOCAL position for the final shape
            vec3 newPosition = position + normal * displacement;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 hotColor;
        uniform vec3 coldColor;
        uniform float colorPhase;
        uniform float time;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying float vDisplacement;

        void main() {
            // Color gradient based on displacement and phase
            float colorMix = (vDisplacement + 1.0) * 0.5; // Normalize to 0-1
            colorMix = colorMix * 0.7 + colorPhase * 0.3;
            
            vec3 baseColor = mix(coldColor, hotColor, colorMix);
            
            // Edge glow (based on normal facing camera)
            vec3 viewDirection = normalize(vec3(0.0, 0.0, 1.0));
            float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDirection)), 2.0);
            
            // Pulsing energy veins
            float veinPattern = sin(vUv.y * 50.0 + time * 2.0) * 0.5 + 0.5;
            veinPattern = pow(veinPattern, 3.0);
            
            vec3 finalColor = baseColor * (1.0 + fresnel * 0.5) + vec3(veinPattern * 0.3);
            
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `
};

export class PlasmaTunnel {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            tunnelSpeed: 1.5,
            turbulence: 2.0,
            arcFrequency: 0.5,  // 0-1, chance to spawn arc
            bloomStrength: 0.0,  // 0 by default - user can increase manually
            cameraShake: 1.0
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.Fog(0x000000, 30, 300); // See ahead but hide distant segments

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 20; // Start well inside the first tunnel segment

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        this.bloomPass.strength = this.config.bloomStrength;
        this.bloomPass.radius = 0.8;
        this.bloomPass.threshold = 0.6; // Higher threshold = even less bloom (was 0.4)
        this.composer.addPass(this.bloomPass);

        // --- STATE ---
        this.time = 0;
        this.beatPulse = 0;
        this.colorPhase = 0;
        this.arcs = [];
        this.cameraOffset = new THREE.Vector3(0, 0, 0);
        
        this.initTunnel();
        this.initArcs();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Speed',
                min: 0, max: 5, step: 0.1, value: this.config.tunnelSpeed,
                onChange: (v) => this.config.tunnelSpeed = v
            },
            {
                name: 'Turbulence',
                min: 0, max: 5, step: 0.1, value: this.config.turbulence,
                onChange: (v) => this.config.turbulence = v
            },
            {
                name: 'Arc Freq',
                min: 0, max: 1, step: 0.05, value: this.config.arcFrequency,
                onChange: (v) => this.config.arcFrequency = v
            },
            {
                name: 'Bloom',
                min: 0, max: 4, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Shake',
                min: 0, max: 3, step: 0.1, value: this.config.cameraShake,
                onChange: (v) => this.config.cameraShake = v
            }
        ];
    }

    initTunnel() {
        // Create 3 tunnel segments for seamless looping
        this.tunnelSegments = [];
        const segmentLength = 120;
        
        for (let i = 0; i < 8; i++) {
            const geometry = new THREE.CylinderGeometry(
                10,    // radiusTop
                10,    // radiusBottom
                segmentLength,   // height of each segment
                32,    // radialSegments
                60,    // heightSegments
                true   // openEnded
            );
            
            // Rotate to face down -Z axis
            geometry.rotateX(Math.PI / 2);

            const material = new THREE.ShaderMaterial({
                uniforms: THREE.UniformsUtils.clone(PlasmaTunnelShader.uniforms),
                vertexShader: PlasmaTunnelShader.vertexShader,
                fragmentShader: PlasmaTunnelShader.fragmentShader,
                side: THREE.BackSide,
                wireframe: false
            });

            const segment = new THREE.Mesh(geometry, material);
            // Position segments: camera starts at z=20, so position segments to surround it
            // Segment 0: z=20 (extends from -40 to 80) - camera is in this one
            // Segment 1: z=-100 (extends from -160 to -40)
            // Segment 2: z=-220 (extends from -280 to -160)
            segment.position.z = 20 - (i * segmentLength);
            segment.userData.segmentLength = segmentLength;
            
            this.tunnelSegments.push(segment);
            this.scene.add(segment);
        }
    }

    initArcs() {
        // Pre-allocate arc pool
        for (let i = 0; i < 20; i++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(60); // 20 segments * 3
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.0,
                blending: THREE.AdditiveBlending,
                linewidth: 2
            });
            
            const line = new THREE.Line(geometry, material);
            line.active = false;
            this.arcs.push(line);
            this.scene.add(line);
        }
    }

    spawnArc(metrics) {
        const arc = this.arcs.find(a => !a.active);
        if (!arc) return;
        
        arc.active = true;
        arc.life = 1.0;
        
        // Random point on tunnel wall
        const angle = Math.random() * Math.PI * 2;
        // Spawn ahead of camera in visible range
        const z = this.camera.position.z - 40 - Math.random() * 30;
        const radius = 8 + metrics.turbulence * 0.5;
        
        const startX = Math.cos(angle) * radius;
        const startY = Math.sin(angle) * radius;
        
        // Arc to center with some randomness
        const positions = arc.geometry.attributes.position.array;
        const segments = positions.length / 3;
        
        for (let i = 0; i < segments; i++) {
            const t = i / (segments - 1);
            
            // Bezier curve to center
            const controlX = startX * (1 - t * 0.5) + (Math.random() - 0.5) * 2;
            const controlY = startY * (1 - t * 0.5) + (Math.random() - 0.5) * 2;
            
            positions[i * 3] = startX * (1 - t) + controlX * t;
            positions[i * 3 + 1] = startY * (1 - t) + controlY * t;
            positions[i * 3 + 2] = z;
        }
        
        arc.geometry.attributes.position.needsUpdate = true;
        
        // Color based on centroid
        const hue = metrics.centroid * 0.3 + 0.5; // Blue to cyan
        arc.material.color.setHSL(hue, 1.0, 0.7);
    }

    animate(metrics) {
        this.time += 0.016;

        // ========================================
        // BEAT PULSE
        // ========================================
        this.beatPulse *= 0.92;
        if (metrics.onBeat > 0.7 && metrics.bassHit > 0.5) {
            this.beatPulse = 0.6; // Reduced from 1.0 for less jarring contraction
        }

        // ========================================
        // COLOR PHASE
        // ========================================
        // Shift from hot (bass heavy) to cold (treble heavy)
        const targetPhase = 1.0 - (metrics.bassPresence * 0.7 + 0.3);
        this.colorPhase += (targetPhase - this.colorPhase) * 0.05;

        // ========================================
        // TUNNEL SHADER UNIFORMS
        // ========================================
        // Update all tunnel segments
        this.tunnelSegments.forEach(segment => {
            const segmentLength = segment.userData.segmentLength;
            const halfLength = segmentLength / 2;

            // FIX: Subtract halfLength. 
            // Only recycle if camera has passed the ENTIRE segment (exited the far side)
            if (this.camera.position.z < segment.position.z - halfLength) {
                
                // Find the frontmost segment (most negative z)
                // We map to get all Z positions, then find the minimum
                let frontmostZ = Math.min(...this.tunnelSegments.map(s => s.position.z));
                
                // Move this segment ahead of the frontmost one to ensure perfect continuity
                segment.position.z = frontmostZ - segmentLength;
            }
        });

        // ========================================
        // ELECTRIC ARCS
        // ========================================
        // Spawn on high hits
        if (metrics.highHit > 0.7 && Math.random() < this.config.arcFrequency) {
            this.spawnArc(metrics);
        }
        
        // Update existing arcs
        this.arcs.forEach(arc => {
            if (!arc.active) return;
            
            arc.life *= 0.95;
            arc.material.opacity = arc.life * 0.4;
            
            // Deactivate if faded or too far behind camera
            if (arc.life < 0.05 || arc.geometry.attributes.position.array[2] > this.camera.position.z + 50) {
                arc.active = false;
                arc.material.opacity = 0.0;
            }
        });

        // ========================================
        // CAMERA MOVEMENT
        // ========================================
        // Forward motion through tunnel
        const forwardSpeed = (this.config.tunnelSpeed + metrics.vol * 2.0) * 0.5;
        this.camera.position.z -= forwardSpeed;

        // LOOP LOGIC
        // We define the specific Z position where a segment is "dead"
        // Since segment length is 120, half is 60.
        // We add an extra buffer (-20) to ensure it is REALLY behind the camera.
        const recyclingThreshold = this.camera.position.z + 80; 

        this.tunnelSegments.forEach(segment => {
            // Check if the segment is fully behind the camera (positive Z relative to camera)
            // We use > because as we move negative, things "behind" us have higher Z values.
            if (segment.position.z > recyclingThreshold) {
                
                // Find the furthest segment ahead (lowest Z value)
                const frontmostZ = Math.min(...this.tunnelSegments.map(s => s.position.z));
                
                // Snap this segment to the front
                segment.position.z = frontmostZ - 120; // 120 is fixed segment length
            }
        });
        
        // Beat shake
        if (this.beatPulse > 0.5) {
            const shake = this.beatPulse * this.config.cameraShake;
            this.cameraOffset.x = (Math.random() - 0.5) * shake;
            this.cameraOffset.y = (Math.random() - 0.5) * shake;
        }
        
        // Smooth return to center
        this.cameraOffset.multiplyScalar(0.9);
        this.camera.position.x += this.cameraOffset.x;
        this.camera.position.y += this.cameraOffset.y;
        
        // Return to center laterally
        this.camera.position.x *= 0.95;
        this.camera.position.y *= 0.95;
        
        // Slight roll during quiet sections
        if (metrics.vol < 0.3) {
            this.camera.rotation.z = Math.sin(metrics.lfo8 * Math.PI * 2) * 0.05;
        } else {
            this.camera.rotation.z *= 0.95;
        }
        
        // FOV breathing
        const targetFOV = 75 + metrics.bassPresence * 15 - this.beatPulse * 5;
        this.camera.fov += (targetFOV - this.camera.fov) * 0.1;
        this.camera.updateProjectionMatrix();

        // ========================================
        // BLOOM
        // ========================================
        this.bloomPass.strength = this.config.bloomStrength; // Manual control only, no bass boost

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}