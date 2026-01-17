import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- ATMOSPHERIC FOG SHADER ---
const AtmosphericShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'fogColor': { value: new THREE.Color(0x1a0a2e) },
        'sunPosition': { value: new THREE.Vector2(0.5, 0.3) },
        'sunIntensity': { value: 1.0 }
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
        uniform vec3 fogColor;
        uniform vec2 sunPosition;
        uniform float sunIntensity;
        varying vec2 vUv;
        
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Sun glow
            float dist = length(vUv - sunPosition);
            float glow = exp(-dist * 3.0) * sunIntensity * 0.25;
            color.rgb += vec3(1.0, 0.6, 0.3) * glow;
            
            // Vignette
            float vignette = 1.0 - smoothstep(0.4, 1.2, length(vUv - 0.5) * 1.5);
            color.rgb *= vignette;
            
            gl_FragColor = color;
        }
    `
};

// --- SIMPLEX NOISE GLSL (for terrain shader) ---
const NOISE_GLSL = `
    // Simplex 2D noise
    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
            + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
            dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    // Fractal Brownian Motion
    float fbm(vec2 p, int octaves) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        
        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * snoise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        return value;
    }
    
    // Ridged multifractal for sharp peaks
    float ridgedMF(vec2 p, int octaves) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        float prev = 1.0;
        
        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            float n = 1.0 - abs(snoise(p * frequency));
            n = n * n;
            n = n * prev;
            prev = n;
            value += n * amplitude;
            amplitude *= 0.5;
            frequency *= 2.2;
        }
        return value;
    }
    
    // Domain warping for organic shapes
    float warpedTerrain(vec2 p, float time) {
        vec2 q = vec2(
            fbm(p + vec2(0.0, 0.0) + time * 0.02, 4),
            fbm(p + vec2(5.2, 1.3), 4)
        );
        
        vec2 r = vec2(
            fbm(p + 4.0 * q + vec2(1.7, 9.2), 4),
            fbm(p + 4.0 * q + vec2(8.3, 2.8), 4)
        );
        
        return fbm(p + 3.0 * r, 6);
    }
`;

export class TerrainDemo {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.8;

        // --- CONFIGURATION ---
        this.config = {
            heightScale: 50,
            noiseScale: 0.008,
            flySpeed: 1.0,
            cameraHeight: 40,
            bloomStrength: 0.0,
            timeOfDay: 0.35, // 0=night, 0.25=dawn, 0.5=noon, 0.75=dusk
            terrainStyle: 0  // 0=mountains, 1=canyons, 2=rolling hills
        };

        this.scene = new THREE.Scene();
        
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 2000);
        this.camera.position.set(0, this.config.cameraHeight, 50);
        this.camera.lookAt(0, 20, -200);

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        this.bloomPass.strength = this.config.bloomStrength;
        this.bloomPass.radius = 0.2;
        this.bloomPass.threshold = 1.75;
        this.composer.addPass(this.bloomPass);

        this.atmospherePass = new ShaderPass(AtmosphericShader);
        this.composer.addPass(this.atmospherePass);

        // --- STATE ---
        this.time = 0;
        this.terrainOffset = 0;
        this.bassImpulse = 0;
        this.midImpulse = 0;

        this.initTerrain();
        this.initSky();
        this.initSun();
        this.initClouds();
        this.initLighting();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Height',
                min: 10, max: 100, step: 5, value: this.config.heightScale,
                onChange: (v) => {
                    this.config.heightScale = v;
                    this.terrainMaterial.uniforms.heightScale.value = v;
                }
            },
            {
                name: 'Scale',
                min: 0.003, max: 0.02, step: 0.001, value: this.config.noiseScale,
                onChange: (v) => {
                    this.config.noiseScale = v;
                    this.terrainMaterial.uniforms.noiseScale.value = v;
                }
            },
            {
                name: 'Speed',
                min: 0, max: 3, step: 0.1, value: this.config.flySpeed,
                onChange: (v) => this.config.flySpeed = v
            },
            {
                name: 'Cam Y',
                min: 15, max: 100, step: 5, value: this.config.cameraHeight,
                onChange: (v) => this.config.cameraHeight = v
            },
            {
                name: 'Time',
                min: 0, max: 1, step: 0.01, value: this.config.timeOfDay,
                onChange: (v) => this.config.timeOfDay = v
            },
            {
                name: 'Bloom',
                min: 0, max: 2, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            },
            {
                name: 'Style',
                min: 0, max: 2, step: 1, value: this.config.terrainStyle,
                onChange: (v) => {
                    this.config.terrainStyle = v;
                    this.terrainMaterial.uniforms.terrainStyle.value = v;
                }
            }
        ];
    }

    initTerrain() {
        // High-res plane for terrain
        const geometry = new THREE.PlaneGeometry(800, 1600, 256, 512);
        geometry.rotateX(-Math.PI / 2);

        this.terrainMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                terrainOffset: { value: 0 },
                heightScale: { value: this.config.heightScale },
                noiseScale: { value: this.config.noiseScale },
                terrainStyle: { value: this.config.terrainStyle },
                bassHit: { value: 0 },
                bassPresence: { value: 0 },
                midHit: { value: 0 },
                // Colors
                colorDeep: { value: new THREE.Color(0x1a3d2e) },
                colorLow: { value: new THREE.Color(0x2d5a3e) },
                colorMid: { value: new THREE.Color(0x4a7a4a) },
                colorHigh: { value: new THREE.Color(0x5a4b35) }, // Darkened slightly
                colorPeak: { value: new THREE.Color(0xc8c8d0) }, // Darkened from pure white
                // Lighting
                sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
                sunColor: { value: new THREE.Color(0xffeedd) },
                ambientColor: { value: new THREE.Color(0x334455) },
                fogColor: { value: new THREE.Color(0x1a0a2e) },
                fogNear: { value: 100 },
                fogFar: { value: 800 }
            },
            vertexShader: `
                ${NOISE_GLSL}
                
                uniform float time;
                uniform float terrainOffset;
                uniform float heightScale;
                uniform float noiseScale;
                uniform int terrainStyle;
                uniform float bassHit;
                
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying float vHeight;
                varying float vSlope;
                varying vec2 vUv;
                
                float getHeight(vec2 p) {
                    float h = 0.0;
                    
                    // Style 0: Mountains - BALANCED
                    if (terrainStyle == 0) {
                        // Base shape (Large smooth hills)
                        float base = fbm(p * 0.5, 4) * 0.5;
                        
                        // Detail (Sharp ridges)
                        // reduced amplitude (0.25) to prevent spikes
                        float ridges = ridgedMF(p * 0.8, 4) * 0.25; 
                        
                        float warp = snoise(p * 0.3 + time * 0.02) * 0.15;
                        h = base + ridges + warp;
                    }
                    // Style 1: Canyons
                    else if (terrainStyle == 1) {
                        float base = fbm(p * 0.4, 4) * 0.4;
                        float canyon = ridgedMF(p * 0.5, 3);
                        h = base - canyon * 0.3;
                    }
                    // Style 2: Rolling
                    else {
                        h = fbm(p * 0.3, 4) * 0.5;
                        h += snoise(p * 0.15) * 0.25;
                    }
                    
                    return clamp(h, -0.9, 0.9);
                }
                
                void main() {
                    vec2 terrainCoord = (position.xz + vec2(0.0, terrainOffset)) * noiseScale;
                    
                    float h = getHeight(terrainCoord);
                    
                    // MOVED AUDIO REACTIVITY:
                    // Removed physical deformation (ripple/bassPresence) from height
                    // This prevents the "glitchy spike" look.
                    
                    vec3 pos = position;
                    pos.y = h * heightScale;
                    
                    vHeight = h;
                    vUv = uv;
                    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
                    
                    // SMOOTHER NORMALS
                    // Increased epsilon (2.0 -> 3.0) to smooth out lighting on sharp peaks
                    float eps = 3.0 / 256.0;
                    float hL = getHeight(terrainCoord - vec2(eps, 0.0));
                    float hR = getHeight(terrainCoord + vec2(eps, 0.0));
                    float hD = getHeight(terrainCoord - vec2(0.0, eps));
                    float hU = getHeight(terrainCoord + vec2(0.0, eps));
                    
                    vec3 normal = normalize(vec3(
                        (hL - hR) * heightScale * 0.5, // Dampened X tilt
                        2.0 * eps / noiseScale,
                        (hD - hU) * heightScale * 0.5  // Dampened Z tilt
                    ));
                    
                    vNormal = normalMatrix * normal;
                    vSlope = 1.0 - normal.y;
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 colorDeep;
                uniform vec3 colorLow;
                uniform vec3 colorMid;
                uniform vec3 colorHigh;
                uniform vec3 colorPeak;
                uniform vec3 sunDirection;
                uniform vec3 sunColor;
                uniform vec3 ambientColor;
                uniform vec3 fogColor;
                uniform float fogNear;
                uniform float fogFar;
                uniform float bassHit;
                
                varying vec3 vWorldPosition;
                varying vec3 vNormal;
                varying float vHeight;
                varying float vSlope;
                
                void main() {
                    // Color Mixing
                    vec3 color;
                    float h = vHeight;
                    
                    if (h < -0.3) color = colorDeep;
                    else if (h < -0.1) color = mix(colorDeep, colorLow, (h + 0.3) / 0.2);
                    else if (h < 0.2) color = mix(colorLow, colorMid, (h + 0.1) / 0.3);
                    else if (h < 0.5) color = mix(colorMid, colorHigh, (h - 0.2) / 0.3);
                    else color = mix(colorHigh, colorPeak, clamp((h - 0.5) / 0.3, 0.0, 1.0));
                    
                    float slopeFactor = smoothstep(0.4, 0.8, vSlope);
                    color = mix(color, colorHigh, slopeFactor * 0.7);
                    
                    // LIGHTING FIX
                    vec3 normal = normalize(vNormal);
                    float NdotL = max(dot(normal, normalize(sunDirection)), 0.0);
                    
                    // CLAMP BRIGHTNESS: Prevent pure white blowout
                    // We multiply NdotL by 0.7 to ensure even direct sunlight isn't blinding
                    vec3 diffuse = sunColor * (NdotL * 0.7); 
                    vec3 ambient = ambientColor;
                    
                    float rim = 1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0);
                    rim = pow(rim, 3.0);
                    
                    vec3 finalColor = color * (ambient + diffuse);
                    finalColor += vec3(0.3, 0.4, 0.6) * rim * 0.2;
                    
                    // AUDIO REACTIVITY (Color Only)
                    // Instead of deforming geometry, we pulse the color brightness
                    if (h > 0.4) {
                        finalColor += vec3(0.2, 0.1, 0.4) * bassHit * (h - 0.4);
                    }
                    
                    // Fog
                    float depth = gl_FragCoord.z / gl_FragCoord.w;
                    float fogFactor = smoothstep(fogNear, fogFar, depth);
                    finalColor = mix(finalColor, fogColor, fogFactor);
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.FrontSide
        });

        this.terrain = new THREE.Mesh(geometry, this.terrainMaterial);
        this.terrain.position.z = -400;
        
        // Disable frustum culling so it doesn't flicker when camera is near edge
        this.terrain.frustumCulled = false; 
        
        this.scene.add(this.terrain);
    }

    initSky() {
        // Gradient sky dome
        const skyGeo = new THREE.SphereGeometry(1000, 32, 32);
        
        this.skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x0a0a2e) },
                bottomColor: { value: new THREE.Color(0x1a0a4e) },
                horizonColor: { value: new THREE.Color(0xff6b35) },
                sunPosition: { value: new THREE.Vector3(0, 0.3, -1) }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform vec3 horizonColor;
                uniform vec3 sunPosition;
                varying vec3 vWorldPosition;
                
                void main() {
                    float h = normalize(vWorldPosition).y;
                    
                    // Gradient from bottom to top
                    vec3 color;
                    if (h < 0.0) {
                        color = bottomColor;
                    } else if (h < 0.15) {
                        color = mix(bottomColor, horizonColor, h / 0.15);
                    } else if (h < 0.3) {
                        color = mix(horizonColor, topColor, (h - 0.15) / 0.15);
                    } else {
                        color = topColor;
                    }
                    
                    // Sun glow
                    vec3 sunDir = normalize(sunPosition);
                    vec3 viewDir = normalize(vWorldPosition);
                    float sunDot = max(dot(viewDir, sunDir), 0.0);
                    float sunGlow = pow(sunDot, 32.0);
                    color += vec3(1.0, 0.7, 0.4) * sunGlow * 0.3;
                    
                    // Wider sun halo
                    float halo = pow(sunDot, 4.0);
                    color += horizonColor * halo * 0.3;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide
        });

        this.sky = new THREE.Mesh(skyGeo, this.skyMaterial);
        this.scene.add(this.sky);
    }

    initSun() {
        this.sunGroup = new THREE.Group();
        
        // Sun disc
        const sunGeo = new THREE.CircleGeometry(60, 64);
        const sunMat = new THREE.MeshBasicMaterial({
            color: 0xffdd88,
            transparent: true,
            opacity: 1.0
        });
        this.sunDisc = new THREE.Mesh(sunGeo, sunMat);
        this.sunGroup.add(this.sunDisc);
        
        // Glow layers
        for (let i = 1; i <= 5; i++) {
            const glowGeo = new THREE.CircleGeometry(60 + i * 20, 64);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xff8844,
                transparent: true,
                opacity: 0.15 / i,
                blending: THREE.AdditiveBlending
            });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.z = -0.1 * i;
            this.sunGroup.add(glow);
        }
        
        this.sunGroup.position.set(0, 150, -800);
        this.scene.add(this.sunGroup);
    }

    initClouds() {
        // Volumetric-ish cloud particles
        const cloudGeo = new THREE.BufferGeometry();
        const cloudCount = 200;
        const positions = [];
        const sizes = [];
        const opacities = [];
        
        for (let i = 0; i < cloudCount; i++) {
            const x = (Math.random() - 0.5) * 1200;
            const y = 80 + Math.random() * 150;
            const z = -200 - Math.random() * 600;
            positions.push(x, y, z);
            sizes.push(50 + Math.random() * 100);
            opacities.push(0.1 + Math.random() * 0.3);
        }
        
        cloudGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        cloudGeo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        cloudGeo.setAttribute('opacity', new THREE.Float32BufferAttribute(opacities, 1));
        
        const cloudMat = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xffeedd) }
            },
            vertexShader: `
                attribute float size;
                attribute float opacity;
                varying float vOpacity;
                void main() {
                    vOpacity = opacity;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                varying float vOpacity;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float alpha = smoothstep(0.5, 0.2, d) * vOpacity;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        this.clouds = new THREE.Points(cloudGeo, cloudMat);
        this.scene.add(this.clouds);
    }

    initLighting() {
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(0x334455, 0.5);
        this.scene.add(this.ambientLight);
        
        // Directional sun light
        this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
        this.sunLight.position.set(100, 200, -100);
        this.scene.add(this.sunLight);
    }

    updateTimeOfDay(tod) {
        // tod: 0-1 cycling through day
        // 0.0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk
        
        let skyTop, skyBottom, horizon, sunColor, fogColor, sunY;
        
        if (tod < 0.2) {
            // Night to dawn
            const t = tod / 0.2;
            skyTop = new THREE.Color(0x0a0a1e).lerp(new THREE.Color(0x1a1a4e), t);
            skyBottom = new THREE.Color(0x0a0a2e).lerp(new THREE.Color(0x2a1a4e), t);
            horizon = new THREE.Color(0x1a1a3e).lerp(new THREE.Color(0xff6b35), t);
            sunColor = new THREE.Color(0xff4400);
            fogColor = new THREE.Color(0x1a0a2e).lerp(new THREE.Color(0x2a1a4e), t);
            sunY = -50 + t * 100;
        } else if (tod < 0.4) {
            // Dawn to day
            const t = (tod - 0.2) / 0.2;
            skyTop = new THREE.Color(0x1a1a4e).lerp(new THREE.Color(0x4488cc), t);
            skyBottom = new THREE.Color(0x2a1a4e).lerp(new THREE.Color(0x88ccee), t);
            horizon = new THREE.Color(0xff6b35).lerp(new THREE.Color(0xaaddff), t);
            sunColor = new THREE.Color(0xff4400).lerp(new THREE.Color(0xffffee), t);
            fogColor = new THREE.Color(0x2a1a4e).lerp(new THREE.Color(0x6688aa), t);
            sunY = 50 + t * 150;
        } else if (tod < 0.6) {
            // Midday
            const t = (tod - 0.4) / 0.2;
            skyTop = new THREE.Color(0x4488cc);
            skyBottom = new THREE.Color(0x88ccee);
            horizon = new THREE.Color(0xaaddff);
            sunColor = new THREE.Color(0xffffee);
            fogColor = new THREE.Color(0x6688aa);
            sunY = 200;
        } else if (tod < 0.8) {
            // Day to dusk
            const t = (tod - 0.6) / 0.2;
            skyTop = new THREE.Color(0x4488cc).lerp(new THREE.Color(0x2a1a4e), t);
            skyBottom = new THREE.Color(0x88ccee).lerp(new THREE.Color(0x4a2a5e), t);
            horizon = new THREE.Color(0xaaddff).lerp(new THREE.Color(0xff6b35), t);
            sunColor = new THREE.Color(0xffffee).lerp(new THREE.Color(0xff6600), t);
            fogColor = new THREE.Color(0x6688aa).lerp(new THREE.Color(0x3a2a4e), t);
            sunY = 200 - t * 150;
        } else {
            // Dusk to night
            const t = (tod - 0.8) / 0.2;
            skyTop = new THREE.Color(0x2a1a4e).lerp(new THREE.Color(0x0a0a1e), t);
            skyBottom = new THREE.Color(0x4a2a5e).lerp(new THREE.Color(0x0a0a2e), t);
            horizon = new THREE.Color(0xff6b35).lerp(new THREE.Color(0x1a1a3e), t);
            sunColor = new THREE.Color(0xff6600).lerp(new THREE.Color(0xff2200), t);
            fogColor = new THREE.Color(0x3a2a4e).lerp(new THREE.Color(0x1a0a2e), t);
            sunY = 50 - t * 100;
        }
        
        // Apply colors
        this.skyMaterial.uniforms.topColor.value = skyTop;
        this.skyMaterial.uniforms.bottomColor.value = skyBottom;
        this.skyMaterial.uniforms.horizonColor.value = horizon;
        
        this.sunDisc.material.color = sunColor;
        this.sunGroup.position.y = sunY;
        
        this.terrainMaterial.uniforms.fogColor.value = fogColor;
        this.terrainMaterial.uniforms.sunColor.value = sunColor;
        this.terrainMaterial.uniforms.ambientColor.value = skyBottom.clone().multiplyScalar(0.3);
        
        this.atmospherePass.uniforms['fogColor'].value = fogColor;
        this.atmospherePass.uniforms['sunPosition'].value.set(0.5, 0.3 + (sunY / 400));
        this.atmospherePass.uniforms['sunIntensity'].value = Math.max(0, sunY / 200);
        
        // Update sun light
        this.sunLight.color = sunColor;
        this.sunLight.intensity = Math.max(0.2, sunY / 150);
    }

    animate(metrics) {
        this.time += 0.016;
        
        // --- AUDIO IMPULSES ---
        this.bassImpulse *= 0.92;
        this.midImpulse *= 0.88;
        
        if (metrics.bassHit > 0.7) {
            this.bassImpulse = 1.0;
        }
        if (metrics.midHit > 0.6) {
            this.midImpulse = 1.0;
        }

        // --- TERRAIN SCROLL ---
        const speed = this.config.flySpeed * (1.0 + metrics.vol * 2.0);
        this.terrainOffset += speed * 2.0;
        
        this.terrainMaterial.uniforms.time.value = this.time;
        this.terrainMaterial.uniforms.terrainOffset.value = this.terrainOffset;
        this.terrainMaterial.uniforms.bassHit.value = this.bassImpulse;
        this.terrainMaterial.uniforms.bassPresence.value = metrics.bassPresence || 0;
        this.terrainMaterial.uniforms.midHit.value = this.midImpulse;

        // --- TIME OF DAY ---
        // LFO8 slowly cycles time of day, or use manual control
        let tod = this.config.timeOfDay;
        // Optionally: tod += metrics.lfo8 * 0.1; // Auto-cycle
        this.updateTimeOfDay(tod);

        // --- SUN PULSE ---
        const sunScale = 1.0 + this.bassImpulse * 0.3;
        this.sunGroup.scale.setScalar(sunScale);

        // --- CLOUD DRIFT ---
        const cloudPos = this.clouds.geometry.attributes.position.array;
        for (let i = 0; i < cloudPos.length; i += 3) {
            cloudPos[i] += 0.2; // Drift right
            cloudPos[i + 2] += speed * 0.5; // Move with terrain
            
            // Wrap
            if (cloudPos[i] > 600) cloudPos[i] = -600;
            if (cloudPos[i + 2] > 100) cloudPos[i + 2] = -800;
        }
        this.clouds.geometry.attributes.position.needsUpdate = true;

        // --- CAMERA ---
        // Height responds to bass presence
        const targetY = this.config.cameraHeight + metrics.bassPresence * 30;
        this.camera.position.y += (targetY - this.camera.position.y) * 0.05;
        
        // Subtle sway with LFOs
        this.camera.position.x = Math.sin(metrics.lfo8 * Math.PI * 2) * 20;
        this.camera.rotation.z = Math.sin(metrics.lfo4 * Math.PI * 2) * 0.02;
        
        // FOV pulse on bass
        const targetFOV = 70 + this.bassImpulse * 10 - metrics.bassPresence * 5;
        this.camera.fov += (targetFOV - this.camera.fov) * 0.1;
        this.camera.updateProjectionMatrix();

        // --- BLOOM ---
        this.bloomPass.strength = this.config.bloomStrength + this.bassImpulse * 0.5;

        // --- FOG DISTANCE (tightens on quiet, expands on loud) ---
        const fogFar = 600 + metrics.vol * 400;
        this.terrainMaterial.uniforms.fogFar.value = fogFar;

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}