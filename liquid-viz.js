import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CUSTOM SHADER: MATTE LIQUID (Half-Lambert) ---
const LiquidShader = {
    uniforms: {
        'time': { value: 0.0 },
        'boilAmount': { value: 0.1 },
        'spikeAmount': { value: 0.0 },
        'colorPhase': { value: 0.0 },
        'baseColor': { value: new THREE.Color(0x666666) } // Mid-grey for even brightness
    },
    vertexShader: `
        uniform float time;
        uniform float boilAmount;
        uniform float spikeAmount;
        varying vec3 vNormal;
        varying float vDisplacement;

        float hash(vec3 p) {
            p  = fract( p*0.3183099+.1 );
            p *= 17.0;
            return fract( p.x*p.y*p.z*(p.x+p.y+p.z) );
        }

        float noise( in vec3 x ) {
            vec3 i = floor(x);
            vec3 f = fract(x);
            f = f*f*(3.0-2.0*f);
            return mix(mix(mix( hash(i+vec3(0,0,0)), 
                                hash(i+vec3(1,0,0)),f.x),
                           mix( hash(i+vec3(0,1,0)), 
                                hash(i+vec3(1,1,0)),f.x),f.y),
                       mix(mix( hash(i+vec3(0,0,1)), 
                                hash(i+vec3(1,0,1)),f.x),
                           mix( hash(i+vec3(0,1,1)), 
                                hash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }

        void main() {
            vNormal = normalMatrix * normal;

            float boil = noise(position * 2.0 + time) * boilAmount;
            float spikes = pow(noise(position * 5.0 + time * 2.0), 4.0) * spikeAmount;
            
            vDisplacement = boil + spikes;
            
            vec3 newPosition = position + normal * vDisplacement;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
        }
    `,
    fragmentShader: `
        uniform vec3 baseColor;
        uniform float colorPhase;
        varying vec3 vNormal;
        varying float vDisplacement;

        void main() {
            vec3 normal = normalize(vNormal);
            
            // 1. "Half-Lambert" Lighting (The Fix)
            // Instead of a spotlight, light wraps around the object gently.
            // Range is 0.4 to 1.0 (never black, never blown out)
            vec3 lightDir = normalize(vec3(0.5, 1.0, 1.0));
            float diff = dot(normal, lightDir) * 0.5 + 0.5; 
            
            // 2. Color Shift (Wub tint)
            vec3 tint = vec3(0.0);
            tint.r = sin(colorPhase + vDisplacement * 0.2) * 0.4;
            tint.b = cos(colorPhase) * 0.4;

            // 3. Ambient Occlusion Fake
            // Darken the "valleys" of the liquid slightly so spikes pop
            // without needing actual shadows.
            float occlusion = clamp(0.5 + vDisplacement * 0.1, 0.5, 1.0);

            // Combine: Base + Tint * Soft Light * Valley Darkening
            vec3 finalColor = (baseColor + tint) * diff * occlusion;

            gl_FragColor = vec4(finalColor, 1.0);
        }
    `
};

export class LiquidMetal {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            boilStrength: 5.0,
            spikeHeight: 8.0,
            rotSpeed: 0.005,
            bloomStrength: 0.8, 
            meshResolution: 128
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000); 

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 40;

        // --- POST PROCESSING ---
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.strength = this.config.bloomStrength;
        this.bloomPass.radius = 0.5;
        this.bloomPass.threshold = 0.1; 
        this.composer.addPass(this.bloomPass);

        this.initObject();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Boil',
                min: 0, max: 10, step: 0.1, value: this.config.boilStrength,
                onChange: (v) => this.config.boilStrength = v
            },
            {
                name: 'Spikes',
                min: 0, max: 20, step: 0.1, value: this.config.spikeHeight,
                onChange: (v) => this.config.spikeHeight = v
            },
            {
                name: 'Speed',
                min: 0, max: 0.05, step: 0.001, value: this.config.rotSpeed,
                onChange: (v) => this.config.rotSpeed = v
            },
            {
                name: 'Bloom',
                min: 0, max: 3, step: 0.1, value: this.config.bloomStrength,
                onChange: (v) => this.config.bloomStrength = v
            }
        ];
    }

    initObject() {
        const geometry = new THREE.IcosahedronGeometry(15, 40); 
        
        const material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(LiquidShader.uniforms),
            vertexShader: LiquidShader.vertexShader,
            fragmentShader: LiquidShader.fragmentShader,
            wireframe: false
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    animate(metrics) {
        const uniforms = this.mesh.material.uniforms;
        
        uniforms['time'].value += 0.01 + (metrics.ramp4 * 0.05);
        
        const targetBoil = this.config.boilStrength + (metrics.midPresence * 5.0);
        uniforms['boilAmount'].value += (targetBoil - uniforms['boilAmount'].value) * 0.1;
        
        const targetSpike = (metrics.highHit * this.config.spikeHeight) + (metrics.treble * 2.0);
        uniforms['spikeAmount'].value += (targetSpike - uniforms['spikeAmount'].value) * 0.2; 
        
        uniforms['colorPhase'].value = metrics.centroid * Math.PI * 2;

        this.mesh.rotation.y += this.config.rotSpeed * (1.0 + metrics.lfo4 * 0.5);
        this.mesh.rotation.x = Math.sin(metrics.lfo8 * Math.PI * 2) * 0.2;
        this.mesh.rotation.z += this.config.rotSpeed * 0.5;
        
        this.bloomPass.strength = this.config.bloomStrength + (metrics.bass * 0.3);

        const targetScale = 1.0 + (metrics.bassHit * 0.3) + (metrics.bassPresence * 0.1);
        this.mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.15);

        const orbitRadius = 5;
        this.camera.position.x = Math.sin(metrics.lfo8 * Math.PI * 2) * orbitRadius;
        this.camera.position.y = Math.cos(metrics.lfo4 * Math.PI * 2) * orbitRadius * 0.5;
        this.camera.lookAt(0, 0, 0);

        this.composer.render();
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}