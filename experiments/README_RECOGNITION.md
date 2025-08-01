# EdgeFace Model Integration for SURI

## Background and Model Selection Process

When developing [SURI](https://github.com/johnraivenolazo/suri), I needed a robust face recognition model that could handle real-world deployment constraints. After evaluating several options including ArcFace and CosFace, I chose EdgeFace because it actually delivers on its promises - unlike many academic models that perform well in papers but struggle in production.

What impressed me most was EdgeFace's EdgeNext architecture combined with low-rank factorization. This approach maintains high accuracy while keeping models practical for edge deployment. The thoughtful variety of model sizes (XXS, XS, S, Base) meant I could optimize specifically for SURI's requirements without compromising performance.

## Implementation Approach

I worked with the EdgeFace repository at [github.com/otroshi/edgeface](https://github.com/otroshi/edgeface), which contained the pre-trained PyTorch weights. Rather than using the models as-is, I developed a conversion pipeline within this repository to generate ONNX models optimized for SURI's production environment.

My approach focused on practical deployment needs: I created a conversion script that transforms the PyTorch .pt files into ONNX format, handling all the architectural complexities and ensuring reliable, repeatable conversions. This gives SURI the flexibility to use optimized models across different deployment scenarios while maintaining the benefits of the original research.

## Technical Implementation

The conversion process required understanding EdgeFace's architecture deeply. Initially, I encountered issues trying to use the IResNet components, but discovered that EdgeFace checkpoints are designed for EdgeNext-based models. This led me to create a conversion script that properly loads models using the backbones module and exports them to ONNX with correct input/output specifications.

Here's the workflow I developed:

```bash
# Clone the repository containing the PyTorch weights
git clone https://github.com/otroshi/edgeface.git
cd edgeface

# Create and run the conversion script (see conversion script below)
python conversion_script.py

# Use the generated ONNX models in SURI
```

For SURI integration, I primarily use the `edgeface_s_gamma_05` variant - it balances accuracy with efficiency perfectly at ~4MB. The models output 512-dimensional embeddings that integrate seamlessly with SURI's face clustering, identification, and verification systems.

```python
import onnxruntime as ort
import numpy as np

# Load the converted model
session = ort.InferenceSession('edgeface-s.onnx')

# Process face images (112x112, RGB, normalized)
input_data = np.random.randn(1, 3, 112, 112).astype(np.float32)
outputs = session.run(None, {'input': input_data})
face_embedding = outputs[0]  # 512-dimensional feature vector
```

## Production Considerations

The ONNX conversion enables flexible deployment across SURI's target platforms. I've optimized the preprocessing pipeline to handle face detection (using MTCNN), alignment, resizing to 112x112 pixels, and normalization. The models perform efficiently on both CPU and GPU, with excellent batch processing capabilities for high-throughput scenarios.

Performance has been excellent - ONNX Runtime typically outperforms direct PyTorch inference for production use. I've also experimented with quantization for mobile deployment scenarios where SURI needs to run on resource-constrained devices.

The 512-dimensional embeddings have the mathematical properties needed for face recognition: similar faces produce similar embeddings, making them perfect for SURI's similarity search and clustering algorithms. The consistent output format provides a stable interface that other SURI components can rely on.

## Repository Structure

```
edgeface/
├── CONVERSION_GUIDE.md           # This documentation  
├── checkpoints/                  # Original PyTorch weights
│   ├── edgeface_s_gamma_05.pt   # Small model (γ=0.5)
│   └── edgeface_xs_gamma_06.pt  # Extra-small model (γ=0.6)
├── edgeface-s.onnx               # Generated ONNX model (after conversion)
└── README.md                     # Basic information
```

**Note**: The original repository contains the PyTorch weights. To convert them to ONNX, you'll need to create the conversion script shown below.

## Technical Requirements

**Dependencies for conversion:**
```bash
pip install torch torchvision onnx onnxruntime timm
```

**For inference only:**
```bash
pip install onnxruntime
```

**Model specifications:**
- Input: `(batch_size, 3, 112, 112)` RGB images
- Output: `(batch_size, 512)` feature embeddings
- Preprocessing: Face detection → alignment → resize → normalize

## Conversion Script Implementation

Since the original repository doesn't include a conversion script, I created one to handle the PyTorch to ONNX transformation. If you want to perform the conversion yourself, here's the complete script I developed:

```python
import torch
from backbones import get_model

print("[INFO] Building model architecture...")
model = get_model('edgeface_s_gamma_05')

print("[INFO] Loading weights...")
checkpoint = torch.load('checkpoints/edgeface_s_gamma_05.pt', map_location='cpu')
model.load_state_dict(checkpoint)
model.eval()

print("[INFO] Verifying with dummy input...")
dummy_input = torch.randn(1, 3, 112, 112)
output = model(dummy_input)
print("[INFO] Forward pass successful. Output shape:", output.shape)

print("[INFO] Exporting to ONNX...")
torch.onnx.export(model, dummy_input, 'edgeface-s.onnx',
                  input_names=['input'], output_names=['output'],
                  opset_version=11)
print("[SUCCESS] edgeface-s.onnx generated successfully ✅")
```

Save this as `convert.py` in the repository root and run it after installing the required dependencies.