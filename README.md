# P2PChat: Real-Time Decentralized Communication 🚀

P2PChat is a modern, blazing-fast peer-to-peer chat application built using **React**, **TypeScript**, and **Vite**. It leverages **WebRTC** to enable direct client-to-client communication, minimizing server overhead and maximizing privacy.

## ✨ Features
- **True Peer-to-Peer:** Messages flow directly between users (WebRTC Data Channels) without being stored on an intermediary database.
- **End-to-End Encryption (E2EE):** (Architecture Ready) Your conversations remain private and secure.
- **Cross-Platform:** Built with **Capacitor**, allowing seamless deployment to Web, Android, and iOS from a single codebase.
- **Modern UI/UX:** Styled with responsive, sleek components for a native-like app experience.

## 🛠️ Technology Stack
- **Frontend Framework:** React 18
- **Language:** TypeScript
- **Build Tool:** Vite (Ultra-fast HMR)
- **Network Layer:** WebRTC
- **Mobile Wrapper:** Capacitor JS

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites
Make sure you have Node.js and NPM installed on your machine.
- Node.js (v16+)
- npm (v8+)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_GITHUB_USERNAME/P2PChat.git
   cd P2PChat
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

### Building for Production
To create an optimized production build:
```bash
npm run build
```

## 📱 Mobile Development (Capacitor)
This project is configured to run natively on mobile devices.
```bash
# Sync web assets to Android
npx cap sync android

# Open Android Studio to build and run the app
npx cap open android
```

## 🤝 Contributing
Contributions, issues, and feature requests are welcome!

## 📄 License
This project is open-source and available under the MIT License.
