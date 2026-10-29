/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { brand: { 50:'#eef2ff',100:'#e0e7ff',500:'#6366f1',600:'#4f46e5',700:'#4338ca' }, ink:'#182033' },
    boxShadow: { soft:'0 18px 50px rgba(32,42,80,.08)' },
    borderRadius: { '2xl':'1.25rem' }
  }},
  plugins: []
}
