import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ThemeProvider from './components/ThemeProvider'
import './index.css'

// Apply the theme before first paint to avoid a flash. Light is the default;
// only an explicit saved 'dark' removes the class.
try {
  if (localStorage.getItem('th:theme') !== 'dark') {
    document.documentElement.classList.add('light')
  }
} catch {
  document.documentElement.classList.add('light') // storage unavailable — default light
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
