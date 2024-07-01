import CustomPLYLoader from "./customPLYLoader";
import { read as readmat } from "mat-for-js"


export default class MeshLoader {
    constructor(meshObject, arrowDrawer) {
        this.meshObject = meshObject;
        this.arrowDrawer = arrowDrawer;
        this.loader = new CustomPLYLoader();

        this.load = this.load.bind(this);

        document.getElementById('fileInput').addEventListener('change', (event) => {
            this.load(event);
        });
        
    }

    load(event) {
        const file = event.target.files[0];
        if (!file) return;
    
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = event.target.result;
            let positions, labels, indices, arrows; 

            if (file.name.endsWith('.ply')) {
                ({ positions, labels, indices, arrows } = this.readPLY(data));
                debugGlobalVar['ply'] = {
                    positions: positions,
                    labels: labels,
                    indices: indices,
                    arrows: arrows
                }
            } else if (file.name.endsWith('.mat')) {
                ({ positions, labels, indices, arrows } = this.readMAT(data));
            } else {
                console.error('Unsupported file format');
                return;
            }

            if (positions.length === 0) {
                console.error('No data found in the file');
                return;
            }
        
            this.meshObject.setMesh(positions, labels, indices);
            this.arrowDrawer.clear();
            this.arrowDrawer.load(arrows);
        };
    
        reader.readAsArrayBuffer(file);
    }
    
    readPLY(data) {
        const geometry = this.loader.parse(data);

        const positions = geometry.attributes.position.array;
        const labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];
        const indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);
        const arrows = geometry.userData.arrows ? geometry.userData.arrows : [];

        return {
            positions,
            labels,
            indices,
            arrows
        };
    }

    readMAT(data) {
        const mat = readmat(data).data;

        const positions = new Float32Array((mat['v'] || mat['vertices'] || []).flat());
        const indices = (mat['f'] || mat['faces'] || []).flat();
        const faceLabels = new Uint16Array((mat['GL'] || []).flat());

        if (indices.length !== 0) {
            indices.forEach((index, i) => {
                indices[i] = index - 1;
            });
        }

        const labels = calculateVertexEdgeLabels(indices, faceLabels);



        debugGlobalVar['mat'] = {
            positions: positions,
            labels: labels,
            indices: indices,
            arrows: []
        }
        return {
            positions: positions,
            labels: labels,
            indices: indices,
            arrows: []
        }

        // return empty object
        // return {
        //     positions: [],
        //     labels: [],
        //     indices: [],
        //     arrows: []
        // }
    }
}


function calculateVertexEdgeLabels(indices, faceLabels) {
    if (indices.length === 0) return [];
    if (faceLabels.length === 0) return [];

    const vertexCount = indices.reduce((max, idx) => Math.max(max, idx), 0) + 1;
    const vertexEdgeLabels = new Uint8Array(vertexCount);

    // Create an array to count the occurrences of each label for each vertex
    const vertexLabelCounts = new Array(vertexCount).fill(0).map(() => ({}));

    for (let i = 0; i < indices.length; i += 3) {
        const faceLabel = faceLabels[Math.floor(i / 3)];
        const vertex1 = indices[i];
        const vertex2 = indices[i + 1];
        const vertex3 = indices[i + 2];

        vertexLabelCounts[vertex1][faceLabel] = (vertexLabelCounts[vertex1][faceLabel] || 0) + 1;
        vertexLabelCounts[vertex2][faceLabel] = (vertexLabelCounts[vertex2][faceLabel] || 0) + 1;
        vertexLabelCounts[vertex3][faceLabel] = (vertexLabelCounts[vertex3][faceLabel] || 0) + 1;
    }

    vertexLabelCounts.forEach((labelCounts, vertex) => {
        const uniqueLabels = Object.keys(labelCounts).length;
        vertexEdgeLabels[vertex] = uniqueLabels > 1 ? 1 : 0;
    });

    return vertexEdgeLabels;
}
