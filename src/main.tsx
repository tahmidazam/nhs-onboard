import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import { router } from './router'
import { ErrorBoundary } from './ErrorBoundary'
import { Toaster } from '@/components/ui/toast'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConvexProvider client={convex}>
        <RouterProvider router={router} />
        <Toaster />
      </ConvexProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
