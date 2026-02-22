# System Architecture

Suri is a **Hybrid Desktop Application**. It combines the raw power of a local executable with the connectivity of a modern SaaS.

## The "Hybrid" Diagram

```mermaid
graph TD
    subgraph Local [Local Machine (The Powerhouse)]
        UI[React Frontend] <-->|IPC| Main[Electron Main]
        Main <-->|WebSockets| AI[Python AI Engine]
        AI <-->|SQLAlchemy| SQLite[(Local DB)]
        
        subgraph SyncEngine [Sync Service]
            Queue[Offline Queue]
            Encrypt[E2EE Vault]
        end
        
        Main --> SyncEngine
    end

    subgraph Cloud [Secure Cloud (The Bridge)]
        Auth[Cloud Auth Provider]
        Postgres[(Managed Postgres DB)]
    end

    SyncEngine <-->|Encrypted Sync| Postgres
    Auth <-->|PKCE Flow| Main
```

## Core Components

### 1. The Local Engine (Python + ONNX)
Everything that requires speed happens here.
-   **No API Latency**: Face recognition takes ~15ms because execution runs on local hardware, not a remote server.
-   **The Source of Truth**: The local `SQLite` database is the master record. Power or internet outages do not affect core operations.

### 2. The Sync Bridge (Electron + Cloud)
This constitutes the "SaaS" layer, handling two functions:
1.  **Identity**: Handles Login via OAuth (using PKCE for security).
2.  **Transport**: Moves data between devices.
    *   **The Queue**: If a face is registered while offline, it stays in the `Offline Queue` until you're back online.
    *   **The Split**: Face data is encrypted (E2EE) before upload, while attendance logs are sent as standard JSON for reports.

## Tech Stack (Updated)

### Frontend
-   **Framework**: React 19 + Vite
-   **Style**: Tailwind CSS v4
-   **Runtime**: Electron

### Backend (Local)
-   **Language**: Python 3.10+
-   **API**: FastAPI (Localhost only)
-   **AI**: ONNX Runtime (CPU/GPU)

### Cloud Infrastructure
-   **Auth**: OAuth 2.0 / OpenID Connect
-   **Database**: Managed Postgres
-   **Realtime**: WebSocket Subscriptions (for "Live View")
