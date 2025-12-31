import * as THREE from 'three';

export class JoyViz {
    constructor() {
        this.canvas = document.getElementById('viz-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true,
            logarithmicDepthBuffer: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        // Push fog further back since we are stacking higher
        this.scene.fog = new THREE.Fog(0x000000, 150, 400);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // MOVED CLOSER: Z=90 -> Z=80
        // This effectively "Zooms In" to fill the frame horizontally
        this.camera.position.set(0, 50, 80);
        this.camera.lookAt(0, -10, 0); 

        // -- CONFIG --
        this.LINE_COUNT = 100;   // Increased from 80 -> 100 (To fill the top)
        this.SEGMENTS = 256; 
        this.WIDTH = 250;    
        this.SPACING = 1.0;     
        this.Y_SEGMENTS = 10;
        
        this.lines = [];
        this.initLines();

        window.addEventListener('resize', () => this.resize());
    }

    initLines() {
        const shapeGeometry = new THREE.PlaneGeometry(
            this.WIDTH, 
            30, // Taller ribbon to ensure no gaps on steep viewing angles
            this.SEGMENTS - 1, 
            this.Y_SEGMENTS
        );

        for (let i = 0; i < this.LINE_COUNT; i++) {
            const group = new THREE.Group();
            
            // 1. Mask
            const fillMat = new THREE.MeshBasicMaterial({ 
                color: 0x000000, 
                side: THREE.DoubleSide,
                depthWrite: true,
                depthTest: true
            });
            const mesh = new THREE.Mesh(shapeGeometry.clone(), fillMat);
            mesh.renderOrder = i; 
            group.add(mesh);

            // 2. Line
            const lineGeo = new THREE.BufferGeometry();
            const positions = new Float32Array(this.SEGMENTS * 3);
            lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const lineMat = new THREE.LineBasicMaterial({ 
                color: 0xffffff,
                depthWrite: true,
                depthTest: true
            });
            const line = new THREE.Line(lineGeo, lineMat);
            line.renderOrder = i + this.LINE_COUNT; 
            group.add(line);

            // --- STACKING LOGIC (The "Wall" Effect) ---
            
            // Z: Move back slowly (1.0 unit per line)
            group.position.z = -i * this.SPACING;
            
            // ANCHOR BOTTOM: Start at -60 instead of -40.
            // This forces the bottom line to touch the bottom of the screen.
            group.position.y = -100 + (i * 1.0);

            this.scene.add(group);
            this.lines.push({ mesh, line, data: new Float32Array(this.SEGMENTS) });
        }
    }

    animate(metrics, rawData) {
        // 1. Shift Data
        for (let i = this.LINE_COUNT - 1; i > 0; i--) {
            this.lines[i].data.set(this.lines[i-1].data);
        }

        // 2. Process New Data
        const step = Math.floor(rawData.length / this.SEGMENTS);
        const currentData = this.lines[0].data;
        
        for (let j = 0; j < this.SEGMENTS; j++) {
            let val = rawData[j * step] / 255.0;
            
            const ratio = j / this.SEGMENTS;
            const window = Math.pow(Math.sin(ratio * Math.PI), 2);
            
            // Amplitude: 90.0 gives massive peaks
            val = val * window * 90.0;
            
            currentData[j] = val;
        }

        // 3. Update Geometries
        for (let i = 0; i < this.LINE_COUNT; i++) {
            const { mesh, line, data } = this.lines[i];
            
            const meshPos = mesh.geometry.attributes.position.array;
            const linePos = line.geometry.attributes.position.array;

            for (let j = 0; j < this.SEGMENTS; j++) {
                const x = (j / (this.SEGMENTS - 1)) * this.WIDTH - (this.WIDTH / 2);
                const y = data[j];

                // Update Line
                linePos[j * 3] = x;
                linePos[j * 3 + 1] = y;
                linePos[j * 3 + 2] = 0;

                // Update Mesh Ribbon
                // Deep baseline (-40) to ensure full coverage
                const baseline = -40; 
                
                for (let row = 0; row <= this.Y_SEGMENTS; row++) {
                    const vertexIndex = row * this.SEGMENTS + j;
                    const t = row / this.Y_SEGMENTS; 
                    
                    meshPos[vertexIndex * 3] = x;
                    meshPos[vertexIndex * 3 + 1] = y * (1 - t) + baseline * t;
                    meshPos[vertexIndex * 3 + 2] = 0;
                }
            }
            
            line.geometry.attributes.position.needsUpdate = true;
            mesh.geometry.attributes.position.needsUpdate = true;
        }

        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}