// terrain-generator.js
import * as THREE from 'three';

export class ProceduralTerrain {
    constructor(options = {}) {
        this.width = options.width || 400;
        this.depth = options.depth || 400;
        this.resolution = options.resolution || 256;
        this.heightScale = options.heightScale || 60;
        
        this.createTerrain();
    }
    
    createTerrain() {
        const geometry = new THREE.PlaneGeometry(
            this.width, 
            this.depth, 
            this.resolution, 
            this.resolution
        );
        geometry.rotateX(-Math.PI / 2);
        
        // Custom shader material with FBM noise
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                heightScale: { value: this.heightScale },
                bassHit: { value: 0 },
                bassPresence: { value: 0 },
                colorLow: { value: new THREE.Color(0x2d4a3e) },  // Valley
                colorMid: { value: new THREE.Color(0x5a7247) },  // Grass
                colorHigh: { value: new THREE.Color(0x8b7355) }, // Rock
                colorPeak: { value: new THREE.Color(0xffffff) }  // Snow
            },
            vertexShader: this.vertexShader(),
            fragmentShader: this.fragmentShader(),
            wireframe: false
        });
        
        this.mesh = new THREE.Mesh(geometry, this.material);
    }
    
    vertexShader() {
        return `
            uniform float time;
            uniform float heightScale;
            uniform float bassHit;
            uniform float bassPresence;
            
            varying vec3 vWorldPosition;
            varying vec3 vNormal;
            varying float vHeight;
            
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
            
            // Domain warping for more organic shapes
            float warpedFbm(vec2 p) {
                vec2 q = vec2(
                    fbm(p + vec2(0.0, 0.0), 4),
                    fbm(p + vec2(5.2, 1.3), 4)
                );
                
                vec2 r = vec2(
                    fbm(p + 4.0 * q + vec2(1.7, 9.2), 4),
                    fbm(p + 4.0 * q + vec2(8.3, 2.8), 4)
                );
                
                return fbm(p + 4.0 * r, 6);
            }
            
            void main() {
                vec2 terrainCoord = position.xz * 0.008;
                
                // Base terrain with domain warping
                float h = warpedFbm(terrainCoord + time * 0.01);
                
                // Add ridged noise for mountains
                float ridged = 1.0 - abs(snoise(terrainCoord * 2.0));
                ridged = pow(ridged, 2.0);
                h += ridged * 0.3;
                
                // Audio reactivity
                float dist = length(position.xz);
                float audioWave = sin(dist * 0.05 - time * 2.0) * bassHit * 0.5;
                h += audioWave * smoothstep(200.0, 0.0, dist);
                
                // Breathing with bass presence
                h *= 1.0 + bassPresence * 0.2;
                
                vec3 pos = position;
                pos.y = h * heightScale;
                
                vHeight = h;
                vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
                
                // Calculate normal via finite differences
                float eps = 0.5;
                float hL = warpedFbm(terrainCoord - vec2(eps, 0.0) * 0.008);
                float hR = warpedFbm(terrainCoord + vec2(eps, 0.0) * 0.008);
                float hD = warpedFbm(terrainCoord - vec2(0.0, eps) * 0.008);
                float hU = warpedFbm(terrainCoord + vec2(0.0, eps) * 0.008);
                vNormal = normalize(vec3(hL - hR, 2.0, hD - hU));
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `;
    }
    
    fragmentShader() {
        return `
            uniform vec3 colorLow;
            uniform vec3 colorMid;
            uniform vec3 colorHigh;
            uniform vec3 colorPeak;
            uniform float bassHit;
            
            varying vec3 vWorldPosition;
            varying vec3 vNormal;
            varying float vHeight;
            
            void main() {
                // Height-based coloring
                vec3 color;
                float h = vHeight;
                
                if (h < -0.2) {
                    color = colorLow;
                } else if (h < 0.2) {
                    color = mix(colorLow, colorMid, (h + 0.2) / 0.4);
                } else if (h < 0.6) {
                    color = mix(colorMid, colorHigh, (h - 0.2) / 0.4);
                } else {
                    color = mix(colorHigh, colorPeak, (h - 0.6) / 0.4);
                }
                
                // Slope-based rock exposure
                float slope = 1.0 - vNormal.y;
                color = mix(color, colorHigh, smoothstep(0.3, 0.7, slope));
                
                // Simple lighting
                vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
                float diffuse = max(dot(vNormal, lightDir), 0.0);
                float ambient = 0.3;
                
                color *= ambient + diffuse * 0.7;
                
                // Audio glow
                color += vec3(0.1, 0.05, 0.2) * bassHit;
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;
    }
    
    update(metrics) {
        this.material.uniforms.time.value += 0.016;
        this.material.uniforms.bassHit.value = metrics.bassHit || 0;
        this.material.uniforms.bassPresence.value = metrics.bassPresence || 0;
    }
}