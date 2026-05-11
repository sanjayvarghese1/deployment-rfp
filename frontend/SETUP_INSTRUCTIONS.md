# Project Setup Instructions

## Overview
This project is a Next.js application. Use the provided setup scripts to automatically install all dependencies.

## Quick Start

### Windows
```bash
.\setup.bat
```
Or double-click the `setup.bat` file.

### macOS / Linux
```bash
chmod +x setup.sh
./setup.sh
```

## Manual Installation (if scripts don't work)
```bash
npm install
```

## Available Commands
- `npm run dev` - Start development server (http://localhost:3000)
- `npm run dev:network` - Start development server accessible on network (0.0.0.0)
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## Dependencies Installed
- **Frontend**: Next.js 16, React 19
- **Database**: Supabase
- **UI**: Tailwind CSS
- **PDF Processing**: jsPDF, pdf-parse, pdfjs-dist, puppeteer
- **API/AI**: OpenAI, Langfuse
- **Email**: Nodemailer
- **Utilities**: date-fns, uuid
- **Development**: TypeScript, ESLint

## Notes
- Node.js and npm must be installed before running setup scripts
- The project uses TypeScript
- Tailwind CSS is configured for styling
- The `.env.local` file may be needed for environment variables (Supabase, OpenAI keys, etc.)

## Troubleshooting
If you encounter issues:
1. Delete `node_modules` folder and `package-lock.json`
2. Run the setup script again
3. Or manually run: `npm install --legacy-peer-deps` if there are peer dependency conflicts
