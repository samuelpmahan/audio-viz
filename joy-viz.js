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
        
        // --- MANUAL CONFIG ---
        this.config = {
            width: 250,
            amplitude: 90.0,
            spacing: 1.0,
            lineCount: 100
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.Fog(0x000000, 150, 400);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 50, 80);
        this.camera.lookAt(0, -10, 0); 

        // -- CONFIG --
        this.LINE_COUNT = 100;
        this.SEGMENTS = 256; 
        this.Y_SEGMENTS = 10;
        
        this.lines = [];
        this.initLines();

        window.addEventListener('resize', () => this.resize());
    }

    getParams() {
        return [
            {
                name: 'Width',
                min: 50, max: 500, step: 10, value: this.config.width,
                onChange: (v) => { this.config.width = v; this.rebuildGeometry(); }
            },
            {
                name: 'Amp',
                min: 10, max: 200, step: 5, value: this.config.amplitude,
                onChange: (v) => this.config.amplitude = v
            },
            {
                name: 'Spacing',
                min: 0.5, max: 5.0, step: 0.1, value: this.config.spacing,
                onChange: (v) => { this.config.spacing = v; this.updateSpacing(); }
            }
        ];
    }

    rebuildGeometry() {
        // Simple hack: reload page or full rebuild is hard. 
        // We will just scale the root scene object in X for Width
        // A proper rebuild requires disposing all meshes.
        // For now, let's just update the X positions in the animate loop scaling.
    }

    updateSpacing() {
        this.lines.forEach((obj, i) => {
            obj.group.position.z = -i * this.config.spacing;
        });
    }

    initLines() {
        const shapeGeometry = new THREE.PlaneGeometry(
            this.config.width, // Initial Width
            30, 
            this.SEGMENTS - 1, 
            this.Y_SEGMENTS
        );

        for (let i = 0; i < this.LINE_COUNT; i++) {
            const group = new THREE.Group();
            
            // Mask
            const fillMat = new THREE.MeshBasicMaterial({ 
                color: 0x000000, side: THREE.DoubleSide, depthWrite: true, depthTest: true
            });
            const mesh = new THREE.Mesh(shapeGeometry.clone(), fillMat);
            mesh.renderOrder = i; 
            group.add(mesh);

            // Line
            const lineGeo = new THREE.BufferGeometry();
            const positions = new Float32Array(this.SEGMENTS * 3);
            lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthWrite: true, depthTest: true });
            const line = new THREE.Line(lineGeo, lineMat);
            line.renderOrder = i + this.LINE_COUNT; 
            group.add(line);

            group.position.z = -i * this.config.spacing;
            group.position.y = -100 + (i * 1.0);

            this.scene.add(group);
            this.lines.push({ group, mesh, line, data: new Float32Array(this.SEGMENTS) });
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
            // AMPLITUDE CONTROL
            val = val * window * this.config.amplitude;
            currentData[j] = val;
        }

        // 3. Update Geometries
        for (let i = 0; i < this.LINE_COUNT; i++) {
            const { mesh, line, data } = this.lines[i];
            
            const meshPos = mesh.geometry.attributes.position.array;
            const linePos = line.geometry.attributes.position.array;

            for (let j = 0; j < this.SEGMENTS; j++) {
                // WIDTH CONTROL (Dynamic)
                const x = (j / (this.SEGMENTS - 1)) * this.config.width - (this.config.width / 2);
                const y = data[j];

                // Update Line
                linePos[j * 3] = x;
                linePos[j * 3 + 1] = y;
                linePos[j * 3 + 2] = 0;

                // Update Mesh Ribbon
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