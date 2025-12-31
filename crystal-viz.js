import * as THREE from 'three';

export class CrystalViz {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505); 

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 30;

        // LIGHTS
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        // Boosted Intensity (2 -> 5) for dramatic rim lighting
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

    initGeometry() {
        // 1. THE CORE
        const geometry = new THREE.IcosahedronGeometry(10, 15); // High detail for smooth spikes
        this.originalPositions = geometry.attributes.position.array.slice();
        
        // THE FIX: Emissive Material (Self-Glowing)
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x111111,      // Dark base
            emissive: 0xaa0033,   // Deep Red Glow from within
            emissiveIntensity: 0.5, // Base glow strength
            roughness: 0.1,       // Very shiny
            metalness: 0.9,       // Metallic
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
            opacity: 0.4 // Increased visibility (was 0.1)
        });
        this.wireframe = new THREE.Mesh(wireGeo, wireMat);
        this.group.add(this.wireframe);
    }

    animate(metrics, rawData) {
        this.group.rotation.x += 0.002;
        this.group.rotation.y += 0.004;
        
        // REACTIVE PULSE
        const s = 1 + (metrics.bass * 0.1);
        this.wireframe.scale.set(s, s, s);
        this.wireframe.rotation.y -= 0.002; 

        // THE FIX: Make it FLASH on the beat
        // Base 0.2 + Bass Kick power
        this.mesh.material.emissiveIntensity = 0.2 + (metrics.bass * 2.0);

        // --- VERTEX DISPLACEMENT ---
        const positionAttribute = this.mesh.geometry.attributes.position;
        const vertex = new THREE.Vector3();
        
        for (let i = 0; i < positionAttribute.count; i++) {
            const ox = this.originalPositions[i * 3];
            const oy = this.originalPositions[i * 3 + 1];
            const oz = this.originalPositions[i * 3 + 2];

            // Use lower frequencies for "Breathing" effect
            const audioIndex = (i % Math.floor(rawData.length / 4)); 
            const audioValue = rawData[audioIndex] / 255.0;

            vertex.set(ox, oy, oz).normalize();
            
            // Spikes grow with volume
            const dist = 10 + (audioValue * 8 * metrics.bass); 
            
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