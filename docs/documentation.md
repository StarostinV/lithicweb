# 3D Mesh Annotation

## Overview

This tool allows you to annotate 3D models and is primarily developed for annotating lithic artifacts. It is integrated with the ML annotation model that runs on the server (token required).

## Buttons
- **Choose File**: Upload a .PLY file from your computer for annotating.
- **View Mode**: Allows you to rotate and zoom the 3D model. Hold left-click to rotate, hold right-click to move camera.
- **Draw Mode**: Enables drawing annotations on the 3D model: left-click (hold for continuous drawing).
- **Arrows Mode**: Draw arrows on the 3D model to indicate directions or features.
- **Model**: AI-powered annotation using the LithicServer backend.
- **History**: View and manage your annotation history with undo/redo capabilities.
- **Metadata**: View and edit metadata associated with the mesh (author, version, etc.).
- **Evaluation**: Compare annotations between ground truth and prediction states with detailed metrics.
- **Update Light**: Updates the direction of the light in the scene based on the camera position.
- **Export Annotations**: Exports the annotations to a .PLY file.

## AI Model Inference
The Model panel connects to a LithicServer backend for AI-powered edge detection:
1. Click the gear icon to configure your server URL and API token
2. Create or select an inference session
3. Upload your current mesh to the server
4. Load the mesh data into your session
5. Adjust inference parameters (edge threshold, steps, etc.)
6. Click "Run Inference" to process
7. Click "Apply Results" to add AI predictions as annotations
8. Use Undo/Redo to revert if needed

## Metadata Management
The Metadata panel allows you to view and edit metadata associated with your mesh:
- **View Metadata**: See all key-value pairs loaded from PLY files or added manually
- **Add Metadata**: Enter a key and value to add new metadata
- **Edit Metadata**: Click the edit button to modify existing values
- **Delete Metadata**: Remove metadata entries you no longer need
- **Auto-save**: Metadata is automatically included when you export to PLY

**Supported value types:**
- Strings: Plain text values
- Numbers: Integer or decimal values
- Booleans: true/false values
- Objects: JSON objects like {"key": "value"}
- Arrays: JSON arrays like [1, 2, 3]

## History & Undo/Redo
The History panel provides a complete view of all your annotation actions:
- **Undo/Redo**: Use buttons or keyboard shortcuts to undo/redo actions
- **Visual Timeline**: See all actions with timestamps and edge counts
- **Clickable States**: Click any state in the timeline to jump directly to it
- **Current State Indicator**: The active state is highlighted in blue
- **Memory Efficient**: Only stores edge indices, not full mesh data
- **Clear History**: Remove all history to free up memory
- **GT/Pred Labels**: Mark states as Ground Truth or Prediction for evaluation

## Evaluation Mode
The Evaluation panel allows comparing two annotation states with comprehensive metrics:
1. In the History panel, click "GT" button on a state to set it as Ground Truth
2. Click "Pred" button on another state to set it as Prediction
3. Switch to the Evaluation panel
4. Adjust thresholds: IoU (matching), OverSeg, UnderSeg
5. Click "Compute Metrics" to see results

**Metrics include:**
- TP/FP/FN counts, Precision, Recall, F1
- Panoptic Quality (PQ, RQ, SQ)
- Over-segmentation analysis (GT split across multiple predictions)
- Under-segmentation analysis (prediction merges multiple GTs)
- Missing GT (false negatives)
- Hallucinated predictions (false positives)

**Visualization modes:**
- All Errors: Overview with color-coded error types
- Matched: Show correctly matched segments
- Over-seg/Under-seg: Highlight specific error types
- Missing GT/Hallucinated: Show false negatives/positives

## Exported File Format
The exported .PLY file has the standard format with "vertex" and "face" that contains the original mesh. Additionally, it contains 
"labels" - a child property of the "vertex" property.

## Object Manipulation (Gizmo)
The gizmo is automatically shown in View Mode for direct object manipulation:
- **Default**: Rotate mode - drag the rings to rotate the object
- **Hold Ctrl**: Move mode - drag the arrows to move the object
- **X/Y/Z**: Constrain transformation to a single axis
- **Space**: Toggle between World and Local coordinate space
- **Escape**: Reset axis constraints (show all axes)

## Keyboard Shortcuts
- **Ctrl+Z**: Undo last action
- **Ctrl+Shift+Z** or **Ctrl+Y**: Redo last undone action
- Hold **Ctrl** (any mode): use left mouse button to shift the camera
- Hold **Alt** (any mode): use left mouse button to rotate the camera
- Hold **right-click** (any mode): move camera

## Support contact
Vladimir Starostin: [vladimir.starostin@uni-tuebingen.de](mailto:vladimir.starostin@uni-tuebingen.de).
