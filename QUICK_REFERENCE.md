# Suri - Quick Reference

## 🚀 Quick Commands

### Development
```bash
# Start development servers
./dev-start.bat        # Windows
./dev-start.sh         # macOS/Linux

# Manual development
cd backend && python run.py    # Backend only
cd desktop && pnpm dev         # Frontend only
```

### Building

```bash
# Complete build (recommended)
./build-all.bat        # Windows
./build-all.sh         # macOS/Linux

# Backend only
cd backend
python build_backend.py

# Frontend only
cd desktop
pnpm build
pnpm dist:win          # Windows
pnpm dist:mac          # macOS
pnpm dist:linux        # Linux
```

### Testing

```bash
# Test backend executable
cd backend
python build_backend.py --test

# Test frontend build
cd desktop
pnpm build
pnpm electron-pack     # Test packaging without distribution
```

## 📁 Key Files

| File | Purpose |
|------|---------|
| `backend/suri_backend.spec` | PyInstaller configuration |
| `backend/build_backend.py` | Backend build automation |
| `desktop/src/electron/backendService.ts` | Backend process management |
| `desktop/electron-builder.json` | Electron packaging config |
| `desktop/scripts/before-pack.js` | Pre-packaging automation |

## 🔧 Configuration

### Backend Ports
- **Development**: 8700 (configurable in `run.py`)
- **Production**: Dynamic allocation by `backendService.ts`

### Build Outputs
- **Backend**: `backend/dist/suri-backend[.exe]`
- **Electron**: `desktop/dist/`

### Environment Detection
```typescript
// In Electron
app.isPackaged          // true in production
process.env.NODE_ENV    // 'development' or 'production'
```

## 🐛 Quick Fixes

### Backend Won't Start
1. Check Python dependencies: `pip install -r requirements.txt`
2. Verify model files exist in `desktop/public/weights/`
3. Check port availability: `netstat -an | grep 8700`

### Build Fails
1. Clean build artifacts: `rm -rf backend/dist desktop/dist`
2. Update dependencies: `pip install --upgrade -r requirements.txt`
3. Check disk space and permissions

### Large Bundle Size
1. Review `OPTIMIZATION_GUIDE.md`
2. Enable UPX compression in `suri_backend.spec`
3. Exclude unnecessary dependencies

## 📊 Size Targets

| Component | Target Size |
|-----------|-------------|
| Backend Executable | < 100MB |
| Electron App | < 200MB |
| Total Installer | < 300MB |

## 🔍 Debug Commands

```bash
# PyInstaller debug
python -m PyInstaller --log-level=DEBUG suri_backend.spec

# Electron debug
cd desktop
pnpm electron . --enable-logging

# Backend health check
curl http://localhost:8700/health
```

## 📱 Platform Notes

### Windows
- Use `.bat` scripts
- Executable: `.exe`
- Installer: `.msi` or portable

### macOS
- Use `.sh` scripts
- Code signing required for distribution
- Installer: `.dmg`

### Linux
- Use `.sh` scripts
- May need additional system dependencies
- Installer: `.AppImage`

## 🚨 Emergency Recovery

### Reset Everything
```bash
# Clean all build artifacts
rm -rf backend/dist backend/build
rm -rf desktop/dist desktop/node_modules

# Reinstall dependencies
cd backend && pip install -r requirements.txt
cd desktop && pnpm install

# Rebuild from scratch
./build-all.sh
```

### Rollback to Development
```bash
# Stop any running processes
pkill -f suri-backend
pkill -f electron

# Start development mode
./dev-start.sh
```