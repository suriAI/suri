import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// Copy weights to public directory so they're available via HTTP
const copyWeights = () => {
  const srcDir = join(__dirname, 'weights')
  const destDir = join(__dirname, 'public', 'weights')
  
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }
  
  // Copy SCRFD detection model
  const srcScrfd = join(srcDir, 'scrfd_2.5g_kps_640x640.onnx')
  const destScrfd = join(destDir, 'scrfd_2.5g_kps_640x640.onnx')
  
  if (existsSync(srcScrfd)) {
    copyFileSync(srcScrfd, destScrfd)
    console.log('✅ Copied SCRFD model to public/weights/')
  } else {
    console.warn('⚠️ SCRFD model not found at:', srcScrfd)
  }
  
  // Copy EdgeFace recognition model
  const srcEdgeface = join(srcDir, 'edgeface-recognition.onnx')
  const destEdgeface = join(destDir, 'edgeface-recognition.onnx')
  
  if (existsSync(srcEdgeface)) {
    copyFileSync(srcEdgeface, destEdgeface)
    console.log('✅ Copied EdgeFace model to public/weights/')
  } else {
    console.warn('⚠️ EdgeFace model not found at:', srcEdgeface)
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'copy-weights',
      buildStart() {
        copyWeights()
      },
      configureServer() {
        copyWeights()
      }
    }
  ],
  build: {
    outDir: "dist-react"
  },
  server: {
    port: 5123,
    strictPort: true
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
 })