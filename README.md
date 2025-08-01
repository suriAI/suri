# 🔥 Suri - Face Recognition System

[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104%2B-green)](https://fastapi.tiangolo.com)

**Enterprise-grade face recognition system built for real-world deployment**

You can find the details of the model here:

- **[Face Detection Training](experiments/README.md)** - Model training logs & datasets
- **[Face Recognition Model](experiments/README_RECOGNITION.md)** - Encoding & matching pipeline

## 🎯 Features

- **🔍 Face Detection**: YOLOv8n-based detection optimized for production
- **👤 Face Recognition**: EdgeFace embeddings for robust identity matching  
- **🛡️ Security**: Anti-spoofing, liveness detection, encrypted storage
- **⚡ Performance**: ONNX optimized models, async processing, GPU support
- **🌐 API-First**: RESTful FastAPI with OpenAPI documentation
- **📊 Monitoring**: Prometheus metrics, structured logging, health checks
- **🔧 Configurable**: Environment-based configuration management

## 🚀 Quick Start

### Prerequisites
- [Python 3.8+](https://www.python.org/downloads)
- [Git](https://git-scm.com/downloads)

### 1. Clone & Setup
```bash
git clone https://github.com/johnraivenolazo/suri.git
```

```bash
pip install -r requirements.txt
```

### 3. Run Development Server
```bash
uvicorn src.api.api_server:app --reload
```

### 4. Access API
- **API**: http://localhost:8000
- **Docs**: http://localhost:8000/docs  

<div align="center">
  <strong>Built with ❤️</strong><br>
</div>