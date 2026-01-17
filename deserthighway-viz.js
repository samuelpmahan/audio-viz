import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- CUSTOM SHADER: ENHANCED HEAT HAZE ---
const HeatHazeShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'time': { value: 0.0 },
        'strength': { value: 0.003 },
        'frequency': { value: 1.0 }
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
        uniform float time;
        uniform float strength;
        uniform float frequency;
        varying vec2 vUv;
        void main() {
            vec2 distortedUv = vUv;
            float offset = sin(vUv.y * 20.0 * frequency + time * 10.0) * strength;
            distortedUv.x += offset;
            gl_FragColor = texture2D(tDiffuse, distortedUv);
        }
    `
};

export class HotelCalifornia {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x22052b, 0.0015);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
        this.camera.position.z = 100;
        this.camera.position.y = 10;

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = 1.6; 
        this.bloomPass.radius = 0.8;   
        this.bloomPass.threshold = 0.15;  
        this.composer.addPass(this.bloomPass);

        this.hazePass = new ShaderPass(HeatHazeShader);
        this.composer.addPass(this.hazePass);

        // --- OBJECTS ---
        this.lightGroup = null;
        this.lightCore = null;
        this.lightHalo = null;
        this.lightRays = null;
        
        this.roadParticles = null;
        this.skyParticles = null;
        this.desertDust = null;
        this.moonGlow = null;
        
        this.initTheLight();
        this.initRoad();
        this.initSky();
        this.initDesertDust();
        this.initMoonGlow();

        // --- STATE (ENHANCED) ---
        this.time = 0;
        
        // Multi-band impulses
        this.bassImpulse = 0;
        this.midImpulse = 0;
        this.highImpulse = 0;
        
        // Anticipation tracking
        this.dustBuildUp = 0;
        
        // Time of day (0 = dawn, 0.25 = noon, 0.5 = sunset, 0.75 = night, 1.0 = dawn)
        this.timeOfDay = 0.5; // Start at sunset
        
        // Genre detection
        this.genreMode = 'neutral';
        this.genreCheckTimer = 0;

        window.addEventListener('resize', () => this.resize());
    }

    createStarburstTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        const cx = 512; 
        const cy = 512;

        ctx.clearRect(0, 0, 1024, 1024);

        const gradient = ctx.createRadialGradient(cx, cy, 20, cx, cy, 300);
        gradient.addColorStop(0, 'rgba(255, 255, 220, 1)'); 
        gradient.addColorStop(0.5, 'rgba(255, 180, 50, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1024, 1024);

        ctx.translate(cx, cy);
        ctx.fillStyle = 'rgba(255, 220, 150, 0.8)';
        for (let i = 0; i < 12; i++) {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(30, -500); 
            ctx.lineTo(-30, -500); 
            ctx.fill();
            ctx.rotate((Math.PI * 2) / 12);
        }
        
        return new THREE.CanvasTexture(canvas);
    }

    initTheLight() {
        this.lightGroup = new THREE.Group();
        this.lightGroup.position.set(0, 0, -1000);

        // Horizon clipping shader
        const setupHorizonClipping = (material) => {
            material.onBeforeCompile = (shader) => {
                shader.vertexShader = `
                    varying float vWorldY;
                    ${shader.vertexShader}
                `.replace(
                    '#include <worldpos_vertex>',
                    `
                    #include <worldpos_vertex>
                    vWorldY = (modelMatrix * vec4(position, 1.0)).y;
                    `
                );
                shader.fragmentShader = `
                    varying float vWorldY;
                    ${shader.fragmentShader}
                `.replace(
                    '#include <alphatest_fragment>',
                    `
                    #include <alphatest_fragment>
                    float horizonClip = smoothstep(-25.0, -15.0, vWorldY);
                    diffuseColor.a *= horizonClip;
                    `
                );
            };
        };

        // Core
        const coreGeo = new THREE.SphereGeometry(40, 32, 32);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        setupHorizonClipping(coreMat);
        this.lightCore = new THREE.Mesh(coreGeo, coreMat);
        this.lightGroup.add(this.lightCore);

        // Halo
        const haloGeo = new THREE.SphereGeometry(120, 32, 32);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0xff6600, 
            transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, toneMapped: false
        });
        setupHorizonClipping(haloMat);
        this.lightHalo = new THREE.Mesh(haloGeo, haloMat);
        this.lightGroup.add(this.lightHalo);

        // Rays
        const rayGeo = new THREE.PlaneGeometry(800, 800);
        const rayTexture = this.createStarburstTexture();
        const rayMat = new THREE.MeshBasicMaterial({
            map: rayTexture, color: 0xffdd77, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        setupHorizonClipping(rayMat);
        this.lightRays = new THREE.Mesh(rayGeo, rayMat);
        this.lightGroup.add(this.lightRays);

        this.scene.add(this.lightGroup);
    }

    initRoad() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const color = new THREE.Color();
        const count = 3000;
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 800; 
            const y = -20 - (Math.random() * 5); 
            const z = (Math.random() * 2000) - 1000;
            positions.push(x, y, z);
            if (Math.random() > 0.9) color.setHex(0xffaa00); 
            else color.setHex(0x550000); 
            colors.push(color.r, color.g, color.b);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: 2.5, vertexColors: true, transparent: true, opacity: 0.8
        });
        this.roadParticles = new THREE.Points(geometry, material);
        this.scene.add(this.roadParticles);
    }

    initSky() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const count = 2000;
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 2000;
            const y = 50 + Math.random() * 800;
            const z = (Math.random() * 2000) - 1000;
            positions.push(x, y, z);
            if (Math.random() > 0.5) colors.push(0.5, 0.7, 1.0);
            else colors.push(0.7, 0.5, 0.9);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: 3.0, vertexColors: true, transparent: true, opacity: 0.6, sizeAttenuation: false
        });
        this.skyParticles = new THREE.Points(geometry, material);
        this.scene.add(this.skyParticles);
    }

    initDesertDust() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const count = 1000;
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 1000;
            const y = -25 + Math.random() * 60;
            const z = (Math.random() * 1500) - 500;
            positions.push(x, y, z);
            colors.push(0.8, 0.6, 0.4);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: 1.5, vertexColors: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending
        });
        this.desertDust = new THREE.Points(geometry, material);
        this.scene.add(this.desertDust);
    }

    initMoonGlow() {
        const moonGeo = new THREE.SphereGeometry(60, 32, 32);
        const moonMat = new THREE.MeshBasicMaterial({
            color: 0xccddff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, toneMapped: false
        });
        this.moonGlow = new THREE.Mesh(moonGeo, moonMat);
        this.moonGlow.position.set(-300, 300, -800);
        this.scene.add(this.moonGlow);
    }

    detectGenre(metrics) {
        this.genreCheckTimer += 0.016;
        if (this.genreCheckTimer < 2.0) return;
        this.genreCheckTimer = 0;

        if (metrics.bassPresence > 0.7 && metrics.bpm > 120 && metrics.bpm < 180) {
            this.genreMode = 'electronic';
        } else if (metrics.highPresence > 0.6 && metrics.bassPresence < 0.3 && metrics.bpm < 100) {
            this.genreMode = 'ambient';
        } else {
            this.genreMode = 'neutral';
        }
    }

    getTimeOfDayColors(timeOfDay) {
        // timeOfDay: 0-1 (0=dawn, 0.25=day, 0.5=sunset, 0.75=night, 1.0=dawn)
        const tod = timeOfDay % 1.0;
        
        let sunHue, sunSat, sunLight;
        let skyColor, fogColor;
        
        if (tod < 0.25) {
            // Dawn (0 - 0.25)
            const t = tod / 0.25;
            sunHue = 0.08; // Orange
            sunSat = 1.0;
            sunLight = 0.5 + (t * 0.3);
            skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0x1a0a2e), // Dark purple
                new THREE.Color(0x4a2a5e), // Purple dawn
                t
            );
            fogColor = skyColor.clone();
        } else if (tod < 0.5) {
            // Day to Sunset (0.25 - 0.5)
            const t = (tod - 0.25) / 0.25;
            sunHue = 0.1 - (t * 0.02); // Yellow to orange
            sunSat = 0.9 + (t * 0.1);
            sunLight = 0.8 - (t * 0.1);
            skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0x87ceeb), // Sky blue
                new THREE.Color(0xff6b35), // Sunset orange
                t
            );
            fogColor = new THREE.Color().lerpColors(
                new THREE.Color(0x6a92b8),
                new THREE.Color(0x4a2060),
                t
            );
        } else if (tod < 0.75) {
            // Sunset to Night (0.5 - 0.75)
            const t = (tod - 0.5) / 0.25;
            sunHue = 0.05 - (t * 0.05); // Deep orange to red
            sunSat = 1.0;
            sunLight = 0.7 - (t * 0.5);
            skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0xff6b35), // Sunset
                new THREE.Color(0x0a0a2e), // Night
                t
            );
            fogColor = new THREE.Color().lerpColors(
                new THREE.Color(0x4a2060),
                new THREE.Color(0x0a0a1e),
                t
            );
        } else {
            // Night to Dawn (0.75 - 1.0)
            const t = (tod - 0.75) / 0.25;
            sunHue = 0.0;
            sunSat = 0.8;
            sunLight = 0.2 + (t * 0.3);
            skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0x0a0a2e), // Night
                new THREE.Color(0x1a0a2e), // Pre-dawn
                t
            );
            fogColor = skyColor.clone();
        }
        
        return { sunHue, sunSat, sunLight, skyColor, fogColor };
    }

    animate(metrics) {
        this.time += 0.01;

        // ========================================
        // GENRE DETECTION
        // ========================================
        this.detectGenre(metrics);

        // ========================================
        // MULTI-BAND IMPULSE TRACKING
        // ========================================
        this.bassImpulse *= 0.9;
        this.midImpulse *= 0.85;
        this.highImpulse *= 0.92;

        if (metrics.bassHit > 0.8) {
            const anticipation = 1.0 + Math.min(2.0, metrics.bassTime / 2000);
            this.bassImpulse = 1.0 * anticipation;
        }
        if (metrics.midHit > 0.8) {
            this.midImpulse = 1.0;
        }
        if (metrics.highHit > 0.8) {
            this.highImpulse = 1.0;
        }

        // ========================================
        // TIME OF DAY SYSTEM
        // ========================================
        // LFO8 drives slow day/night cycle
        // BassPresence modulates towards sunset (heavy bass = golden hour)
        let targetTimeOfDay = metrics.lfo8;
        
        if (this.genreMode === 'electronic') {
            // Electronic = Vibrant sunset lock
            targetTimeOfDay = 0.5 + (metrics.bassPresence * 0.1);
        } else if (this.genreMode === 'ambient') {
            // Ambient = Slow twilight drift
            targetTimeOfDay = 0.6 + (metrics.lfo8 * 0.2);
        }
        
        this.timeOfDay += (targetTimeOfDay - this.timeOfDay) * 0.02;
        
        const { sunHue, sunSat, sunLight, skyColor, fogColor } = this.getTimeOfDayColors(this.timeOfDay);

        // ========================================
        // SUN/LIGHT ANIMATION
        // ========================================

        // Sun elevation follows a proper day/night cycle
        // cos wave centered at 0.25 (noon) gives us the right arc
        const sunElevation = Math.cos(2 * Math.PI * (this.timeOfDay - 0.25));
        const sunVerticalPos = sunElevation * 80 - 20; // -100 (night) to 60 (noon)

        const sunHorizontalPos = .5;

        this.lightGroup.position.x = sunHorizontalPos;
        this.lightGroup.position.y = sunVerticalPos; // Now moves up/down!
        this.lightGroup.position.z = -1000;

        // Scale pulse on bass
        const scale = 1.0 + (this.bassImpulse * 0.4);
        this.lightCore.scale.set(scale, scale, scale);
        this.lightHalo.scale.set(scale * 1.2, scale * 1.2, scale * 1.2);

        // Ray rotation and shimmer
        this.lightRays.rotation.z += 0.005;
        this.lightRays.material.opacity = 0.7 + (Math.random() * this.bassImpulse * 0.3);

        // Color based on time of day
        this.lightCore.material.color.setHSL(sunHue, sunSat, sunLight);
        this.lightHalo.material.color.setHSL(sunHue, sunSat, sunLight * 0.8);
        this.lightRays.material.color.setHSL(sunHue, 0.9, sunLight * 0.9);

        // Bloom intensity (genre-dependent)
        let bloomStrength = 1.6 + (this.bassImpulse * 0.8);
        if (this.genreMode === 'electronic') {
            bloomStrength += 0.5; // Intense bloom
        } else if (this.genreMode === 'ambient') {
            bloomStrength += 0.3; // Soft glow
        }
        this.bloomPass.strength = Math.min(3.0, bloomStrength);

        // ========================================
        // SKY & FOG COLOR
        // ========================================
        this.scene.fog.color = fogColor;

        // ========================================
        // ROAD ANIMATION (SLOWED FOR BALLAD PACING)
        // ========================================
        let roadSpeed = 2 + (metrics.vol * 8); // Was 5 + vol*20 (too fast!)
        
        if (this.genreMode === 'electronic') {
            roadSpeed += this.bassImpulse * 12; // Was 30 (more moderate)
        } else if (this.genreMode === 'ambient') {
            roadSpeed = 1 + (metrics.vol * 4) + (metrics.lfo4 * 2); // Dreamy slow
        }
        
        const roadPos = this.roadParticles.geometry.attributes.position.array;
        const roadColors = this.roadParticles.geometry.attributes.color.array;
        const roadColor = new THREE.Color();
        
        for (let i = 0; i < roadPos.length; i += 3) {
            roadPos[i + 2] += roadSpeed;
            if (roadPos[i + 2] > 200) {
                roadPos[i + 2] = -1000 - (Math.random() * 500);
                
                // Road color based on time of day
                if (this.timeOfDay < 0.4 || this.timeOfDay > 0.9) {
                    // Dawn/Day - yellow lines
                    roadColor.setHSL(0.15, 0.9, Math.random() > 0.9 ? 0.7 : 0.3);
                } else if (this.timeOfDay < 0.7) {
                    // Sunset - orange/red
                    roadColor.setHSL(0.08, 1.0, Math.random() > 0.9 ? 0.6 : 0.2);
                } else {
                    // Night - dim red
                    roadColor.setHSL(0.0, 0.8, Math.random() > 0.9 ? 0.4 : 0.1);
                }
                
                roadColors[i] = roadColor.r;
                roadColors[i + 1] = roadColor.g;
                roadColors[i + 2] = roadColor.b;
            }
        }
        this.roadParticles.geometry.attributes.position.needsUpdate = true;
        this.roadParticles.geometry.attributes.color.needsUpdate = true;

        // ========================================
        // SKY PARTICLES (STARS)
        // ========================================
        const skyPos = this.skyParticles.geometry.attributes.position.array;
        
        // Star visibility based on time of day AND sun elevation
        // Only show stars when sun is actually down (not just at certain times)
        //const sunElevation = Math.max(0, Math.sin((this.timeOfDay * Math.PI * 2) - Math.PI));
        const starVisibility = Math.pow(1.0 - sunElevation, 2.0); // Inverse of sun elevation, squared for sharper transition
        this.skyParticles.material.opacity = starVisibility * (0.6 + (this.highImpulse * 0.4));
        
        // Star twinkle (ramp2 for rhythmic pulsing)
        const twinkle = 1.0 + (Math.sin(metrics.ramp2 * Math.PI * 2) * 0.3);
        this.skyParticles.material.size = 3.0 * twinkle;
        
        for (let i = 0; i < skyPos.length; i += 3) {
            skyPos[i + 2] += roadSpeed * 0.05;
            if (skyPos[i + 2] > 200) skyPos[i + 2] = -1000;
        }
        this.skyParticles.geometry.attributes.position.needsUpdate = true;

        // ========================================
        // DESERT DUST (WEATHER SYSTEM)
        // ========================================
        
        // Build up dust during silence
        this.dustBuildUp = Math.min(1.0, metrics.bassTime / 3000);
        
        const dustPos = this.desertDust.geometry.attributes.position.array;
        const dustSpeed = roadSpeed * 0.5;
        const windGust = this.midImpulse * 10; // Mid hits create wind
        const dustStorm = this.bassImpulse * this.dustBuildUp * 20; // Anticipated bass = storm
        
        for (let i = 0; i < dustPos.length; i += 3) {
            dustPos[i + 2] += dustSpeed + dustStorm;
            dustPos[i] += Math.sin(this.time * 0.5 + i) * 0.2 + windGust;
            dustPos[i + 1] += Math.cos(this.time * 0.3 + i) * 0.1;
            
            if (dustPos[i + 2] > 200) {
                dustPos[i + 2] = -500 - Math.random() * 1000;
                dustPos[i] = (Math.random() - 0.5) * 1000;
            }
        }
        this.desertDust.geometry.attributes.position.needsUpdate = true;
        
        // Dust visibility (more during bass-heavy sections)
        this.desertDust.material.opacity = 0.3 + (metrics.bassPresence * 0.4) + (this.dustBuildUp * 0.3);

        // ========================================
        // MOON GLOW
        // ========================================
        // Moon appears at night
        const moonVisibility = this.timeOfDay > 0.7 || this.timeOfDay < 0.2;
        const targetMoonOpacity = moonVisibility ? (0.15 + (metrics.midPresence * 0.2)) : 0.0;
        this.moonGlow.material.opacity += (targetMoonOpacity - this.moonGlow.material.opacity) * 0.05;
        
        // Moon color shifts
        if (this.timeOfDay > 0.5 && this.timeOfDay < 0.7) {
            // Twilight - orange moon
            this.moonGlow.material.color.setHSL(0.08, 0.6, 0.7);
        } else {
            // Night - blue moon
            this.moonGlow.material.color.setHSL(0.6, 0.4, 0.8);
        }
        
        // Size pulse
        const moonScale = 1.0 + (this.midImpulse * 0.2);
        this.moonGlow.scale.set(moonScale, moonScale, moonScale);

        // ========================================
        // HEAT HAZE SHADER
        // ========================================
        this.hazePass.uniforms['time'].value = this.time;
        
        // Haze intensity based on high presence (shimmering)
        const hazeStrength = 0.002 + (metrics.highPresence * 0.005);
        this.hazePass.uniforms['strength'].value = hazeStrength;
        
        // Haze frequency breathes with lfo4
        this.hazePass.uniforms['frequency'].value = 1.0 + (metrics.lfo4 * 0.5);

        // ========================================
        // CAMERA EFFECTS
        // ========================================
        
        // LFO sway during quiet parts
        if (metrics.vol < 0.3 || this.genreMode === 'ambient') {
            this.camera.position.x += Math.sin(metrics.lfo8 * Math.PI * 2) * 0.5;
            this.camera.rotation.z = Math.sin(metrics.lfo8 * Math.PI * 2) * 0.01;
        }
        
        // Bass shake
        const shake = this.bassImpulse * 3.0;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake * 0.5;
        
        // Return to center
        this.camera.position.x += (Math.sin(this.time * 0.5) * 5 - this.camera.position.x) * 0.1;
        this.camera.position.y += (10 - this.camera.position.y) * 0.1;
        this.camera.rotation.z += (0 - this.camera.rotation.z) * 0.1;
        
        // FOV breathing on bass presence
        const targetFOV = 75 + (metrics.bassPresence * 10) - (this.bassImpulse * 2);
        this.camera.fov += (targetFOV - this.camera.fov) * 0.1;
        this.camera.updateProjectionMatrix();

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}