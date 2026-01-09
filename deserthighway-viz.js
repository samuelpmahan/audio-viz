import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- CUSTOM SHADER: HEAT HAZE ---
const HeatHazeShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'time': { value: 0.0 },
        'strength': { value: 0.003 }
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
        varying vec2 vUv;
        void main() {
            vec2 distortedUv = vUv;
            float offset = sin(vUv.y * 20.0 + time * 10.0) * strength;
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

        // --- STATE ---
        this.time = 0;
        this.kickImpulse = 0;
        this.snareImpulse = 0;

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
        // LOWERED Y: Changed from 30 to 0. 
        // Now the sun sits physically on the horizon line (-20), 
        // so the bottom half will actually get clipped.
        this.lightGroup.position.set(0, 0, -1000);

        // --- HELPER: Apply Horizon Clipping Shader ---
        // This ensures any pixel below Y = -20 fades to transparent
        const setupHorizonClipping = (material) => {
            material.onBeforeCompile = (shader) => {
                shader.vertexShader = `
                    varying float vWorldY;
                    ${shader.vertexShader}
                `.replace(
                    '#include <worldpos_vertex>',
                    `
                    #include <worldpos_vertex>
                    // Calculate the actual world-space Y coordinate of this vertex
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
                    // Clip anything below Y = -20 (the desert floor)
                    // We use smoothstep for a slightly soft edge so it doesn't look jagged
                    float horizonClip = smoothstep(-25.0, -15.0, vWorldY);
                    diffuseColor.a *= horizonClip;
                    `
                );
            };
        };

        // 1. Core (The bright center)
        const coreGeo = new THREE.SphereGeometry(40, 32, 32);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        setupHorizonClipping(coreMat); // <--- Apply Clip to Core
        this.lightCore = new THREE.Mesh(coreGeo, coreMat);
        this.lightGroup.add(this.lightCore);

        // 2. Halo (The glow)
        const haloGeo = new THREE.SphereGeometry(120, 32, 32);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0xff6600, 
            transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, toneMapped: false
        });
        setupHorizonClipping(haloMat); // <--- Apply Clip to Halo
        this.lightHalo = new THREE.Mesh(haloGeo, haloMat);
        this.lightGroup.add(this.lightHalo);

        // 3. Rays (The starburst)
        const rayGeo = new THREE.PlaneGeometry(800, 800);
        const rayTexture = this.createStarburstTexture();
        const rayMat = new THREE.MeshBasicMaterial({
            map: rayTexture, color: 0xffdd77, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        setupHorizonClipping(rayMat); // <--- Apply Clip to Rays
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

    animate(metrics) {
        this.time += 0.01;
        this.kickImpulse *= 0.9;
        this.snareImpulse *= 0.8;
        if (metrics.isKick) this.kickImpulse = 1.0;
        if (metrics.isSnare) this.snareImpulse = 1.0;

        // Light Animation
        const scale = 1.0 + (this.kickImpulse * 0.4);
        this.lightCore.scale.set(scale, scale, scale);
        this.lightHalo.scale.set(scale * 1.2, scale * 1.2, scale * 1.2);
        this.lightRays.rotation.z += 0.005;
        this.lightRays.material.opacity = 0.7 + (Math.random() * this.snareImpulse * 0.3);

        const targetHue = 0.08 - (metrics.bass * 0.05);
        this.lightCore.material.color.setHSL(targetHue, 1.0, 0.7);
        this.lightHalo.material.color.setHSL(targetHue, 1.0, 0.6);

        // Road Animation
        const roadSpeed = 5 + (metrics.vol * 20);
        const roadPos = this.roadParticles.geometry.attributes.position.array;
        for (let i = 0; i < roadPos.length; i += 3) {
            roadPos[i + 2] += roadSpeed; 
            if (roadPos[i + 2] > 200) roadPos[i + 2] = -1000 - (Math.random() * 500);
        }
        this.roadParticles.geometry.attributes.position.needsUpdate = true;

        // Sky Animation
        const skyPos = this.skyParticles.geometry.attributes.position.array;
        for (let i = 0; i < skyPos.length; i += 3) {
            skyPos[i + 2] += roadSpeed * 0.05; 
            if (skyPos[i + 2] > 200) skyPos[i + 2] = -1000;
        }
        this.skyParticles.geometry.attributes.position.needsUpdate = true;

        // Dust Animation
        const dustPos = this.desertDust.geometry.attributes.position.array;
        for (let i = 0; i < dustPos.length; i += 3) {
            dustPos[i + 2] += roadSpeed * 0.5; 
            dustPos[i] += Math.sin(this.time * 0.5 + i) * 0.2; 
            dustPos[i + 1] += Math.cos(this.time * 0.3 + i) * 0.1;
            if (dustPos[i + 2] > 200) {
                dustPos[i + 2] = -500 - Math.random() * 1000;
                dustPos[i] = (Math.random() - 0.5) * 1000;
            }
        }
        this.desertDust.geometry.attributes.position.needsUpdate = true;

        // Shaders & Camera
        this.hazePass.uniforms['time'].value = this.time;
        this.hazePass.uniforms['strength'].value = 0.002 + (metrics.vol * 0.005);
        this.camera.position.x = Math.sin(this.time * 0.5) * 5;
        this.camera.rotation.z = Math.sin(this.time * 0.5) * 0.02;
        this.camera.fov = 75 - (this.kickImpulse * 2);
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