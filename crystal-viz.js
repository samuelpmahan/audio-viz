import * as THREE from 'three';

export class CrystalViz {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // --- MANUAL CONFIG ---
        this.config = {
            rotSpeed: 0.004,
            amplitude: 8.0,
            baseGlow: 0.2,
            wireOpacity: 0.4
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505); 

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 30;

        // LIGHTS
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        const pointLight1 = new THREE.PointLight(0xff0055, 5, 100);
        pointLight1.position.set(20, 20, 20);
        this.scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0x00e5ff, 5, 100);
        pointLight2.position.set(-20, -20, 20);
        this.scene.add(pointLight2);

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.initGeometry();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Rotation',
                min: 0, max: 0.05, step: 0.001, value: this.config.rotSpeed,
                onChange: (v) => this.config.rotSpeed = v
            },
            {
                name: 'Spikes',
                min: 0, max: 20, step: 0.5, value: this.config.amplitude,
                onChange: (v) => this.config.amplitude = v
            },
            {
                name: 'Glow',
                min: 0, max: 2, step: 0.1, value: this.config.baseGlow,
                onChange: (v) => this.config.baseGlow = v
            },
            {
                name: 'Wireframe',
                min: 0, max: 1, step: 0.05, value: this.config.wireOpacity,
                onChange: (v) => {
                    this.config.wireOpacity = v;
                    if(this.wireframe) this.wireframe.material.opacity = v;
                }
            }
        ];
    }

    initGeometry() {
        // 1. THE CORE
        const geometry = new THREE.IcosahedronGeometry(10, 15); 
        this.originalPositions = geometry.attributes.position.array.slice();
        
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x111111,      
            emissive: 0xaa0033,   
            emissiveIntensity: 0.5, 
            roughness: 0.1,       
            metalness: 0.9,       
            flatShading: true 
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.group.add(this.mesh);

        // 2. THE WIREFRAME
        const wireGeo = new THREE.IcosahedronGeometry(10.1, 2); 
        const wireMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, 
            wireframe: true,
            transparent: true,
            opacity: this.config.wireOpacity
        });
        this.wireframe = new THREE.Mesh(wireGeo, wireMat);
        this.group.add(this.wireframe);
    }

    animate(metrics, rawData) {
        this.group.rotation.x += this.config.rotSpeed * 0.5;
        this.group.rotation.y += this.config.rotSpeed;
        
        // REACTIVE PULSE
        const s = 1 + (metrics.bass * 0.1);
        this.wireframe.scale.set(s, s, s);
        this.wireframe.rotation.y -= this.config.rotSpeed * 0.5; 

        // FLASH: Manual Base + Bass Kick
        this.mesh.material.emissiveIntensity = this.config.baseGlow + (metrics.bass * 2.0);

        // --- VERTEX DISPLACEMENT ---
        const positionAttribute = this.mesh.geometry.attributes.position;
        const vertex = new THREE.Vector3();
        
        for (let i = 0; i < positionAttribute.count; i++) {
            const ox = this.originalPositions[i * 3];
            const oy = this.originalPositions[i * 3 + 1];
            const oz = this.originalPositions[i * 3 + 2];

            const audioIndex = (i % Math.floor(rawData.length / 4)); 
            const audioValue = rawData[audioIndex] / 255.0;

            vertex.set(ox, oy, oz).normalize();
            
            // Spikes: 10 + (Audio * Manual Amp * Bass)
            const dist = 10 + (audioValue * this.config.amplitude * metrics.bass); 
            
            vertex.multiplyScalar(dist);
            positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.computeVertexNormals(); 

        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}